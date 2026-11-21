import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { DeviceRecord } from './store';

/**
 * Biometric remote unlock.
 *
 * Android never sends a password: it signs a one-time nonce with a key that
 * lives in the Android Keystore (StrongBox/TEE) and only becomes usable after
 * BiometricPrompt succeeds. The host verifies that signature, then hands off to
 * the `OpenLinkUnlock` scheduled task, which runs as SYSTEM and types the
 * DPAPI-protected credential into the Winlogon desktop.
 *
 * One-time administrator setup is required to create the task and write the
 * machine-scope credential blob; everything after that is user-level.
 */

const NONCE_TTL_MS = 30_000;
const MIN_INTERVAL_MS = 8_000;
const ENTROPY = 'OpenLink-Unlock-v1';

export interface UnlockStatus {
  enrolled: boolean;
  armed: boolean;
  lastAt: number | null;
  elevated: boolean;
  taskInstalled: boolean;
  error: string | null;
}

export interface UnlockDeps {
  resourcesDir: string;
  dataDir: string;
  isEnrolled: (deviceId: string) => boolean;
  markEnrolled: (deviceId: string, value: boolean) => void;
  verifySignature: (device: DeviceRecord, nonce: string, ts: number, signature: string) => boolean;
  isArmed: () => boolean;
  log: (message: string) => void;
}

function exec(cmd: string, args: string[], timeout = 20_000, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, env: { ...process.env, ...env } }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export class UnlockService {
  private nonces = new Map<string, { deviceId: string; expiresAt: number }>();
  private lastAttempt = 0;
  private lastAt: number | null = null;
  private error: string | null = null;

  constructor(private readonly deps: UnlockDeps) {}

  private get programData(): string {
    return path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'OpenLink');
  }

  status(deviceId: string | null): UnlockStatus {
    return {
      enrolled: deviceId ? this.deps.isEnrolled(deviceId) : false,
      armed: this.deps.isArmed(),
      lastAt: this.lastAt,
      elevated: this.elevated,
      taskInstalled: fs.existsSync(path.join(this.deps.resourcesDir, 'openlink-unlock.ps1')),
      error: this.error,
    };
  }

  private elevatedCache: boolean | null = null;

  get elevated(): boolean {
    if (this.elevatedCache !== null) return this.elevatedCache;
    if (process.platform !== 'win32') {
      this.elevatedCache = false;
      return false;
    }
    // `net session` only succeeds from an elevated token.
    try {
      const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
      const res = spawnSync('net', ['session'], { windowsHide: true, timeout: 5_000 });
      this.elevatedCache = res.status === 0;
    } catch {
      this.elevatedCache = false;
    }
    return this.elevatedCache;
  }

  /** Write the machine-scope DPAPI blob + register the SYSTEM task. */
  async enroll(device: DeviceRecord, credential: string): Promise<void> {
    if (process.platform !== 'win32') throw new Error('remote unlock requires Windows');
    if (!credential) throw new Error('empty credential');
    fs.mkdirSync(this.programData, { recursive: true });

    const blobPath = path.join(this.programData, 'unlock.dat');
    const ps = [
      '$ErrorActionPreference="Stop"',
      `$entropy=[Text.Encoding]::UTF8.GetBytes('${ENTROPY}')`,
      '$plain=[Text.Encoding]::UTF8.GetBytes($env:OPENLINK_SECRET)',
      `$cipher=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,'LocalMachine')`,
      `[IO.File]::WriteAllBytes('${blobPath.replace(/'/g, "''")}',$cipher)`,
      `$acl=New-Object Security.AccessControl.FileSecurity`,
      '$acl.SetAccessRuleProtection($true,$false)',
      `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow')))`,
      `$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('Administrators','FullControl','Allow')))`,
      `Set-Acl -Path '${blobPath.replace(/'/g, "''")}' -AclObject $acl`,
    ].join('; ');

    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], 20_000, {
      OPENLINK_SECRET: credential,
    });

    const script = path.join(this.deps.resourcesDir, 'openlink-unlock.ps1');
    const taskCommand = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}"`;
    try {
      await exec('schtasks.exe', [
        '/Create',
        '/F',
        '/TN',
        'OpenLinkUnlock',
        '/SC',
        'ONCE',
        '/ST',
        '00:00',
        '/RU',
        'SYSTEM',
        '/RL',
        'HIGHEST',
        '/TR',
        taskCommand,
      ]);
    } catch (err) {
      this.error = `scheduled task registration failed: ${(err as Error).message.slice(0, 200)}`;
      throw new Error(this.error);
    }
    this.deps.markEnrolled(device.id, true);
    this.error = null;
    this.deps.log(`unlock enrolled for ${device.name}`);
  }

  /** Called when the phone asks for an unlock (after its biometric prompt). */
  issueChallenge(deviceId: string): { nonce: string; expiresAt: number } {
    const nonce = randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + NONCE_TTL_MS;
    this.nonces.set(nonce, { deviceId, expiresAt });
    // Housekeeping: drop expired nonces.
    for (const [key, value] of this.nonces) {
      if (value.expiresAt < Date.now()) this.nonces.delete(key);
    }
    return { nonce, expiresAt };
  }

  async submit(device: DeviceRecord, nonce: string, ts: number, signature: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this.deps.isArmed()) return { ok: false, reason: 'not armed' };
    if (!this.deps.isEnrolled(device.id)) return { ok: false, reason: 'device not enrolled' };
    if (Date.now() - this.lastAttempt < MIN_INTERVAL_MS) return { ok: false, reason: 'rate limited' };
    this.lastAttempt = Date.now();

    const pending = this.nonces.get(nonce);
    if (!pending || pending.deviceId !== device.id || pending.expiresAt < Date.now()) {
      return { ok: false, reason: 'stale challenge' };
    }
    if (Math.abs(Date.now() - ts) > NONCE_TTL_MS) return { ok: false, reason: 'clock skew' };
    this.nonces.delete(nonce);

    if (!this.deps.verifySignature(device, nonce, ts, signature)) {
      this.deps.log(`unlock rejected: bad signature from ${device.name}`);
      return { ok: false, reason: 'signature' };
    }

    try {
      await exec('schtasks.exe', ['/Run', '/TN', 'OpenLinkUnlock'], 10_000);
      this.lastAt = Date.now();
      this.deps.log(`unlock accepted for ${device.name}`);
      return { ok: true };
    } catch (err) {
      this.error = `could not start unlock helper: ${(err as Error).message.slice(0, 200)}`;
      this.deps.log(this.error);
      return { ok: false, reason: 'helper' };
    }
  }

  clearCredential(): void {
    const blob = path.join(this.programData, 'unlock.dat');
    try {
      fs.rmSync(blob, { force: true });
    } catch {
      /* ignore */
    }
  }
}
