import type {
  ClientMessage,
  DeviceInfo,
  PlainFrame,
  ServerInfo,
  ServerMessage,
  ServerStatus,
} from '../../../shared/protocol';
import { deriveSessionKey, exportSpki, generateEphemeral, Sealer } from './crypto';
import { identityPublicKey, isAndroid, Native, signIdentity } from './native';
import type { Credentials } from './state';

export type LinkState = 'idle' | 'connecting' | 'pairing' | 'online' | 'offline' | 'error';

export interface PairTicket {
  hosts: string[];
  port: number;
  code: string;
  name?: string;
  usb?: boolean;
}

interface Events {
  state: LinkState;
  server: ServerInfo | null;
  message: ServerMessage;
  status: ServerStatus;
  credentials: Credentials;
  error: string;
}

type Handler<K extends keyof Events> = (payload: Events[K]) => void;

const RECONNECT_BASE_MS = 1_500;
const RECONNECT_MAX_MS = 15_000;

export class LinkClient {
  state: LinkState = 'idle';
  server: ServerInfo | null = null;
  credentials: Credentials | null = null;
  transport: 'wifi' | 'usb' = 'wifi';
  activeHost = '';
  deviceInfo: DeviceInfo;

  private ws: WebSocket | null = null;
  private sealer: Sealer | null = null;
  private serverPub = '';
  private nonce = '';
  private pendingTicket: PairTicket | null = null;
  private handlers = new Map<keyof Events, Set<(payload: unknown) => void>>();
  private reconnectTimer: number | null = null;
  private attempt = 0;
  private stopped = false;
  private pingTimer: number | null = null;

  constructor(credentials: Credentials | null) {
    this.credentials = credentials;
    this.deviceInfo = {
      id: `android-${Math.random().toString(36).slice(2, 10)}`,
      name: 'Android phone',
      platform: 'android',
    };
  }

  on<K extends keyof Events>(event: K, handler: Handler<K>): () => void {
    const cast = handler as (payload: unknown) => void;
    const set = this.handlers.get(event) ?? new Set<(payload: unknown) => void>();
    set.add(cast);
    this.handlers.set(event, set);
    return () => set.delete(cast);
  }

