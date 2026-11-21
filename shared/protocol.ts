/**
 * OpenLink wire protocol — shared by the Windows host (/desktop) and the Android client (/mobile).
 * Pure types and constants only: no runtime dependencies, safe to bundle in a WebView.
 */

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 8765;
/** USB-C ADB boost: `adb reverse tcp:8765 tcp:8765` maps the phone's localhost to the PC server. */
export const USB_PORT = 8765;
export const PAIR_CODE_TTL_MS = 120_000;
export const PAIR_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CLIPBOARD_HISTORY_LIMIT = 20;
export const TELEMETRY_INTERVAL_MS = 1_000;
export const IDLE_STANDBY_MS = 15_000;

export type Lang = 'en' | 'de';
export type Platform = 'android' | 'windows' | 'web';
export type Transport = 'wifi' | 'usb';

export interface DeviceInfo {
  id: string;
  name: string;
  model?: string;
  platform: Platform;
}

export interface ServerInfo {
  id: string;
  name: string;
  version: string;
  platform: Platform;
  /** SPKI (DER, base64) of the host's P-256 session key. */
  pubKey: string;
  protocol: number;
  /** True while the QR/config window accepts new pairings. */
  pairing: boolean;
}

export interface ThermalSample {
  tempC: number | null;
  loadPct: number | null;
  clockMhz: number | null;
  powerW: number | null;
  fanRpm: number | null;
  /** Where the numbers came from, so the UI can be honest about gaps. */
  source: 'librehardwaremonitor' | 'systeminformation' | 'nvidia-smi' | 'wmi' | 'none';
}

export interface GpuSample extends ThermalSample {
  name: string | null;
  vramUsedMb: number | null;
  vramTotalMb: number | null;
}

export interface Telemetry {
  ts: number;
  cpu: ThermalSample & { name: string | null; cores: number | null };
  gpu: GpuSample;
  mem: { usedMb: number; totalMb: number; swapUsedMb: number | null };
  net: { downBps: number; upBps: number; iface: string | null; ssid: string | null };
  audio: { volume: number | null; muted: boolean | null };
  battery: { pct: number | null; charging: boolean | null };
  uptimeS: number;
}

export interface NowPlaying {
  ts: number;
  title: string;
  artist: string;
  app: string;
  playing: boolean;
  positionS: number;
  durationS: number;
  artDataUrl?: string | null;
}

export interface ClipboardEntry {
  id: string;
  text: string;
  ts: number;
  origin: 'pc' | 'phone';
}

export type MacroAction =
  | { kind: 'keys'; keys: string }
  | { kind: 'text'; text: string }
  | { kind: 'launch'; path: string; args?: string }
  | { kind: 'url'; url: string }
  | { kind: 'volume'; level: number | 'mute' | 'unmute' | 'up' | 'down' }
  | { kind: 'power'; action: 'lock' | 'sleep' | 'display-off' };
export type MacroTint = 'green' | 'amber' | 'red' | 'ice' | 'violet' | 'neutral';

export interface Macro {
  id: string;
  label: string;
  labelDe?: string;
  icon: string;
  tint: MacroTint;
  action: MacroAction;
  confirm?: boolean;
}

export interface PhoneNotification {
  id: string;
  app: string;
  title: string;
  text: string;
  ts: number;
  canReply: boolean;
}

export interface ServerStatus {
  device: DeviceInfo | null;
  transport: Transport | null;
  serverInfo: ServerInfo;
  pairingCode: string | null;
  pairingExpiresAt: number | null;
  lanAddresses: string[];
  port: number;
  adb: { present: boolean; serial: string | null; reversed: boolean };
  unlock: { enrolled: boolean; armed: boolean; lastAt: number | null };
  autosync: { screenshots: boolean; photos: boolean };
}

/* ------------------------------------------------------------------ frames */

/** Plaintext frames, exchanged before the encrypted session is established. */
export type PlainFrame =
  | { t: 'server.hello'; server: ServerInfo; nonce: string }
  | {
      t: 'pair.request';
      code: string;
      device: DeviceInfo;
      /** Ephemeral ECDH key (SPKI, base64) for this session. */
      pubKey: string;
      /** Long-lived ECDSA identity key (SPKI, base64) verified on reconnect. */
      idPubKey: string;
    }
  | { t: 'pair.accept'; serverName: string; token: string; pairSecret: string; sas: string; deviceId: string }
  | { t: 'pair.reject'; reason: 'code' | 'expired' | 'denied' | 'version' }
  | { t: 'auth'; deviceId: string; token: string; pubKey: string; nonce: string; ts: number; sig: string }
  | { t: 'auth.ok'; serverName: string; deviceId: string; sas: string }
  | { t: 'auth.reject'; reason: 'unknown' | 'signature' | 'token' | 'version' }
  | { t: 'sealed'; n: number; d: string }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number };

