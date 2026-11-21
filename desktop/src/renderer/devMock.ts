/**
 * Dev-only mock of the preload bridge, so the Tactile Minimalism UI can be
 * reviewed in a browser without Windows, Electron or a paired phone.
 *
 * Loaded exclusively when `window.openlink` is absent AND `import.meta.env.DEV`
 * is true, so it never ships in the packaged app.
 */
import QRCode from 'qrcode';
import type { ClipboardEntry, Macro, NowPlaying, ServerStatus, Telemetry } from '../../../shared/protocol';
import type { DesktopSettings, OpenLinkApi, PairingTicket, TransferSummary } from './types';

const MACROS: Macro[] = [
  { id: 'preset-mic', label: 'Mute mic', labelDe: 'Mikro stumm', icon: 'mic-off', tint: 'red', action: { kind: 'keys', keys: 'ctrl+shift+m' } },
  { id: 'preset-discord', label: 'Discord mute', labelDe: 'Discord stumm', icon: 'headset', tint: 'violet', action: { kind: 'keys', keys: 'ctrl+shift+m' } },
  { id: 'preset-record', label: 'Record', labelDe: 'Aufnahme', icon: 'record', tint: 'amber', action: { kind: 'keys', keys: 'win+alt+r' } },
  { id: 'preset-lock', label: 'Lock PC', labelDe: 'PC sperren', icon: 'lock', tint: 'neutral', action: { kind: 'power', action: 'lock' } },
  { id: 'preset-screenoff', label: 'Screen off', labelDe: 'Bildschirm aus', icon: 'display-off', tint: 'neutral', action: { kind: 'power', action: 'display-off' } },
  { id: 'preset-playpause', label: 'Play / Pause', labelDe: 'Play / Pause', icon: 'play', tint: 'ice', action: { kind: 'keys', keys: 'media-playpause' } },
];

const listeners = new Map<string, Set<(payload: unknown) => void>>();

function emit(channel: string, payload: unknown): void {
  for (const handler of listeners.get(channel) ?? []) handler(payload);
}

function on(channel: string, cb: (payload: unknown) => void): () => void {
  const set = listeners.get(channel) ?? new Set();
  set.add(cb);
  listeners.set(channel, set);
  return () => set.delete(cb);
}

let tick = 0;
const started = Date.now();

function sample(): Telemetry {
  tick++;
  const load = 18 + Math.sin(tick / 7) * 14 + Math.random() * 6;
  const temp = 54 + load * 0.32 + Math.random();
  return {
    ts: Date.now(),
    cpu: {
      tempC: Number(temp.toFixed(1)),
      loadPct: Number(load.toFixed(1)),
      clockMhz: 3600 + Math.round(Math.random() * 900),
      powerW: Number((38 + load * 0.9).toFixed(1)),
      fanRpm: 980 + Math.round(load * 12),
      source: 'librehardwaremonitor',
      name: 'AMD Ryzen 7 7800X3D',
      cores: 16,
    },
    gpu: {
      name: 'NVIDIA GeForce RTX 4070',
      tempC: Number((48 + load * 0.4).toFixed(1)),
      loadPct: Number(Math.min(99, load * 1.4).toFixed(1)),
      clockMhz: 2410,
      powerW: Number((52 + load).toFixed(1)),
      fanRpm: 46,
      vramUsedMb: 4820,
      vramTotalMb: 12282,
      source: 'nvidia-smi',
    },
    mem: { usedMb: 14336, totalMb: 32768, swapUsedMb: 1024 },
    net: { downBps: 18_400_000 + Math.random() * 2_000_000, upBps: 1_240_000, iface: 'Ethernet', ssid: null },
    audio: { volume: 42, muted: false },
    battery: { pct: null, charging: null },
    uptimeS: 360_000 + Math.floor((Date.now() - started) / 1000),
  };
}

const settings: DesktopSettings = {
  lang: 'en',
  port: 8765,
  serverName: 'DESKTOP-9F2A',
  autosyncScreenshots: true,
  autosyncPhotos: true,
  startup: false,
  closeToTray: true,
  unlockArmed: false,
  requireBiometric: true,
  macros: MACROS,
  receiveDir: 'C:\\Users\\you\\Downloads\\OpenLink',
  screenshotDir: 'C:\\Users\\you\\Pictures\\Screenshots',
  devices: [
    { id: 'mock-device', name: 'Pixel 8', model: 'Google Pixel 8', platform: 'android', lastSeen: Date.now() - 4_000, unlockEnrolled: false },
  ],
  unlockStatus: { enrolled: false, armed: false, lastAt: null, elevated: false, taskInstalled: true, error: null },
  clipboard: [],
  transfers: [],
  secureStorage: true,
};

const clipboard: ClipboardEntry[] = [
  { id: 'c1', text: 'https://github.com/AeroBaden/OpenLink', ts: Date.now() - 65_000, origin: 'phone' },
  { id: 'c2', text: 'adb reverse tcp:8765 tcp:8765', ts: Date.now() - 240_000, origin: 'pc' },
  { id: 'c3', text: 'Grüße aus dem OLED-Standby-Modus', ts: Date.now() - 600_000, origin: 'phone' },
];

