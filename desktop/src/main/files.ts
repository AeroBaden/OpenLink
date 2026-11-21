import fs from 'node:fs';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { PhotoRef } from '../../../shared/protocol';

/**
 * File transfer plumbing. Metadata and progress travel over the encrypted
 * WebSocket; bytes move over plain HTTP on the same port, which keeps the
 * WebSocket free for control traffic and lets Android stream to disk.
 */

export interface OutgoingToken {
  token: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  expiresAt: number;
}

export interface TransferRecord {
  id: string;
  name: string;
  size: number;
  direction: 'in' | 'out';
  ts: number;
  bps: number;
  status: 'active' | 'done' | 'failed';
  savedPath?: string;
}

export interface FileServiceDeps {
  receiveDir: string;
  photoDir: string;
  screenshotDir: string;
  onProgress: (id: string, received: number, total: number, bps: number) => void;
  onScreenshot: (name: string, filePath: string) => void;
  log: (message: string) => void;
}

const MAX_BYTES = 4 * 1024 * 1024 * 1024;
const TOKEN_TTL_MS = 30 * 60_000;

function safeName(name: string): string {
  const base = path.basename(name).replace(/[\\/:*?"<>|]+/g, '_').trim();
  return base.length > 0 ? base.slice(0, 180) : 'openlink-file';
}

function uniquePath(dir: string, name: string): string {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = path.join(dir, `${stem}${ext}`);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${index})${ext}`);
    index++;
  }
  return candidate;
}

export class FileService {
  private outgoing = new Map<string, OutgoingToken>();
  private recent: TransferRecord[] = [];
  private watcher: fs.FSWatcher | null = null;

  constructor(private readonly deps: FileServiceDeps) {
    fs.mkdirSync(deps.receiveDir, { recursive: true });
    fs.mkdirSync(deps.photoDir, { recursive: true });
  }

  get transfers(): TransferRecord[] {
    return this.recent;
  }

  private pushRecord(record: TransferRecord): void {
    this.recent = [record, ...this.recent.filter((r) => r.id !== record.id)].slice(0, 30);
  }

  /* --------------------------------------------------------------- uploads */

  async receive(id: string, name: string, _mime: string, size: number, stream: Readable): Promise<{ path: string; bps: number }> {
    if (size > MAX_BYTES) throw new Error('file too large');
    const target = uniquePath(this.deps.receiveDir, safeName(name));
    this.pushRecord({ id, name: path.basename(target), size, direction: 'in', ts: Date.now(), bps: 0, status: 'active' });
    const out = createWriteStream(target);
    const started = Date.now();
    let received = 0;
    let lastEmit = 0;

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        received += chunk.length;
        const now = Date.now();
        if (now - lastEmit > 200) {
          lastEmit = now;
          const bps = received / Math.max(0.2, (now - started) / 1000);
          this.deps.onProgress(id, received, size, bps);
        }
      });
      stream.on('error', (err) => {
        out.destroy();
        reject(err);
      });
      out.on('error', reject);
      out.on('finish', resolve);
      stream.pipe(out);
    });

    const bps = received / Math.max(0.2, (Date.now() - started) / 1000);
    this.pushRecord({
      id,
      name: path.basename(target),
      size: received,
      direction: 'in',
      ts: Date.now(),
      bps,
      status: 'done',
      savedPath: target,
    });
    return { path: target, bps };
  }

  /* -------------------------------------------------------------- downloads */

  registerOutgoing(filePath: string, name?: string, mime = 'application/octet-stream'): OutgoingToken | null {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return null;
      const token = randomUUID();
      const entry: OutgoingToken = {
        token,
        name: safeName(name ?? path.basename(filePath)),
        mime,
        size: stat.size,
        path: filePath,
        expiresAt: Date.now() + TOKEN_TTL_MS,
      };
      this.outgoing.set(token, entry);
      this.pushRecord({
        id: token,
        name: entry.name,
        size: entry.size,
        direction: 'out',
        ts: Date.now(),
        bps: 0,
        status: 'done',
      });
      return entry;
    } catch {
      return null;
    }
  }

  resolve(token: string): OutgoingToken | null {
    const entry = this.outgoing.get(token);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.outgoing.delete(token);
      return null;
    }
    if (!fs.existsSync(entry.path)) return null;
    return entry;
  }

  /* ------------------------------------------------------------ phone photos */

  savePhoto(photo: PhotoRef): string {
    const ext = path.extname(photo.name) || '.jpg';
    const stamp = new Date(photo.takenAt || Date.now());
    const base = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(
      stamp.getDate(),
    ).padStart(2, '0')}_${String(stamp.getHours()).padStart(2, '0')}-${String(stamp.getMinutes()).padStart(
      2,
      '0',
    )}-${String(stamp.getSeconds()).padStart(2, '0')}`;
    const target = uniquePath(this.deps.photoDir, `OpenLink_${base}${ext}`);
    const buf = Buffer.from(photo.data, 'base64');
    fs.writeFileSync(target, buf);
    this.pushRecord({
      id: photo.id,
      name: path.basename(target),
      size: buf.length,
      direction: 'in',
      ts: Date.now(),
      bps: 0,
      status: 'done',
      savedPath: target,
    });
    return target;
  }

  /* --------------------------------------------------------- screenshots watch */

  startScreenshotWatch(): void {
    if (this.watcher) return;
    const dir = this.deps.screenshotDir;
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return;
    }
    const started = Date.now();
    try {
      this.watcher = fs.watch(dir, { persistent: false }, (event, filename) => {
        if (event !== 'rename' || !filename) return;
        const full = path.join(dir, String(filename));
        if (!/\.(png|jpe?g|webp)$/i.test(full)) return;
        // Give the screenshot tool a moment to flush the file.
        setTimeout(() => {
          try {
            const stat = fs.statSync(full);
            if (stat.size < 1024 || stat.mtimeMs < started - 5_000) return;
            this.deps.onScreenshot(path.basename(full), full);
          } catch {
            /* file vanished */
          }
        }, 1_200);
      });
    } catch (err) {
      this.deps.log(`screenshot watch failed: ${(err as Error).message}`);
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
