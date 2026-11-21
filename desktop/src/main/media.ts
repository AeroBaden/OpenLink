import { spawn, execFile, type ChildProcess } from 'node:child_process';
import type { NowPlaying } from '../../../shared/protocol';

/**
 * Now-playing bridge over GlobalSystemMediaTransportControls (Windows 10 1809+).
 * A single watch process keeps the state fresh; commands run one-shot.
 */

const EMPTY: NowPlaying = {
  ts: 0,
  title: '',
  artist: '',
  app: '',
  playing: false,
  positionS: 0,
  durationS: 0,
};

export class MediaBridge {
  private proc: ChildProcess | null = null;
  private buffer = '';
  private state: NowPlaying = { ...EMPTY };
  private listeners = new Set<(state: NowPlaying) => void>();
  private restartTimer: NodeJS.Timeout | null = null;

  constructor(private readonly scriptPath: () => string) {}

  get latest(): NowPlaying {
    return this.state;
  }

  onChange(cb: (state: NowPlaying) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  start(): void {
    if (process.platform !== 'win32' || this.proc) return;
    let proc: ChildProcess;
    try {
      proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath()],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch {
      this.proc = null;
      return;
    }
    this.proc = proc;
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => this.onData(chunk));
    proc.stderr?.on('data', () => undefined);
    proc.on('exit', () => {
      this.proc = null;
      if (this.restartTimer) return;
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.start();
      }, 15_000);
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(line) as Partial<NowPlaying> & { error?: string };
        const next: NowPlaying = {
          ts: parsed.ts ?? Date.now(),
          title: (parsed.title ?? '').trim(),
          artist: (parsed.artist ?? '').trim(),
          app: (parsed.app ?? '').trim(),
          playing: Boolean(parsed.playing),
          positionS: Number(parsed.positionS ?? 0),
          durationS: Number(parsed.durationS ?? 0),
        };
        const changed =
          next.title !== this.state.title ||
          next.artist !== this.state.artist ||
          next.playing !== this.state.playing ||
          Math.abs(next.positionS - this.state.positionS) > 1.5;
        this.state = next;
        if (changed) for (const cb of this.listeners) cb(next);
      } catch {
        /* ignore malformed line */
      }
    }
  }

  command(action: 'playpause' | 'next' | 'prev' | 'seek', positionS?: number): Promise<void> {
    if (process.platform !== 'win32') return Promise.resolve();
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      this.scriptPath(),
      '-Command',
      action,
    ];
    if (action === 'seek') args.push('-Position', String(Math.max(0, positionS ?? 0)));
    return new Promise((resolve) => {
      execFile('powershell.exe', args, { timeout: 6_000, windowsHide: true }, () => resolve());
    });
  }

  stop(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.proc?.kill();
    this.proc = null;
  }
}
