import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomToken } from './crypto';
import type { Lang, Macro, Platform } from '../../../shared/protocol';

export interface DeviceRecord {
  id: string;
  name: string;
  model?: string;
  platform: Platform;
  /** SPKI (base64) of the phone's hardware-backed P-256 key. */
  pubKey: string;
  /** Long-lived bearer token issued at pair time. */
  token: string;
  /** HKDF salt for session keys, unique per device. */
  pairSecret: string;
  createdAt: number;
  lastSeen: number | null;
  /** True once a WP_ACCOUNT-style unlock key has been registered. */
  unlockEnrolled: boolean;
}

export interface Settings {
  lang: Lang;
  port: number;
  serverName: string;
  autosyncScreenshots: boolean;
  autosyncPhotos: boolean;
  startup: boolean;
  closeToTray: boolean;
  unlockArmed: boolean;
  requireBiometric: boolean;
  macros: Macro[];
  paired: DeviceRecord[];
  receiveDir: string;
  screenshotDir: string;
}

interface SecretBag {
  /** Values are base64 of DPAPI-sealed buffers when `enc` is true. */
  enc: boolean;
  items: Record<string, string>;
}

interface FileShape {
  version: 1;
  settings: Settings;
  secrets: SecretBag;
}

const DEFAULT_MACROS: Macro[] = [
  {
    id: 'preset-mic',
    label: 'Mute mic',
    labelDe: 'Mikro stumm',
    icon: 'mic-off',
    tint: 'red',
    action: { kind: 'keys', keys: 'ctrl+shift+m' },
  },
  {
    id: 'preset-discord',
    label: 'Discord mute',
    labelDe: 'Discord stumm',
    icon: 'headset',
    tint: 'violet',
    action: { kind: 'keys', keys: 'ctrl+shift+m' },
  },
  {
    id: 'preset-record',
    label: 'Record',
    labelDe: 'Aufnahme',
    icon: 'record',
    tint: 'amber',
    action: { kind: 'keys', keys: 'win+alt+r' },
  },
  {
    id: 'preset-lock',
    label: 'Lock PC',
    labelDe: 'PC sperren',
    icon: 'lock',
    tint: 'neutral',
    action: { kind: 'power', action: 'lock' },
  },
  {
    id: 'preset-screenoff',
    label: 'Screen off',
    labelDe: 'Bildschirm aus',
    icon: 'display-off',
    tint: 'neutral',
    action: { kind: 'power', action: 'display-off' },
  },
  {
    id: 'preset-playpause',
    label: 'Play / Pause',
    labelDe: 'Play / Pause',
    icon: 'play',
    tint: 'ice',
    action: { kind: 'keys', keys: 'media-playpause' },
  },
];

function defaultSettings(): Settings {
  const home = os.homedir();
  return {
    lang: 'en',
    port: 8765,
    serverName: os.hostname().replace(/-?desktop$/i, '') || 'Windows PC',
    autosyncScreenshots: true,
    autosyncPhotos: true,
    startup: false,
    closeToTray: true,
    unlockArmed: false,
    requireBiometric: true,
    macros: DEFAULT_MACROS,
    paired: [],
    receiveDir: path.join(app.getPath('downloads'), 'OpenLink'),
    screenshotDir: path.join(home, 'Pictures', 'Screenshots'),
  };
}

class Store {
  private readonly file: string;
  private data: FileShape;

  constructor() {
    this.file = path.join(app.getPath('userData'), 'openlink.json');
    this.data = this.load();
  }

  private load(): FileShape {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<FileShape>;
      const settings = { ...defaultSettings(), ...(parsed.settings ?? {}) };
      if (!Array.isArray(settings.macros) || settings.macros.length === 0) {
        settings.macros = DEFAULT_MACROS;
      }
      if (!Array.isArray(settings.paired)) settings.paired = [];
      return {
        version: 1,
        settings,
        secrets: parsed.secrets ?? { enc: false, items: {} },
      };
    } catch {
      return { version: 1, settings: defaultSettings(), secrets: { enc: false, items: {} } };
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  get settings(): Settings {
    return this.data.settings;
  }

  update(patch: Partial<Settings>): Settings {
    const next = { ...this.data.settings, ...patch };
    if (patch.port && (!Number.isInteger(patch.port) || patch.port < 1024 || patch.port > 65535)) {
      next.port = this.data.settings.port;
    }
    this.data.settings = next;
    this.persist();
    return next;
  }

  /* ------------------------------------------------------------- secrets */

  setSecret(name: string, value: string): void {
    if (!value) {
      delete this.data.secrets.items[name];
      this.persist();
      return;
    }
    if (safeStorage.isEncryptionAvailable()) {
      this.data.secrets.enc = true;
      this.data.secrets.items[name] = safeStorage.encryptString(value).toString('base64');
    } else {
      // Never store a sign-in credential in cleartext: refuse silently-worse storage.
      this.data.secrets.enc = false;
      this.data.secrets.items[name] = Buffer.from(value, 'utf8').toString('base64');
    }
    this.persist();
  }

  hasSecret(name: string): boolean {
    return Boolean(this.data.secrets.items[name]);
  }

  getSecret(name: string): string | null {
    const raw = this.data.secrets.items[name];
    if (!raw) return null;
    try {
      const buf = Buffer.from(raw, 'base64');
      return this.data.secrets.enc && safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(buf)
        : buf.toString('utf8');
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------- devices */

  addDevice(device: Omit<DeviceRecord, 'token' | 'pairSecret' | 'createdAt' | 'lastSeen' | 'unlockEnrolled'>): DeviceRecord {
    const record: DeviceRecord = {
      ...device,
      token: randomToken(),
      pairSecret: randomToken(32),
      createdAt: Date.now(),
      lastSeen: Date.now(),
      unlockEnrolled: false,
    };
    this.data.settings.paired = [
      ...this.data.settings.paired.filter((d) => d.id !== record.id),
      record,
    ];
    this.persist();
    return record;
  }

  findDevice(id: string): DeviceRecord | undefined {
    return this.data.settings.paired.find((d) => d.id === id);
  }

  touchDevice(id: string): void {
    const rec = this.findDevice(id);
    if (!rec) return;
    rec.lastSeen = Date.now();
    this.persist();
  }

  setUnlockEnrolled(id: string, enrolled: boolean): void {
    const rec = this.findDevice(id);
    if (!rec) return;
    rec.unlockEnrolled = enrolled;
    this.persist();
  }

  removeDevice(id: string): void {
    this.data.settings.paired = this.data.settings.paired.filter((d) => d.id !== id);
    this.persist();
  }

  resetPairing(): void {
    this.data.settings.paired = [];
    this.data.secrets.items = {};
    this.persist();
  }
}

let instance: Store | null = null;

export function getStore(): Store {
  if (!instance) instance = new Store();
  return instance;
}

export { DEFAULT_MACROS };
export type { Store };
