import os from 'node:os';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { PAIR_CODE_ALPHABET, PAIR_CODE_TTL_MS } from '../../../shared/protocol';
import { lanAddresses } from './net';
import { sha256Hex } from './crypto';

export interface PairingTicket {
  code: string;
  expiresAt: number;
  /** `openlink://pair?...` encoded in the QR image. */
  uri: string;
  dataUrl: string;
}

export class PairingManager {
  private code: string | null = null;
  private expiresAt = 0;
  private ticket: PairingTicket | null = null;
  private readonly serverId: string;

  constructor(
    private readonly getPort: () => number,
    private readonly getName: () => string,
  ) {
    this.serverId = sha256Hex(`${os.hostname()}|${os.userInfo().username}`).slice(0, 12);
  }

  get id(): string {
    return this.serverId;
  }

  get active(): boolean {
    return Boolean(this.code) && Date.now() < this.expiresAt;
  }

  get currentCode(): string | null {
    return this.active ? this.code : null;
  }

  get currentExpiry(): number | null {
    return this.active ? this.expiresAt : null;
  }

  private randomCode(): string {
    const bytes = randomBytes(6);
    let out = '';
    for (let i = 0; i < 6; i++) out += PAIR_CODE_ALPHABET[bytes[i] % PAIR_CODE_ALPHABET.length];
    return out;
  }

  async issue(usbAvailable = false): Promise<PairingTicket> {
    this.code = this.randomCode();
    this.expiresAt = Date.now() + PAIR_CODE_TTL_MS;
    const port = this.getPort();
    const hosts = [...lanAddresses().slice(0, 3), '127.0.0.1'].join(',');
    const uri =
      `openlink://pair?v=1&port=${port}&code=${this.code}` +
      `&hosts=${encodeURIComponent(hosts)}` +
      `&name=${encodeURIComponent(this.getName())}` +
      `&fp=${this.serverId}` +
      `&usb=${usbAvailable ? 1 : 0}`;
    const dataUrl = await QRCode.toDataURL(uri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 512,
      color: { dark: '#000000', light: '#ffffff' },
    });
    this.ticket = { code: this.code, expiresAt: this.expiresAt, uri, dataUrl };
    return this.ticket;
  }

  async cached(): Promise<PairingTicket> {
    if (this.ticket && this.active) return this.ticket;
    return this.issue();
  }

  /** Constant-time-ish check that does not consume the code yet. */
  matches(code: string): boolean {
    if (!this.code || Date.now() >= this.expiresAt) return false;
    const a = Buffer.from(this.code);
    const b = Buffer.from(String(code).trim().toUpperCase());
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  /**
   * Single-use verification. Only called once a pairing actually completed, so
   * a dropped Wi-Fi connection or a phone-side error does not burn the code the
   * user is looking at.
   */
  consume(code: string): boolean {
    if (!this.matches(code)) return false;
    this.code = null;
    this.expiresAt = 0;
    this.ticket = null;
    return true;
  }

  revoke(): void {
    this.code = null;
    this.expiresAt = 0;
    this.ticket = null;
  }
}
