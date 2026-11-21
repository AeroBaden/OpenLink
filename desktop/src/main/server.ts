import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  ClientMessage,
  ClipboardEntry,
  DeviceInfo,
  MacroAction,
  NowPlaying,
  PlainFrame,
  ServerMessage,
  ServerStatus,
  Telemetry,
  Transport,
} from '../../../shared/protocol';
import {
  createEphemeralKey,
  exportPublicKey,
  deriveSessionKey,
  Sealer,
  safetyCode,
  verifyDeviceSignature,
  randomToken,
} from './crypto';
import type { PairingManager } from './pairing';
import type { Store, DeviceRecord } from './store';
import type { TelemetryEngine } from './telemetry';
import type { MediaBridge } from './media';
import type { WindowsAgent } from './agent';
import type { ClipboardSync } from './clipboard';
import type { UnlockService } from './unlock';
import type { FileService } from './files';
import type { AdbBridge } from './adb';
import type { Readable } from 'node:stream';

export interface LinkServerDeps {
  store: Store;
  pairing: PairingManager;
  telemetry: TelemetryEngine;
  media: MediaBridge;
  agent: WindowsAgent;
  clipboard: ClipboardSync;
  unlock: UnlockService;
  files: FileService;
  adb: AdbBridge;
  version: string;
  getStatus: () => ServerStatus;
  log: (message: string) => void;
  /** Push a message to the desktop renderer (already a ServerMessage shape). */
  toRenderer: (message: ServerMessage) => void;
  /** Status changed and the renderer should refresh. */
  onStatus: () => void;
}

interface Connection {
  ws: WebSocket;
  transport: Transport;
  serverKey: ReturnType<typeof createEphemeralKey>;
  serverPub: string;
  nonce: string;
  sealed: boolean;
  sealer: Sealer | null;
  device: DeviceRecord | null;
  wantsTelemetry: boolean;
  wantsMedia: boolean;
  alive: boolean;
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.apk': 'application/vnd.android.package-archive',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
};