/* ------------------------------------------------------- encrypted payloads */

export type ClientMessage =
  | { t: 'telemetry.subscribe'; enabled: boolean }
  | { t: 'media.subscribe'; enabled: boolean }
  | { t: 'media.command'; action: 'playpause' | 'next' | 'prev' }
  | { t: 'media.seek'; positionS: number }
  | { t: 'clipboard.push'; text: string }
  | { t: 'clipboard.get' }
  | { t: 'clipboard.remove'; id: string }
  | { t: 'clipboard.clear' }
  | { t: 'tab.handoff'; url: string; title: string }
  | { t: 'url.open'; url: string }
  | { t: 'file.offer'; offer: FileOffer }
  | { t: 'photo.push'; photo: PhotoRef }
  | { t: 'macro.run'; id: string }
  | { t: 'macro.list' }
  | { t: 'input.pointer'; event: PointerEvent_ }
  | { t: 'input.text'; text: string }
  | { t: 'input.key'; combo: string }
  | { t: 'volume.set'; level: number }
  | { t: 'volume.mute'; muted: boolean }
  | { t: 'power'; action: 'lock' | 'sleep' | 'display-off' }
  | { t: 'notify.reply'; id: string; text: string }
  | { t: 'notify.push'; notification: PhoneNotification }
  | { t: 'unlock.begin' }
  | { t: 'unlock.register'; deviceId: string }
  | { t: 'unlock.arm'; armed: boolean }
  | { t: 'unlock.signature'; nonce: string; signature: string; ts: number }
  | { t: 'rtc.signal'; kind: 'offer' | 'answer' | 'ice'; stream: RtcStream; sdp?: string; candidate?: string }
  | { t: 'rtc.request'; stream: RtcStream }
  | { t: 'status.get' };

export type PointerEvent_ =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'click'; button: 'left' | 'right' | 'middle'; count?: number }
  | { kind: 'down' | 'up'; button: 'left' | 'right' }
  | { kind: 'scroll'; dx: number; dy: number };

export type RtcStream = 'pc-screen' | 'pc-audio' | 'phone-camera';

export interface FileOffer {
  id: string;
  name: string;
  size: number;
  mime: string;
  direction: 'pc-to-phone' | 'phone-to-pc';
}

export interface PhotoRef {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Base64 payload (bounded client-side to ~8 MB). */
  data: string;
  takenAt: number;
}

export type ServerMessage =
  | { t: 'status'; status: ServerStatus }
  | { t: 'telemetry'; sample: Telemetry }
  | { t: 'media'; state: NowPlaying }
  | { t: 'clipboard'; items: ClipboardEntry[] }
  | { t: 'clipboard.incoming'; entry: ClipboardEntry }
  | { t: 'file.progress'; id: string; received: number; total: number; bps: number }
  | { t: 'file.done'; id: string; path?: string; name: string }
  | { t: 'file.push'; offer: FileOffer; url: string }
  | { t: 'file.upload'; id: string; url: string }
  | { t: 'tab.offered'; url: string; title: string }
  | { t: 'macro.list'; macros: Macro[] }
  | { t: 'notify.incoming'; notification: PhoneNotification; screenshot?: string }
  | { t: 'notify.reply'; id: string; text: string }
  | { t: 'unlock.challenge'; nonce: string; expiresAt: number }
  | { t: 'unlock.result'; ok: boolean; reason?: string }
  | { t: 'rtc.signal'; kind: 'offer' | 'answer' | 'ice'; stream: RtcStream; sdp?: string; candidate?: string }
  | { t: 'rtc.request'; stream: RtcStream }
  | { t: 'error'; message: string; ref?: string }
  | { t: 'ack'; ref: string; ok: boolean };

/** Everything above travels inside `sealed` frames; helper for narrowing. */
export function isClientMessage(v: unknown): v is ClientMessage {
  return !!v && typeof v === 'object' && typeof (v as { t?: unknown }).t === 'string';
}
