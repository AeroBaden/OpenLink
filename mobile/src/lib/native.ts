import { registerPlugin, Capacitor } from '@capacitor/core';
import type { PhoneNotification } from '../../../shared/protocol';

/**
 * Bridge to the native Android plugin (`OpenLinkPlugin.java`).
 * Every method degrades to a sensible web fallback so the PWA build runs in a
 * desktop browser for development — real hardware features report `available:
 * false` instead of pretending.
 */

export interface SharedItem {
  name: string;
  mime: string;
  size: number;
  /** Absolute cache path staged by the native share target. */
  path: string;
}

interface OpenLinkNativePlugin {
  getDeviceInfo(): Promise<{ id: string; name: string; model: string; manufacturer: string; android: string; sdk: number }>;
  ensureIdentity(): Promise<{ publicKey: string }>;
  sign(options: { value: string; reason?: string; biometric?: boolean }): Promise<{ signature: string }>;
  biometricAvailable(): Promise<{ available: boolean; enrolled: boolean }>;
  scanQr(): Promise<{ value: string }>;
  keepAwake(options: { enabled: boolean }): Promise<void>;
  getRecentPhotos(options: { since: number; limit?: number }): Promise<{ photos: { id: string; name: string; mime: string; size: number; takenAt: number; data: string }[] }>;
  saveFile(options: { name: string; base64: string; mime: string; kind?: 'download' | 'image' }): Promise<{ uri: string }>;
  shareFile(options: { name: string; base64: string; mime: string }): Promise<void>;
  notifications(): Promise<{ access: boolean; notifications: PhoneNotification[] }>;
  replyNotification(options: { id: string; text: string }): Promise<{ ok: boolean }>;
  openNotificationSettings(): Promise<void>;
  getSharedContent(): Promise<{ items: SharedItem[]; text?: string; url?: string }>;
  clearShared(): Promise<void>;
  secureSet(options: { key: string; value: string }): Promise<void>;
  secureGet(options: { key: string }): Promise<{ value: string }>;
  secureRemove(options: { key: string }): Promise<void>;
  usbConnected(): Promise<{ connected: boolean }>;
  setChrome(options: { dark: boolean }): Promise<void>;
  openUrl(options: { url: string }): Promise<void>;
}

export const Native = registerPlugin<OpenLinkNativePlugin>('OpenLinkNative');

export const isAndroid = Capacitor.getPlatform() === 'android';

/* --------------------------------------------------------------- identity */

const SOFT_KEY = 'openlink.soft-identity';

async function softIdentity(): Promise<CryptoKeyPair> {
  const stored = localStorage.getItem(SOFT_KEY);
  if (stored) {
    const { privateJwk, publicJwk } = JSON.parse(stored) as { privateJwk: JsonWebKey; publicJwk: JsonWebKey };
    const privateKey = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    const publicKey = await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    return { privateKey, publicKey };
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const exported = pair as CryptoKeyPair;
  localStorage.setItem(
    SOFT_KEY,
    JSON.stringify({
      privateJwk: await crypto.subtle.exportKey('jwk', exported.privateKey),
      publicJwk: await crypto.subtle.exportKey('jwk', exported.publicKey),
    }),
  );
  return exported;
}

/** SPKI (base64) of the device identity key. */
export async function identityPublicKey(): Promise<string> {
  if (isAndroid) {
    const { publicKey } = await Native.ensureIdentity();
    return publicKey;
  }
  const pair = await softIdentity();
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  return toBase64(spki);
}

/** DER-encoded ECDSA signature over `value`, produced by the hardware key. */
export async function signIdentity(value: string, reason?: string, biometric = false): Promise<string> {
  if (isAndroid) {
    const { signature } = await Native.sign({ value, reason, biometric });
    return signature;
  }
  const pair = await softIdentity();
  const raw = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(value));
  return toBase64(rawToDer(new Uint8Array(raw)));
}

export function toBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** WebCrypto emits r||s; Android and Node expect DER. */
export function rawToDer(raw: Uint8Array): Uint8Array {
  const trim = (bytes: Uint8Array): Uint8Array => {
    let index = 0;
    while (index < bytes.length - 1 && bytes[index] === 0) index++;
    let out = bytes.slice(index);
    if (out[0] & 0x80) {
      const padded = new Uint8Array(out.length + 1);
      padded[0] = 0;
      padded.set(out, 1);
      out = padded;
    }
    return out;
  };
  const half = raw.length / 2;
  const r = trim(raw.slice(0, half));
  const s = trim(raw.slice(half));
  const total = 2 + r.length + 2 + s.length;
  if (total < 128) return new Uint8Array([0x30, total, 0x02, r.length, ...r, 0x02, s.length, ...s]);
  return new Uint8Array([0x30, 0x81, total, 0x02, r.length, ...r, 0x02, s.length, ...s]);
}
