import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * USB-C boost. When the phone is plugged in and USB debugging is authorised,
 * `adb reverse tcp:8765 tcp:8765` maps the phone's own localhost:8765 onto the
 * host server, giving a wired 480 Mbit+ link with lower latency than Wi-Fi.
 * We watch for device appearance and re-apply the reverse on every reconnect.
 */

export interface AdbState {
  present: boolean;
  serial: string | null;
  reversed: boolean;
  adbPath: string | null;
  error: string | null;
}

const ADB_CANDIDATES = [
  process.env.ADB_PATH,
  'adb',
  path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
  'C:\\Android\\platform-tools\\adb.exe',
  'C:\\Program Files\\Android\\platform-tools\\adb.exe',
];

export function locateAdb(): string | null {
  for (const candidate of ADB_CANDIDATES) {
    if (!candidate) continue;
    if (!candidate.includes(path.sep)) {
      // Bare `adb` — assume it is on PATH if the file resolves somewhere.
      if (process.env.PATH?.split(path.delimiter).some((dir) => fs.existsSync(path.join(dir, candidate)))) {
        return candidate;
      }
      continue;
    }
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function run(bin: string, args: string[], timeout = 8_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export class AdbBridge {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private readonly reversedSerials = new Set<string>();
  private state: AdbState = { present: false, serial: null, reversed: false, adbPath: null, error: null };

  constructor(
    private readonly port: () => number,
    private readonly onState: (state: AdbState) => void,
  ) {}

  get current(): AdbState {
    return this.state;
  }

  start(): void {
    this.stop();
    if (process.platform !== 'win32') return;
    const bin = locateAdb();
    this.setState({ ...this.state, adbPath: bin });
    this.timer = setInterval(() => void this.poll(), 3_000);
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  refresh(): void {
    void this.poll();
  }

  private setState(next: Partial<AdbState>): void {
    const merged = { ...this.state, ...next };
    const changed =
      merged.present !== this.state.present ||
      merged.serial !== this.state.serial ||
      merged.reversed !== this.state.reversed ||
      merged.error !== this.state.error ||
      merged.adbPath !== this.state.adbPath;
    this.state = merged;
    if (changed) this.onState(merged);
  }

  private async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const bin = this.state.adbPath ?? locateAdb();
      if (!bin) {
        this.setState({ present: false, serial: null, reversed: false, adbPath: null, error: 'adb not found' });
        return;
      }
      const out = await run(bin, ['devices', '-l'], 5_000);
      const lines = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('List of devices'));
      const device = lines.find((l) => /\sdevice\b/.test(l));
      if (!device) {
        const unauthorized = lines.find((l) => /\bunauthorized\b/.test(l));
        this.reversedSerials.clear();
        this.setState({
          present: false,
          serial: null,
          reversed: false,
          adbPath: bin,
          error: unauthorized ? 'authorise USB debugging on the phone' : null,
        });
        return;
      }
      const serial = device.split(/\s+/)[0];
      const port = this.port();
      const alreadyReversed = this.reversedSerials.has(serial) && this.state.serial === serial;
      this.setState({ present: true, serial, adbPath: bin, error: null, reversed: alreadyReversed || this.state.reversed });
      if (!alreadyReversed) {
        try {
          await run(bin, ['reverse', `tcp:${port}`, `tcp:${port}`], 6_000);
          // Keep the WebRTC/signalling fallback port open too.
          await run(bin, ['reverse', 'tcp:8766', 'tcp:8766'], 6_000).catch(() => undefined);
          this.reversedSerials.add(serial);
          this.setState({ present: true, serial, reversed: true, error: null });
        } catch (err) {
          this.setState({ reversed: false, error: (err as Error).message.slice(0, 160) });
        }
      }
    } catch (err) {
      this.setState({ present: false, serial: null, reversed: false, error: (err as Error).message.slice(0, 160) });
    } finally {
      this.busy = false;
    }
  }
}