  private emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        handler(payload);
      } catch (err) {
        console.warn('[openlink] handler failed', err);
      }
    }
  }

  private setState(state: LinkState): void {
    this.state = state;
    this.emit('state', state);
  }

  async initDeviceInfo(): Promise<void> {
    try {
      if (isAndroid) {
        const info = await Native.getDeviceInfo();
        this.deviceInfo = {
          id: info.id || this.deviceInfo.id,
          name: info.name,
          model: info.model,
          platform: 'android',
        };
      } else {
        this.deviceInfo = {
          id: this.credentials?.deviceId ?? this.deviceInfo.id,
          name: 'Browser (dev)',
          platform: 'web',
        };
      }
    } catch {
      /* keep defaults */
    }
    if (this.credentials) this.deviceInfo.id = this.credentials.deviceId;
  }

  private candidateHosts(): string[] {
    if (this.pendingTicket) {
      const hosts = [...this.pendingTicket.hosts];
      return this.pendingTicket.usb ? ['127.0.0.1', ...hosts] : hosts;
    }
    if (!this.credentials) return [];
    const hosts = [...this.credentials.hosts];
    // USB-C boost: adb reverse maps the phone's loopback onto the host server.
    return ['127.0.0.1', ...hosts];
  }

  private get port(): number {
    return this.pendingTicket?.port ?? this.credentials?.port ?? 8765;
  }

  private connecting: Promise<void> | null = null;

  async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async doConnect(): Promise<void> {
    const hosts = this.candidateHosts();
    if (!hosts.length) {
      this.setState('idle');
      return;
    }
    this.stopped = false;
    this.setState('connecting');
    this.clearReconnect();
    const winner = await this.openFirst(hosts, this.port);
    if (!winner) {
      this.setState('offline');
      this.scheduleReconnect();
      return;
    }
    this.ws = winner.ws;
    this.activeHost = winner.host;
    this.transport = /^(127\.0\.0\.1|localhost|::1)$/.test(winner.host) ? 'usb' : 'wifi';
  }

  async pair(ticket: PairTicket): Promise<void> {
    this.pendingTicket = ticket;
    await this.connect();
    if (this.state === 'idle') {
      this.setState('offline');
      this.emit('error', 'no address to connect to');
    }
  }

  /**
   * Races every candidate address and keeps the first socket that opens. A
   * stale virtual adapter or a blocked port used to cost a full timeout each,
   * which made scanning the QR feel broken.
   */
  private openFirst(hosts: string[], port: number): Promise<{ ws: WebSocket; host: string } | null> {
    return new Promise((resolve) => {
      let settled = false;
      const sockets: WebSocket[] = [];
      const finish = (winner: { ws: WebSocket; host: string } | null): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        for (const socket of sockets) {
          if (winner && socket === winner.ws) continue;
          socket.onopen = null;
          socket.onerror = null;
          socket.onclose = null;
          socket.onmessage = null;
          try {
            socket.close();
          } catch {
            /* already closed */
          }
        }
        resolve(winner);
      };
      const timer = window.setTimeout(() => finish(null), 4_500);

      for (const host of hosts) {
        let socket: WebSocket;
        try {
          socket = new WebSocket(`ws://${host}:${port}/ws`);
        } catch {
          continue;
        }
        sockets.push(socket);
        socket.onerror = () => {
          /* the timeout or a sibling socket decides */
        };
        socket.onclose = () => {
          /* losers close silently */
        };
        socket.onopen = () => {
          if (settled) {
            try {
              socket.close();
            } catch {
              /* ignore */
            }
            return;
          }
          // Attach the frame handler in the same task as the open event, before
          // the host's hello frame can arrive.
          socket.onmessage = (event) => void this.onFrame(String(event.data));
          socket.onerror = null;
          this.ws = socket;
          socket.onclose = () => {
            if (this.ws !== socket) return;
            this.sealer = null;
            this.setState('offline');
            this.scheduleReconnect();
          };
          finish({ ws: socket, host });
        };
      }
      if (!sockets.length) finish(null);
    });
  }

  private async onFrame(raw: string): Promise<void> {
    let frame: PlainFrame & { t: string };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    switch (frame.t) {
      case 'server.hello': {
        const hello = frame as Extract<PlainFrame, { t: 'server.hello' }>;
        this.server = hello.server;
        this.serverPub = hello.server.pubKey;
        this.nonce = hello.nonce;
        this.emit('server', hello.server);
        this.startPing();
        if (this.pendingTicket) await this.doPair(hello.nonce);
        else if (this.credentials) await this.doAuth();
        else this.setState('idle');
        break;
      }
      case 'pair.accept': {
        const accept = frame as Extract<PlainFrame, { t: 'pair.accept' }>;
        if (!this.ephemeral) {
          this.emit('error', 'pairing without key material');
          break;
        }
        // Same ephemeral key whose SPKI went out in pair.request: the host
        // derived its side of the ECDH from exactly that value.
        const key = await deriveSessionKey(this.ephemeral.privateKey, this.serverPub, accept.pairSecret);
        this.sealer = new Sealer(key);
        const creds: Credentials = {
          deviceId: accept.deviceId,
          token: accept.token,
          pairSecret: accept.pairSecret,
          serverName: accept.serverName,
          hosts: this.pendingTicket?.hosts ?? [],
          port: this.pendingTicket?.port ?? 8765,
          publicKey: await identityPublicKey(),
          pairedAt: Date.now(),
        };
        this.credentials = creds;
        this.deviceInfo.id = creds.deviceId;
        this.pendingTicket = null;
        this.emit('credentials', creds);
        this.setState('online');
        this.requestInitialState();
        break;
      }
      case 'pair.reject': {
        const reason = (frame as { reason?: string }).reason ?? 'code';
        this.pendingTicket = null;
        this.setState('error');
        this.emit('error', `pair.reject:${reason}`);
        this.disconnect();
        break;
      }
      case 'auth.ok': {
        if (!this.credentials) return;
        const key = await deriveSessionKey(this.ephemeral!.privateKey, this.serverPub, this.credentials.pairSecret);
        this.sealer = new Sealer(key);
        this.setState('online');
        this.requestInitialState();
        break;
      }
      case 'auth.reject':
        this.setState('error');
        this.emit('error', 'auth.reject');
        break;
      case 'sealed': {
        if (!this.sealer) return;
        try {
          const message = (await this.sealer.open(frame as unknown as { n: number; d: string })) as ServerMessage;
          this.emit('message', message);
          if (message.t === 'status') this.emit('status', message.status);
        } catch {
          this.sealer = null;
          this.setState('offline');
        }
        break;
      }
      case 'pong':
        break;
      default:
        break;
    }
  }

  private ephemeral: CryptoKeyPair | null = null;

  private async doPair(nonce: string): Promise<void> {
    if (!this.pendingTicket) return;
    this.setState('pairing');
    this.ephemeral = await generateEphemeral();
    const pubKey = await exportSpki(this.ephemeral.publicKey);
    const idPubKey = await identityPublicKey();
    this.sendRaw({
      t: 'pair.request',
      code: this.pendingTicket.code,
      device: { ...this.deviceInfo, platform: 'android' },
      pubKey,
      idPubKey,
    });
    void nonce;
  }

  private async doAuth(): Promise<void> {
    if (!this.credentials) return;
    this.ephemeral = await generateEphemeral();
    const pubKey = await exportSpki(this.ephemeral.publicKey);
    const ts = Date.now();
    const signature = await signIdentity(
      `${this.nonce}:${ts}:${pubKey}`,
      `Sign in to ${this.credentials.serverName}`,
    );
    this.sendRaw({
      t: 'auth',
      deviceId: this.credentials.deviceId,
      token: this.credentials.token,
      pubKey,
      nonce: this.nonce,
      ts,
      sig: signature,
    });
  }

  private sendRaw(frame: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  /** HTTP origin used for file bytes (same port as the encrypted control link). */
  get httpBase(): string {
    return `http://${this.activeHost || '127.0.0.1'}:${this.port}`;
  }

  get token(): string {
    return this.credentials?.token ?? '';
  }

  async send(message: ClientMessage): Promise<void> {
    if (!this.sealer) throw new Error('not connected');
    this.sendRaw(await this.sealer.seal(message));
  }

  private startPing(): void {
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => this.sendRaw({ t: 'ping', ts: Date.now() }), 15_000);
  }

  private requestInitialState(): void {
    void this.send({ t: 'telemetry.subscribe', enabled: true }).catch(() => undefined);
    void this.send({ t: 'media.subscribe', enabled: true }).catch(() => undefined);
    void this.send({ t: 'clipboard.get' }).catch(() => undefined);
    void this.send({ t: 'macro.list' }).catch(() => undefined);
    void this.send({ t: 'status.get' }).catch(() => undefined);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(6, this.attempt++));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      if (this.credentials || this.pendingTicket) void this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  disconnect(): void {
    this.stopped = true;
    this.clearReconnect();
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.sealer = null;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.setStatusIdle();
  }

  private setStatusIdle(): void {
    if (this.state !== 'idle') this.setState('offline');
  }

  /** Attempt a fresh connection after the user changed networks. */
  async rescan(): Promise<void> {
    this.attempt = 0;
    this.disconnect();
    this.stopped = false;
    await this.connect();
  }

  forget(): void {
    this.disconnect();
    this.credentials = null;
    this.setState('idle');
  }
}