const transfers: TransferSummary[] = [
  { id: 't1', name: 'Screenshot 2026-11-21 141244.png', size: 2_318_221, direction: 'in', ts: Date.now() - 30_000, bps: 0, status: 'done', savedPath: 'C:\\Users\\you\\Downloads\\OpenLink' },
  { id: 't2', name: 'afterburner-capture.mp4', size: 88_122_311, direction: 'out', ts: Date.now() - 120_000, bps: 0, status: 'done' },
];

let pairing: PairingTicket | null = null;

async function issuePairing(): Promise<PairingTicket> {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  const uri =
    `openlink://pair?v=1&port=8765&code=${code}&hosts=192.168.1.42%2C127.0.0.1` +
    `&name=DESKTOP-9F2A&fp=1a2b3c4d5e6f&usb=0`;
  const dataUrl = await QRCode.toDataURL(uri, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 512,
    color: { dark: '#000000', light: '#ffffff' },
  });
  pairing = { code, expiresAt: Date.now() + 120_000, uri, dataUrl };
  return pairing;
}

function status(): ServerStatus {
  return {
    device: { id: 'mock-device', name: 'Pixel 8', model: 'Google Pixel 8', platform: 'android' },
    transport: 'wifi',
    serverInfo: {
      id: '1a2b3c4d5e6f',
      name: 'DESKTOP-9F2A',
      version: '1.0.0',
      platform: 'windows',
      pubKey: '',
      protocol: 1,
      pairing: Boolean(pairing),
    },
    pairingCode: pairing?.code ?? null,
    pairingExpiresAt: pairing?.expiresAt ?? null,
    lanAddresses: ['192.168.1.42'],
    port: 8765,
    adb: { present: false, serial: null, reversed: false },
    unlock: { enrolled: false, armed: false, lastAt: null },
    autosync: { screenshots: true, photos: true },
  };
}

const media: NowPlaying = {
  ts: Date.now(),
  title: 'Windowlicker',
  artist: 'Aphex Twin',
  app: 'Spotify.exe',
  playing: true,
  positionS: 128,
  durationS: 366,
};

const state = { ...settings };

const api: OpenLinkApi = {
  status: async () => status(),
  settings: async () => ({ ...state, clipboard, transfers }),
  updateSettings: async (patch) => {
    Object.assign(state, patch);
    emit('settings', { ...state, clipboard, transfers });
    return { ...state, clipboard, transfers };
  },
  issuePairing,
  revokePairing: async () => {
    pairing = null;
    return status();
  },
  resetPairing: async () => {
    state.devices = [];
    return { ...state, clipboard, transfers };
  },
  saveMacro: async (macro) => {
    const index = state.macros.findIndex((m) => m.id === macro.id);
    if (index >= 0) state.macros[index] = macro;
    else state.macros = [...state.macros, macro];
    return state.macros;
  },
  deleteMacro: async (id) => {
    state.macros = state.macros.filter((m) => m.id !== id);
    return state.macros;
  },
  runMacro: async () => true,
  clipboard: async () => clipboard,
  pushClipboard: async (text) => {
    const entry: ClipboardEntry = { id: `mock-${Date.now()}`, text, ts: Date.now(), origin: 'pc' };
    clipboard.unshift(entry);
    emit('clipboard', clipboard);
    return entry;
  },
  removeClipboard: async (id) => {
    const index = clipboard.findIndex((item) => item.id === id);
    if (index >= 0) clipboard.splice(index, 1);
    emit('clipboard', clipboard);
    return clipboard;
  },
  clearClipboard: async () => {
    clipboard.length = 0;
    emit('clipboard', []);
    return [];
  },
  telemetry: async () => sample(),
  media: async () => media,
  mediaCommand: async () => undefined,
  openUrl: async () => undefined,
  pickFiles: async () => [{ id: 'mock-pick', name: 'quarterly-report.pdf' }],
  pushFiles: async (paths) => {
    const pushed = paths.map((filePath, index) => {
      const name = filePath.split(/[\\/]/).pop() ?? `file-${index}`;
      transfers.unshift({ id: `mock-${Date.now()}-${index}`, name, size: 4_400_000, direction: 'in', ts: Date.now(), bps: 42_000_000, status: 'done' });
      return { id: `mock-${index}`, name };
    });
    emit('transfer', { id: 'mock', received: 1, total: 1, bps: 0 });
    return pushed;
  },
  reveal: async () => undefined,
  openReceiveDir: async () => undefined,
  rtcSend: async () => true,
  notifyReply: async () => undefined,
  enrollUnlock: async () => ({ ok: false, error: 'Mock mode: enrollment needs Windows + admin rights.' }),
  armUnlock: async (armed) => {
    state.unlockArmed = armed;
    return status();
  },
  openLogs: async () => undefined,
  pathForFile: (file) => file.name,
  on,
};

export function installDevMock(): OpenLinkApi {
  Object.defineProperty(window, 'openlink', { value: api, configurable: true });
  // The preview starts in the interesting state: a live pairing card to scan.
  void issuePairing().then((ticket) => emit('pairing', ticket));
  emit('status', status());
  emit('clipboard', clipboard);
  emit('media', media);
  emit('telemetry', sample());
  setInterval(() => emit('telemetry', sample()), 1_000);
  setInterval(() => {
    media.positionS = (media.positionS + 1) % media.durationS;
  }, 1_000);
  return api;
}
