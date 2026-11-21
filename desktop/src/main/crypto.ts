import crypto from 'node:crypto';

/**
 * Session crypto for the host side.
 *
 * Handshake: the host publishes an ephemeral P-256 SPKI key in `server.hello`.
 * After a successful pair/auth both sides run ECDH and HKDF (salt = the pairing
 * secret) to obtain an AES-256-GCM key. Every frame after that is sealed with a
 * monotonically increasing 64-bit counter used as the GCM nonce, which also
 * gives replay protection for free.
 */

const HKDF_INFO = 'openlink-v1-session';

/** Associated data that binds the visible frame counter to the ciphertext. */
export function aad(counter: number): string {
  return `openlink-v1:${counter}`;
}

export interface SealedFrame {
  t: 'sealed';
  n: number;
  d: string;
}

export function createEphemeralKey(): crypto.KeyObject {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
}

export function exportPublicKey(key: crypto.KeyObject): string {
  const pub = key.type === 'private' ? crypto.createPublicKey(key) : key;
  return pub.export({ type: 'spki', format: 'der' }).toString('base64');
}

export function importPeerKey(spkiB64: string): crypto.KeyObject {
  const der = Buffer.from(spkiB64, 'base64');
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

export function deriveSessionKey(
  privateKey: crypto.KeyObject,
  peerSpkiB64: string,
  pairSecretB64: string,
): Buffer {
  const secret = crypto.diffieHellman({ privateKey, publicKey: importPeerKey(peerSpkiB64) });
  const salt = Buffer.from(pairSecretB64, 'base64');
  const okm = crypto.hkdfSync('sha256', secret, salt, HKDF_INFO, 32);
  return Buffer.from(okm);
}

export function verifyDeviceSignature(peerSpkiB64: string, payload: string, sigB64: string): boolean {
  try {
    return crypto.verify(
      'sha256',
      Buffer.from(payload, 'utf8'),
      importPeerKey(peerSpkiB64),
      Buffer.from(sigB64, 'base64'),
    );
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function randomSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64');
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Six-character safety code shown on both screens. */
export function safetyCode(...parts: string[]): string {
  const hex = sha256Hex(parts.join('|')).slice(0, 6).toUpperCase();
  return hex.match(/.{1,2}/g)!.join(' ');
}

export class Sealer {
  private counter = 0;
  private lastSeen = 0;

  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('session key must be 32 bytes');
  }

  seal(payload: unknown): SealedFrame {
    const n = ++this.counter;
    const iv = Buffer.alloc(12);
    iv.writeBigUInt64BE(BigInt(n), 4);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 });
    // The counter travels in the clear header, so it must be authenticated:
    // otherwise an attacker could raise `n` and replay a captured frame.
    cipher.setAAD(Buffer.from(aad(n)));
    const body = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return { t: 'sealed', n, d: Buffer.concat([iv, body]).toString('base64') };
  }

  open(frame: { n: number; d: string }): unknown {
    if (!Number.isSafeInteger(frame.n) || frame.n <= this.lastSeen) {
      throw new Error('replayed or reordered frame');
    }
    const raw = Buffer.from(frame.d, 'base64');
    if (raw.length < 12 + 16) throw new Error('short frame');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(raw.length - 16);
    const body = raw.subarray(12, raw.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.from(aad(frame.n)));
    const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    this.lastSeen = frame.n;
    return JSON.parse(plain);
  }
}
