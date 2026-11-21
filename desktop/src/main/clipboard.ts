import { clipboard } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CLIPBOARD_HISTORY_LIMIT, type ClipboardEntry } from '../../../shared/protocol';

/**
 * Bidirectional clipboard with a 20-item synced history.
 *
 * Windows has no clipboard change event for us, so we poll the OS clipboard
 * (cheap, ~1 ms) and only act when the text actually changed. Entries the phone
 * pushed are marked `phone` and never echoed back.
 */
export class ClipboardSync {
  private items: ClipboardEntry[] = [];
  private lastSeen = '';
  private timer: NodeJS.Timeout | null = null;
  private listeners = new Set<(items: ClipboardEntry[], incoming?: ClipboardEntry) => void>();

  constructor(
    private readonly file: string,
    private readonly onIncoming: (entry: ClipboardEntry) => void,
  ) {
    this.load();
    this.lastSeen = this.readOs();
  }

  get history(): ClipboardEntry[] {
    return this.items;
  }

  onChange(cb: (items: ClipboardEntry[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private readOs(): string {
    try {
      return clipboard.readText() ?? '';
    } catch {
      return '';
    }
  }

  private load(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as ClipboardEntry[];
      if (Array.isArray(parsed)) this.items = parsed.slice(0, CLIPBOARD_HISTORY_LIMIT);
    } catch {
      this.items = [];
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.items, null, 2), 'utf8');
    } catch {
      /* history is best-effort */
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), 700);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private poll(): void {
    const text = this.readOs();
    if (!text || text === this.lastSeen) return;
    this.lastSeen = text;
    this.record(text, 'pc');
  }

  /** Called for text captured on the phone: also becomes the PC clipboard. */
  pushFromPhone(text: string): ClipboardEntry {
    const entry = this.record(text, 'phone');
    this.lastSeen = text;
    try {
      clipboard.writeText(text);
    } catch {
      /* ignore */
    }
    this.onIncoming(entry);
    return entry;
  }

  record(text: string, origin: 'pc' | 'phone'): ClipboardEntry {
    const trimmed = text.slice(0, 200_000);
    const existing = this.items.find((i) => i.text === trimmed);
    if (existing) {
      this.items = [existing, ...this.items.filter((i) => i.id !== existing.id)];
      this.save();
      this.notify();
      return existing;
    }
    const entry: ClipboardEntry = {
      id: randomUUID(),
      text: trimmed,
      ts: Date.now(),
      origin,
    };
    this.items = [entry, ...this.items].slice(0, CLIPBOARD_HISTORY_LIMIT);
    this.save();
    this.notify();
    return entry;
  }

  remove(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
    this.save();
    this.notify();
  }

  clear(): void {
    this.items = [];
    this.save();
    this.notify();
  }

  private notify(): void {
    for (const cb of this.listeners) cb(this.items);
  }
}
