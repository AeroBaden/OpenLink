import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

/**
 * Client for `openlink-agent.ps1`: one long-lived PowerShell process that owns
 * SendInput, Core Audio and power actions. Keeps pointer moves at interactive
 * latency and gives us a single place to serialise Windows input.
 */

type Pending = {
  resolve: (v: AgentResponse) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
};

export interface AgentResponse {
  id: number;
  ok: boolean;
  error?: string;
  volume?: number;
  muted?: boolean;
  pong?: boolean;
}

export class WindowsAgent {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready = false;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private buffer = '';
  private starting = false;

  constructor(private readonly scriptPath: () => string) {}

  get isReady(): boolean {
    return this.ready;
  }

  async ensure(): Promise<void> {
    if (this.ready && this.proc) return;
    if (this.starting) {
      await new Promise((r) => setTimeout(r, 300));
      if (this.ready) return;
    }
    if (process.platform !== 'win32') throw new Error('Windows input agent is only available on Windows');
    this.starting = true;
    try {
      const script = this.scriptPath();
      this.proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      this.bind();
      const ok = await this.waitForReady(8_000);
      if (!ok) throw new Error(`agent did not start (${path.basename(script)})`);
    } finally {
      this.starting = false;
    }
  }

  private bind(): void {
    const proc = this.proc;
    if (!proc) return;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.onData(chunk));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => {
      console.warn('[agent]', chunk.trim().slice(0, 500));
    });
    proc.on('exit', () => {
      this.ready = false;
      this.proc = null;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('agent exited'));
        this.pending.delete(id);
      }
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.startsWith('{')) continue;
      let parsed: AgentResponse & { ready?: boolean };
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed.ready) {
        this.ready = true;
        continue;
      }
      const waiter = this.pending.get(parsed.id);
      if (!waiter) continue;
      clearTimeout(waiter.timer);
      this.pending.delete(parsed.id);
      if (parsed.ok) waiter.resolve(parsed);
      else waiter.reject(new Error(parsed.error ?? 'agent error'));
    }
  }

  private waitForReady(timeoutMs: number): Promise<boolean> {
    const started = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (this.ready) return resolve(true);
        if (Date.now() - started > timeoutMs || !this.proc) return resolve(false);
        setTimeout(tick, 60);
      };
      tick();
    });
  }

  async call(command: Record<string, unknown>, timeoutMs = 4_000): Promise<AgentResponse> {
    await this.ensure();
    const id = ++this.seq;
    const proc = this.proc;
    if (!proc) throw new Error('agent not running');
    return new Promise<AgentResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('agent timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      proc.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
    });
  }

  async volume(): Promise<{ volume: number | null; muted: boolean | null }> {
    try {
      const res = await this.call({ cmd: 'volume.get' }, 2_000);
      return { volume: typeof res.volume === 'number' ? res.volume : null, muted: res.muted ?? null };
    } catch {
      return { volume: null, muted: null };
    }
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
    this.ready = false;
  }
}

/** Reference kept for app shutdown wiring. */
export const agentScriptName = 'openlink-agent.ps1';
