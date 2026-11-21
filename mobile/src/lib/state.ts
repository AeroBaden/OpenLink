import { Preferences } from '@capacitor/preferences';
import { isAndroid, Native } from './native';
import type { Lang } from '../../../shared/protocol';

export interface Credentials {
  deviceId: string;
  token: string;
  pairSecret: string;
  serverName: string;
  hosts: string[];
  port: number;
  publicKey: string;
  pairedAt: number;
}

export interface AppSettings {
  lang: Lang;
  theme: 'dark' | 'light';
  autosyncPhotos: boolean;
  autosyncScreenshots: boolean;
  standbyMs: number;
  /** Standby face composition: follow the device, or force one. */
  standbyLayout: 'auto' | 'portrait' | 'landscape';
  /** Standby face design: layered panels, or pure black type only. */
  standbyStyle: 'panels' | 'text';
  requireBiometric: boolean;
  haptics: boolean;
}

const CRED_KEY = 'openlink.credentials';
const SETTINGS_KEY = 'openlink.settings';

const DEFAULT_SETTINGS: AppSettings = {
  lang: 'en',
  theme: 'dark',
  autosyncPhotos: true,
  autosyncScreenshots: true,
  standbyMs: 15_000,
  standbyLayout: 'auto',
  standbyStyle: 'panels',
  requireBiometric: true,
  haptics: true,
};

async function secureGet(key: string): Promise<string | null> {
  if (isAndroid) {
    try {
      const { value } = await Native.secureGet({ key });
      if (value) return value;
    } catch {
      /* fall through to Preferences */
    }
  }
  const { value } = await Preferences.get({ key });
  return value;
}

async function secureSet(key: string, value: string): Promise<void> {
  if (isAndroid) {
    try {
      await Native.secureSet({ key, value });
      return;
    } catch {
      /* fall through */
    }
  }
  await Preferences.set({ key, value });
}

async function secureRemove(key: string): Promise<void> {
  if (isAndroid) {
    try {
      await Native.secureRemove({ key });
    } catch {
      /* ignore */
    }
  }
  await Preferences.remove({ key });
}

export async function loadCredentials(): Promise<Credentials | null> {
  try {
    const raw = await secureGet(CRED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Credentials;
    if (!parsed.deviceId || !parsed.token || !parsed.pairSecret) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  await secureSet(CRED_KEY, JSON.stringify(credentials));
}

export async function clearCredentials(): Promise<void> {
  await secureRemove(CRED_KEY);
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const { value } = await Preferences.get({ key: SETTINGS_KEY });
    if (!value) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(value) as Partial<AppSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(settings) });
}

export { DEFAULT_SETTINGS };
