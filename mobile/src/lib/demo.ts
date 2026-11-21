/**
 * Dev-only demo data so the Android UI can be rendered and screenshotted in a
 * desktop browser (`?demo`, `?demo=standby`). Never used in a release build:
 * the entry point only calls it under `import.meta.env.DEV`.
 */
import type { ClipboardEntry, Macro, NowPlaying, PhoneNotification, ServerStatus, Telemetry } from '../../../shared/protocol';
import type { Credentials } from './state';

export const demoCredentials: Credentials = {
  deviceId: 'demo-device',
  token: 'demo-token',
  pairSecret: 'demo-secret',
  serverName: 'DESKTOP-9F2A',
  hosts: ['192.168.1.42'],
  port: 8765,
  publicKey: '',
  pairedAt: Date.now(),
};

export const demoStatus: ServerStatus = {
  device: { id: 'demo-device', name: 'Pixel 8', model: 'Google Pixel 8', platform: 'android' },
  transport: 'wifi',
  serverInfo: {
    id: '1a2b3c4d5e6f',
    name: 'DESKTOP-9F2A',
    version: '1.0.0',
    platform: 'windows',
    pubKey: '',
    protocol: 1,
    pairing: false,
  },
  pairingCode: null,
  pairingExpiresAt: null,
  lanAddresses: ['192.168.1.42'],
  port: 8765,
  adb: { present: true, serial: 'R58M12ABCDE', reversed: true },
  unlock: { enrolled: true, armed: true, lastAt: Date.now() - 600_000 },
  autosync: { screenshots: true, photos: true },
};

export const demoMedia: NowPlaying = {
  ts: Date.now(),
  title: 'Windowlicker',
  artist: 'Aphex Twin',
  app: 'Spotify.exe',
  playing: true,
  positionS: 128,
  durationS: 366,
};

export const demoMacros: Macro[] = [
  { id: 'preset-mic', label: 'Mute mic', labelDe: 'Mikro stumm', icon: 'mic-off', tint: 'red', action: { kind: 'keys', keys: 'ctrl+shift+m' } },
  { id: 'preset-discord', label: 'Discord mute', labelDe: 'Discord stumm', icon: 'headset', tint: 'violet', action: { kind: 'keys', keys: 'ctrl+shift+m' } },
  { id: 'preset-record', label: 'Record', labelDe: 'Aufnahme', icon: 'record', tint: 'amber', action: { kind: 'keys', keys: 'win+alt+r' } },
  { id: 'preset-lock', label: 'Lock PC', labelDe: 'PC sperren', icon: 'lock', tint: 'neutral', action: { kind: 'power', action: 'lock' } },
  { id: 'preset-screen', label: 'Screen off', labelDe: 'Bildschirm aus', icon: 'display-off', tint: 'neutral', action: { kind: 'power', action: 'display-off' } },
  { id: 'preset-play', label: 'Play / Pause', labelDe: 'Play / Pause', icon: 'play', tint: 'ice', action: { kind: 'keys', keys: 'media-playpause' } },
];

export const demoClipboard: ClipboardEntry[] = [
  { id: 'c1', text: 'https://github.com/AeroBaden/OpenLink', ts: Date.now() - 65_000, origin: 'phone' },
  { id: 'c2', text: 'adb reverse tcp:8765 tcp:8765', ts: Date.now() - 240_000, origin: 'pc' },
  { id: 'c3', text: 'Grüße aus dem OLED-Standby-Modus', ts: Date.now() - 600_000, origin: 'phone' },
];

export const demoNotifications: PhoneNotification[] = [
  { id: 'n1', app: 'Messages', title: 'Lena', text: 'Bin in zehn Minuten da.', ts: Date.now() - 40_000, canReply: true },
  { id: 'n2', app: 'Signal', title: 'Team', text: 'Build ist grün ✅', ts: Date.now() - 300_000, canReply: true },
];

export function demoSample(tick: number): Telemetry {
  const load = 18 + Math.sin(tick / 7) * 14 + (tick % 3);
  const temp = 54 + load * 0.32;
  return {
    ts: Date.now(),
    cpu: {
      tempC: Number(temp.toFixed(1)),
      loadPct: Number(load.toFixed(1)),
      clockMhz: 3600 + (tick % 9) * 100,
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
    net: { downBps: 18_400_000, upBps: 1_240_000, iface: 'Ethernet', ssid: null },
    audio: { volume: 42, muted: false },
    battery: { pct: null, charging: null },
    uptimeS: 360_000 + tick,
  };
}
