import { Haptics, ImpactStyle } from '@capacitor/haptics';

const NS = 'http://www.w3.org/2000/svg';

const PATHS: Record<string, string> = {
  link: 'M9 15l6-6M8 11L5.5 13.5a3.5 3.5 0 005 5L13 16M16 13l2.5-2.5a3.5 3.5 0 00-5-5L11 8',
  gauge: 'M4 18a8 8 0 1116 0M12 14l4-4M4 18h16',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  inbox: 'M4 13h4l1.5 3h5L16 13h4M4 13l2-7h12l2 7v4a2 2 0 01-2 2H6a2 2 0 01-2-2z',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
  wifi: 'M2 8.5a15 15 0 0120 0M5 12a10.5 10.5 0 0114 0M8.5 15.5a6 6 0 017 0M12 19h.01',
  usb: 'M12 20V8M9 8h6l-3-5zM7 12l-2 2 4 1M17 12l2 2-4 1M12 15v2',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 13l4 4L19 7',
  cpu: 'M7 7h10v10H7zM4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3',
  gpu: 'M3 7h14a3 3 0 013 3v7h-4l-2 2H8v-2H3zM17 11h.01M7 11h6v4H7z',
  memory: 'M4 8h16v8H4zM8 8v8M12 8v8M16 8v8M7 16v2M17 16v2',
  fan: 'M12 12a3 3 0 100-.01M12 9c0-3 1-5 3-5s2 4-1 6M15 12c3 0 5 1 5 3s-4 2-6-1M12 15c0 3-1 5-3 5s-2-4 1-6M9 12c-3 0-5-1-5-3s4-2 6 1',
  power: 'M12 4v7M7.5 7a7 7 0 109 0',
  thermometer: 'M10 14V6a2 2 0 114 0v8a4 4 0 11-4 0z',
  network: 'M12 20v-4M7 16h10M4 8h16M4 8v8h16V8M8 8v8M16 8v8',
  'mic-off': 'M4 4l16 16M9 9v3a3 3 0 005 2M15 10V6a3 3 0 00-5.5-1.7M5 11a7 7 0 0011 5.7M12 18v3M8 21h8',
  headset: 'M4 14v-2a8 8 0 0116 0v2M4 14h3v6H5a1 1 0 01-1-1zM20 14h-3v6h2a1 1 0 001-1z',
  record: 'M12 6a6 6 0 100 12 6 6 0 000-12z',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 016 0v3',
  unlock: 'M6 11h12v9H6zM9 11V8a3 3 0 015-2',
  'display-off': 'M3 5h18v11H3zM9 20h6M12 16v4M4 4l16 15',
  play: 'M8 5l11 7-11 7z',
  pause: 'M9 5v14M15 5v14',
  next: 'M6 5l9 7-9 7zM18 5v14',
  prev: 'M18 5l-9 7 9 7zM6 5v14',
  upload: 'M12 19V5M6 11l6-6 6 6M4 21h16',
  download: 'M12 5v14M6 13l6 6 6-6M4 21h16',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4',
  moon: 'M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  phone: 'M8 3h8a1 1 0 011 1v16a1 1 0 01-1 1H8a1 1 0 01-1-1V4a1 1 0 011-1zM11 18h2',
  monitor: 'M3 5h18v11H3zM9 20h6M12 16v4',
  speaker: 'M4 10v4h3l4 4V6L7 10zM16 9a4 4 0 010 6',
  keyboard: 'M3 7h18v10H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  trackpad: 'M4 5h16v14H4zM12 14v2',
  camera: 'M4 8h3l2-2h6l2 2h3v11H4zM12 16a3 3 0 100-6 3 3 0 000 6z',
  clock: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 8v4l3 2',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  send: 'M4 12l16-8-6 16-3-6z',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  bell: 'M6 16V11a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0',
  clipboard: 'M8 4h8v3H8zM6 6h2v2h8V6h2v15H6z',
  refresh: 'M4 12a8 8 0 0113.7-5.7L20 8M20 4v4h-4M20 12a8 8 0 01-13.7 5.7L4 16M4 20v-4h4',
};

let markSeq = 0;