function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export class LinkServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private connection: Connection | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private authFailures = 0;
  private boundPort = 0;

  constructor(private readonly deps: LinkServerDeps) {}

  get port(): number {
    return this.boundPort;
  }

  get isPhoneConnected(): boolean {
    return this.connection?.sealed === true;
  }

  get connectedDevice(): DeviceRecord | null {
    return this.connection?.device ?? null;
  }

  /** Actual transport of the live socket (loopback = USB-C via adb reverse). */
  get activeTransport(): Transport | null {
    return this.connection?.sealed ? this.connection.transport : null;
  }

  /* --------------------------------------------------------------- lifecycle */

  async start(port: number): Promise<number> {
    await this.stop();
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '256kb' }));
    app.use((_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      next();
    });

    app.get('/health', (_req, res) => {
      res.json({
        ok: true,
        app: 'openlink',
        version: this.deps.version,
        paired: this.deps.store.settings.paired.length,
        phone: this.isPhoneConnected,
      });
    });

    // Downloads: token-authenticated, short-lived URLs handed out over the WS.
    app.get('/api/file/:token', (req, res) => {
      if (!this.authoriseHttp(req.query.t as string | undefined, req.get('x-ol-token'))) {
        res.status(401).json({ ok: false, error: 'unauthorised' });
        return;
      }
      const entry = this.deps.files.resolve(req.params.token);
      if (!entry) {
        res.status(404).json({ ok: false, error: 'expired' });
        return;
      }
      res.setHeader('Content-Type', entry.mime || mimeFor(entry.path));
      res.setHeader('Content-Length', String(entry.size));
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(entry.name)}`);
      res.sendFile(entry.path, (err) => {
        if (err && !res.headersSent) res.status(500).end();
      });
    });

    // Uploads: raw body streamed straight to disk with progress events.
    app.post('/api/upload', (req, res) => {
      if (!this.authoriseHttp(req.query.t as string | undefined, req.get('x-ol-token'))) {
        res.status(401).json({ ok: false, error: 'unauthorised' });
        return;
      }
      const id = String(req.query.id ?? randomToken(8));
      const name = decodeURIComponent(String(req.query.name ?? 'upload.bin'));
      const size = Number(req.get('content-length') ?? req.query.size ?? 0);
      void this.deps.files
        .receive(id, name, String(req.get('content-type') ?? 'application/octet-stream'), size, req as unknown as Readable)
        .then((result) => {
          res.json({ ok: true, path: result.path, bps: Math.round(result.bps) });
          this.send({
            t: 'file.done',
            id,
            name,
            path: result.path,
          });
        })
        .catch((err: Error) => {
          this.deps.log(`upload failed: ${err.message}`);
          if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
        });
    });

    this.httpServer = http.createServer(app);
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024 * 1024 });

    this.httpServer.on('upgrade', (req, socket, head) => {
      const url = req.url ?? '';
      if (!url.startsWith('/ws')) {
        socket.destroy();
        return;
      }
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.wss!.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));

    this.heartbeat = setInterval(() => {
      for (const client of this.wss?.clients ?? []) {
        const anyClient = client as WebSocket & { isAlive?: boolean };
        if (anyClient.isAlive === false) {
          client.terminate();
          continue;
        }
        anyClient.isAlive = false;
        client.ping();
      }
    }, 20_000);

    const actual = await new Promise<number>((resolve, reject) => {
      this.httpServer!.once('error', reject);
      this.httpServer!.listen(port, '0.0.0.0', () => {
        const address = this.httpServer!.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      });
    }).catch((err: NodeJS.ErrnoException) => {
      this.deps.log(`listen on ${port} failed: ${err.message}`);
      throw err;
    });

    this.boundPort = actual;
    this.deps.log(`listening on 0.0.0.0:${actual}`);
    return actual;
  }

  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.connection?.ws.close(1001, 'host shutting down');
    this.connection = null;
    await new Promise<void>((resolve) => {
      if (!this.httpServer) return resolve();
      this.httpServer.close(() => resolve());
    });
    this.httpServer = null;
    this.wss?.close();
    this.wss = null;
  }

  private authoriseHttp(queryToken: string | undefined, headerToken: string | undefined): boolean {
    const token = queryToken || headerToken;
    if (!token) return false;
    return this.deps.store.settings.paired.some((d) => safeEqual(d.token, token));
  }

  /* ---------------------------------------------------------------- envelope */

  private send(message: ServerMessage): void {
    const conn = this.connection;
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) return;
    if (!conn.sealer) {
      this.raw(conn.ws, message as unknown as PlainFrame);
      return;
    }
    this.raw(conn.ws, conn.sealer.seal(message));
  }

  private raw(ws: WebSocket, frame: PlainFrame | ServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      /* socket closed mid-write */
    }
  }

  /** Send a payload to the phone; returns false when nothing is connected. */
  sendToPhone(message: ServerMessage): boolean {
    if (!this.connection?.sealer) return false;
    this.send(message);
    return true;
  }

  broadcastStatus(): void {
    this.send({ t: 'status', status: this.deps.getStatus() });
  }

  onTelemetry(sample: Telemetry): void {
    if (this.connection?.wantsTelemetry) this.send({ t: 'telemetry', sample });
  }

  onMedia(state: NowPlaying): void {
    if (this.connection?.wantsMedia) this.send({ t: 'media', state });
  }

  onClipboard(items: ClipboardEntry[]): void {
    this.send({ t: 'clipboard', items });
  }

  onClipboardIncoming(entry: ClipboardEntry): void {
    this.send({ t: 'clipboard.incoming', entry });
  }

  onFileProgress(id: string, received: number, total: number, bps: number): void {
    this.send({ t: 'file.progress', id, received, total, bps });
  }

  onScreenshot(name: string, filePath: string): void {
    if (!this.deps.store.settings.autosyncScreenshots) return;
    const entry = this.deps.files.registerOutgoing(filePath, name, mimeFor(filePath));
    if (!entry) return;
    this.send({
      t: 'file.push',
      offer: { id: entry.token, name: entry.name, size: entry.size, mime: entry.mime, direction: 'pc-to-phone' },
      url: `/api/file/${entry.token}`,
    });
    this.deps.toRenderer({ t: 'file.done', id: entry.token, name: entry.name, path: filePath });
  }

  /* -------------------------------------------------------------- connection */

  private onConnection(ws: WebSocket & { isAlive?: boolean }, req: http.IncomingMessage): void {
    const remote = req.socket.remoteAddress ?? '';
    const transport: Transport = /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(remote) ? 'usb' : 'wifi';
    if (this.connection) {
      // One phone at a time keeps the trust model simple.
      this.connection.ws.close(4000, 'replaced by a new connection');
    }
    const serverKey = createEphemeralKey();
    const conn: Connection = {
      ws,
      transport,
      serverKey,
      serverPub: exportPublicKey(serverKey),
      nonce: randomToken(24),
      sealed: false,
      sealer: null,
      device: null,
      wantsTelemetry: true,
      wantsMedia: true,
      alive: true,
    };
    this.connection = conn;
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
      conn.alive = true;
    });

    this.raw(ws, {
      t: 'server.hello',
      server: {
        id: this.deps.pairing.id,
        name: this.deps.store.settings.serverName,
        version: this.deps.version,
        platform: 'windows',
        pubKey: conn.serverPub,
        protocol: 1,
        pairing: this.deps.pairing.active,
      },
      nonce: conn.nonce,
    });

    ws.on('message', (data) => this.onFrame(conn, data.toString()));
    ws.on('close', () => {
      if (this.connection === conn) {
        this.connection = null;
        this.deps.onStatus();
      }
    });
    ws.on('error', () => {
      /* handled by close */
    });
  }

  private onFrame(conn: Connection, raw: string): void {
    let frame: PlainFrame & { t: string };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!frame || typeof frame.t !== 'string') return;

    if (frame.t === 'ping') {
      this.raw(conn.ws, { t: 'pong', ts: (frame as { ts?: number }).ts ?? Date.now() });
      return;
    }

    if (frame.t === 'pair.request') {
      this.handlePair(conn, frame as Extract<PlainFrame, { t: 'pair.request' }>);
      return;
    }
    if (frame.t === 'auth') {
      this.handleAuth(conn, frame as Extract<PlainFrame, { t: 'auth' }>);
      return;
    }
    if (frame.t === 'sealed') {
      if (!conn.sealer) return;
      let inner: ClientMessage;
      try {
        inner = conn.sealer.open(frame as unknown as { n: number; d: string }) as ClientMessage;
      } catch {
        this.raw(conn.ws, { t: 'auth.reject', reason: 'signature' });
        conn.ws.close(4001, 'decrypt failed');
        return;
      }
      void this.dispatch(conn, inner);
    }
  }

  private handlePair(conn: Connection, frame: Extract<PlainFrame, { t: 'pair.request' }>): void {
    const device: DeviceInfo = frame.device;
    const valid =
      typeof frame.code === 'string' &&
      typeof frame.pubKey === 'string' &&
      typeof frame.idPubKey === 'string' &&
      frame.pubKey.length > 40 &&
      frame.idPubKey.length > 40 &&
      Boolean(device?.id) &&
      Boolean(device?.name);
    if (!valid || !this.deps.pairing.consume(frame.code)) {
      this.raw(conn.ws, { t: 'pair.reject', reason: 'code' });
      this.deps.log('pairing rejected: bad or expired code');
      return;
    }
    try {
      const record = this.deps.store.addDevice({
        id: device.id,
        name: device.name.slice(0, 64),
        model: device.model?.slice(0, 64),
        platform: device.platform ?? 'android',
        pubKey: frame.idPubKey,
      });
      conn.device = record;
      conn.sealer = new Sealer(deriveSessionKey(conn.serverKey, frame.pubKey, record.pairSecret));
      conn.sealed = true;
      this.raw(conn.ws, {
        t: 'pair.accept',
        serverName: this.deps.store.settings.serverName,
        token: record.token,
        pairSecret: record.pairSecret,
        sas: safetyCode(frame.code, frame.pubKey, conn.serverPub),
        deviceId: record.id,
      });
      this.deps.log(`paired with ${record.name} (${conn.transport})`);
      this.deps.onStatus();
      this.send({ t: 'status', status: this.deps.getStatus() });
      this.broadcastMacros();
      this.send({ t: 'clipboard', items: this.deps.clipboard.history });
      const latest = this.deps.telemetry.latest;
      if (latest) this.send({ t: 'telemetry', sample: latest });
    } catch (err) {
      this.deps.log(`pairing failed: ${(err as Error).message}`);
      this.raw(conn.ws, { t: 'pair.reject', reason: 'denied' });
    }
  }

  private handleAuth(conn: Connection, frame: Extract<PlainFrame, { t: 'auth' }>): void {
    const record = this.deps.store.findDevice(frame.deviceId);
    if (!record) {
      this.raw(conn.ws, { t: 'auth.reject', reason: 'unknown' });
      return;
    }
    if (this.authFailures > 12) {
      this.raw(conn.ws, { t: 'auth.reject', reason: 'signature' });
      conn.ws.close(4003, 'too many failures');
      return;
    }
    if (!safeEqual(record.token, String(frame.token ?? ''))) {
      this.authFailures++;
      this.raw(conn.ws, { t: 'auth.reject', reason: 'token' });
      return;
    }
    const payload = `${conn.nonce}:${frame.ts}:${frame.pubKey}`;
    if (!verifyDeviceSignature(record.pubKey, payload, frame.sig) || Math.abs(Date.now() - frame.ts) > 120_000) {
      this.authFailures++;
      this.raw(conn.ws, { t: 'auth.reject', reason: 'signature' });
      this.deps.log(`auth signature rejected for ${record.name}`);
      return;
    }
    try {
      conn.sealer = new Sealer(deriveSessionKey(conn.serverKey, record.pubKey, record.pairSecret));
      conn.sealed = true;
      conn.device = record;
      this.deps.store.touchDevice(record.id);
      this.authFailures = 0;
      this.raw(conn.ws, {
        t: 'auth.ok',
        serverName: this.deps.store.settings.serverName,
        deviceId: record.id,
        sas: safetyCode(record.id, record.pubKey, conn.serverPub),
      });
      this.deps.log(`${record.name} connected over ${conn.transport}`);
      this.deps.onStatus();
      this.send({ t: 'status', status: this.deps.getStatus() });
      this.broadcastMacros();
      this.send({ t: 'clipboard', items: this.deps.clipboard.history });
      const latest = this.deps.telemetry.latest;
      if (latest) this.send({ t: 'telemetry', sample: latest });
      const media = this.deps.media.latest;
      if (media.title) this.send({ t: 'media', state: media });
    } catch (err) {
      this.deps.log(`auth failed: ${(err as Error).message}`);
      this.raw(conn.ws, { t: 'auth.reject', reason: 'signature' });
    }
  }

  private broadcastMacros(): void {
    this.send({ t: 'macro.list', macros: this.deps.store.settings.macros });
  }

  /* --------------------------------------------------------------- dispatch */

  private async dispatch(conn: Connection, message: ClientMessage): Promise<void> {
    const device = conn.device;
    if (!device) return;
    const store = this.deps.store;
    try {
      switch (message.t) {
        case 'telemetry.subscribe': {
          conn.wantsTelemetry = Boolean(message.enabled);
          const latest = this.deps.telemetry.latest;
          if (conn.wantsTelemetry && latest) this.send({ t: 'telemetry', sample: latest });
          break;
        }
        case 'media.subscribe': {
          conn.wantsMedia = Boolean(message.enabled);
          if (conn.wantsMedia) this.send({ t: 'media', state: this.deps.media.latest });
          break;
        }
        case 'media.command':
          await this.deps.media.command(message.action);
          break;
        case 'media.seek':
          await this.deps.media.command('seek', message.positionS);
          break;
        case 'clipboard.push': {
          const entry = this.deps.clipboard.pushFromPhone(String(message.text ?? ''));
          this.send({ t: 'clipboard', items: this.deps.clipboard.history });
          this.deps.toRenderer({ t: 'clipboard.incoming', entry });
          break;
        }
        case 'clipboard.get':
          this.send({ t: 'clipboard', items: this.deps.clipboard.history });
          break;
        case 'clipboard.remove':
          this.deps.clipboard.remove(message.id);
          this.send({ t: 'clipboard', items: this.deps.clipboard.history });
          break;
        case 'clipboard.clear':
          this.deps.clipboard.clear();
          this.send({ t: 'clipboard', items: [] });
          break;
        case 'tab.handoff': {
          const url = String(message.url ?? '');
          if (/^https?:\/\//i.test(url)) {
            await this.deps.agent.call({ cmd: 'url', url });
            this.deps.toRenderer({ t: 'tab.offered', url, title: message.title ?? url });
          }
          break;
        }
        case 'url.open': {
          const url = String(message.url ?? '');
          if (/^https?:\/\//i.test(url)) await this.deps.agent.call({ cmd: 'url', url });
          break;
        }
        case 'file.offer': {
          const offer = message.offer;
          if (!offer?.id || !offer.name) break;
          const token = device.token;
          this.send({
            t: 'file.upload',
            id: offer.id,
            url: `/api/upload?id=${encodeURIComponent(offer.id)}&name=${encodeURIComponent(
              offer.name,
            )}&size=${offer.size}&t=${encodeURIComponent(token)}`,
          });
          break;
        }
        case 'photo.push': {
          const saved = this.deps.files.savePhoto(message.photo);
          this.deps.log(`photo saved: ${path.basename(saved)}`);
          this.deps.toRenderer({ t: 'file.done', id: message.photo.id, name: path.basename(saved), path: saved });
          break;
        }
        case 'macro.run': {
          const macro = store.settings.macros.find((m) => m.id === message.id);
          if (!macro) break;
          await this.runMacro(macro.action);
          break;
        }
        case 'macro.list':
          this.broadcastMacros();
          break;
        case 'input.pointer':
          await this.deps.agent.call({ cmd: 'pointer', event: message.event });
          break;
        case 'input.text':
          await this.deps.agent.call({ cmd: 'text', text: String(message.text ?? '').slice(0, 8000) });
          break;
        case 'input.key':
          await this.deps.agent.call({ cmd: 'keys', keys: String(message.combo ?? '') });
          break;
        case 'volume.set':
          await this.deps.agent.call({ cmd: 'volume.set', level: Math.max(0, Math.min(100, message.level)) });
          break;
        case 'volume.mute':
          await this.deps.agent.call({ cmd: 'volume.mute', muted: message.muted });
          break;
        case 'power':
          await this.deps.agent.call({ cmd: 'power', action: message.action });
          break;
        case 'notify.push': {
          const notification = message.notification;
          if (!notification?.id) break;
          this.deps.toRenderer({ t: 'notify.incoming', notification });
          break;
        }
        case 'notify.reply':
          this.send({ t: 'notify.reply', id: message.id, text: message.text });
          break;
        case 'unlock.begin': {
          const status = this.deps.unlock.status(device.id);
          if (!status.armed) {
            this.send({ t: 'unlock.result', ok: false, reason: 'not armed' });
            break;
          }
          if (!status.enrolled) {
            this.send({ t: 'unlock.result', ok: false, reason: 'not enrolled' });
            break;
          }
          const challenge = this.deps.unlock.issueChallenge(device.id);
          this.send({ t: 'unlock.challenge', nonce: challenge.nonce, expiresAt: challenge.expiresAt });
          break;
        }
        case 'unlock.signature': {
          const result = await this.deps.unlock.submit(
            device,
            message.nonce,
            Number(message.ts),
            String(message.signature ?? ''),
          );
          this.send({ t: 'unlock.result', ok: result.ok, reason: result.reason });
          this.deps.onStatus();
          break;
        }
        case 'unlock.arm':
          store.update({ unlockArmed: Boolean(message.armed) });
          this.deps.log(`remote unlock ${message.armed ? 'armed' : 'disarmed'}`);
          this.deps.onStatus();
          this.broadcastStatus();
          break;
        case 'unlock.register':
          this.broadcastStatus();
          break;
        case 'rtc.signal':
          this.deps.toRenderer({
            t: 'rtc.signal',
            kind: message.kind,
            stream: message.stream,
            sdp: message.sdp,
            candidate: message.candidate,
          });
          break;
        case 'status.get':
          this.send({ t: 'status', status: this.deps.getStatus() });
          break;
        default:
          this.send({ t: 'error', message: `unknown message: ${(message as { t: string }).t}` });
      }
    } catch (err) {
      const msg = (err as Error).message.slice(0, 200);
      this.send({ t: 'error', message: msg });
      this.deps.log(`dispatch ${message.t} failed: ${msg}`);
    }
  }

  async runMacroById(id: string): Promise<boolean> {
    const macro = this.deps.store.settings.macros.find((m) => m.id === id);
    if (!macro) return false;
    await this.runMacro(macro.action);
    return true;
  }

  private async runMacro(action: MacroAction): Promise<void> {
    switch (action.kind) {
      case 'keys':
        await this.deps.agent.call({ cmd: 'keys', keys: action.keys });
        break;
      case 'text':
        await this.deps.agent.call({ cmd: 'text', text: action.text });
        break;
      case 'launch':
        await this.deps.agent.call({ cmd: 'launch', path: action.path, args: action.args });
        break;
      case 'url':
        await this.deps.agent.call({ cmd: 'url', url: action.url });
        break;
      case 'volume':
        if (action.level === 'mute') await this.deps.agent.call({ cmd: 'volume.mute', muted: true });
        else if (action.level === 'unmute') await this.deps.agent.call({ cmd: 'volume.mute', muted: false });
        else if (action.level === 'up') await this.deps.agent.call({ cmd: 'keys', keys: 'volume-up' });
        else if (action.level === 'down') await this.deps.agent.call({ cmd: 'keys', keys: 'volume-down' });
        else await this.deps.agent.call({ cmd: 'volume.set', level: action.level });
        break;
      case 'power':
        await this.deps.agent.call({ cmd: 'power', action: action.action });
        break;
      default:
        break;
    }
  }
}
