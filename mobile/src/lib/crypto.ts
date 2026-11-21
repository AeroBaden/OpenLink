import { fromBase64, toBase64 } from './native';

/**
 * Session crypto, browser/WebView side. Mirrors desktop/src/main/crypto.ts:
 * ephemeral P-256 ECDH → HKDF-SHA256 (salt = pairing secret) → AES-256-GCM,
 * with a 64-bit counter in the GCM nonce so replayed frames are rejected.
 */

const HKDF_INFO = 'openlink-v1-session';

function aad(counter: number): string {
  return `openlink-v1:${counter}`;
}

export interface SealedFrame {
  t: 'sealed';
  n: number;
  d: string;
}

export async function generateEphemeral(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']) as Promise<CryptoKeyPair>;
}

export async function exportSpki(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', key);
  return toBase64(spki);
}

export async function importPeerKey(spkiB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    fromBase64(spkiB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
}

export async function deriveSessionKey(
  privateKey: CryptoKey,
  peerSpkiB64: string,
  pairSecretB64: string,
): Promise<CryptoKey> {
  const peer = await importPeerKey(peerSpkiB64);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: fromBase64(pairSecretB64),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export class Sealer {
  private counter = 0;
  private lastSeen = 0;

  constructor(private readonly key: CryptoKey) {}

  async seal(payload: unknown): Promise<SealedFrame> {
    const n = ++this.counter;
    const iv = new Uint8Array(12);
    new DataView(iv.buffer).setBigUint64(4, BigInt(n));
    // Bind the visible frame counter to the ciphertext (AAD), so a captured
    // frame cannot be replayed with a raised counter.
    const body = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: 128, additionalData: new TextEncoder().encode(aad(n)) },
      this.key,
      new TextEncoder().encode(JSON.stringify(payload)),
    );
    const combined = new Uint8Array(12 + body.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(body), 12);
    return { t: 'sealed', n, d: toBase64(combined) };
  }

  async open(frame: { n: number; d: string }): Promise<unknown> {
    if (!Number.isSafeInteger(frame.n) || frame.n <= this.lastSeen) {
      throw new Error('replayed frame');
    }
    const raw = fromBase64(frame.d);
    if (raw.length < 12 + 16) throw new Error('short frame');
    const iv = raw.slice(0, 12);
    const body = raw.slice(12);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128, additionalData: new TextEncoder().encode(aad(frame.n)) },
      this.key,
      body,
    );
    this.lastSeen = frame.n;
    return JSON.parse(new TextDecoder().decode(plain));
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function randomId(bytes = 16): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