/** The OpenLink mark: two overlapping rings lit ice → mint. */
export function loopMark(size = 22): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  const id = `ol-loop-${++markSeq}`;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');

  const defs = document.createElementNS(NS, 'defs');
  const gradient = document.createElementNS(NS, 'linearGradient');
  gradient.setAttribute('id', id);
  gradient.setAttribute('x1', '0');
  gradient.setAttribute('y1', '0');
  gradient.setAttribute('x2', '1');
  gradient.setAttribute('y2', '0');
  for (const [offset, color] of [
    ['0', '#3ea8ff'],
    ['0.5', '#4ed6ff'],
    ['1', '#7cf2c8'],
  ]) {
    const stop = document.createElementNS(NS, 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', color);
    gradient.appendChild(stop);
  }
  defs.appendChild(gradient);
  svg.appendChild(defs);

  for (const cx of ['7.4', '16.6']) {
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('cx', cx);
    ring.setAttribute('cy', '12');
    ring.setAttribute('r', '5.2');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', `url(#${id})`);
    ring.setAttribute('stroke-width', '2.4');
    svg.appendChild(ring);
  }
  return svg;
}

export function icon(name: string, size = 18): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name] ?? PATHS.link);
  svg.append(path);
  return svg;
}

type Child = Node | string | null | undefined | false;
type AttrValue = string | number | boolean | null | undefined | ((event: Event) => void);

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === 'function') {
      node.addEventListener(key.startsWith('on') ? key.slice(2) : key, value as EventListener);
      continue;
    }
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function toast(message: string, kind: 'ok' | 'err' = 'ok'): void {
  const host = document.getElementById('toast');
  if (!host) return;
  const node = el('div', { class: kind === 'err' ? 'toast err' : 'toast', text: message });
  host.append(node);
  setTimeout(() => node.remove(), 2600);
}

export async function haptic(style: 'light' | 'medium' | 'heavy' = 'light'): Promise<void> {
  try {
    await Haptics.impact({ style: style === 'light' ? ImpactStyle.Light : style === 'medium' ? ImpactStyle.Medium : ImpactStyle.Heavy });
  } catch {
    /* no haptics on web */
  }
}

export function switchControl(checked: boolean, onChange: (value: boolean) => void, label: string): HTMLButtonElement {
  const button = el('button', { class: 'switch', role: 'switch', 'aria-checked': checked ? 'true' : 'false', 'aria-label': label });
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', next ? 'true' : 'false');
    void haptic('light');
    onChange(next);
  });
  return button;
}

export function seg<T extends string>(options: { value: T; label: string }[], current: T, onPick: (v: T) => void): HTMLElement {
  const wrap = el('div', { class: 'seg' });
  for (const option of options) {
    const button = el('button', { type: 'button', text: option.label, 'aria-pressed': option.value === current ? 'true' : 'false' });
    button.addEventListener('click', () => onPick(option.value));
    wrap.append(button);
  }
  return wrap;
}

export function fmtTemp(v: number | null): string {
  return v === null ? '—' : String(Math.round(v));
}

export function fmtPct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v)}`;
}

export function fmtClock(mhz: number | null): string {
  if (mhz === null) return '—';
  return mhz >= 1000 ? `${(mhz / 1000).toFixed(2)}G` : `${Math.round(mhz)}M`;
}

export function fmtBytes(bytes: number | null): string {
  if (bytes === null || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value < 10 && index > 0 ? value.toFixed(1) : Math.round(value)} ${units[index]}`;
}

export function fmtRate(bps: number | null): string {
  return bps === null ? '—' : `${fmtBytes(bps)}/s`;
}

export function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return `${Math.round(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  return `${Math.round(diff / 86_400_000)}d`;
}

export function thermal(state: 'cool' | 'warm' | 'hot' | 'critical'): string {
  return `state-${state}`;
}

export function thermalOf(temp: number | null): 'cool' | 'warm' | 'hot' | 'critical' {
  if (temp === null) return 'cool';
  if (temp >= 90) return 'critical';
  if (temp >= 75) return 'hot';
  if (temp >= 60) return 'warm';
  return 'cool';
}
