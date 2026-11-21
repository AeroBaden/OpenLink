#!/usr/bin/env node
/**
 * Generates every OpenLink icon from code — no ImageMagick, no sharp, no
 * binary assets checked in. The mark is the OpenLink loop: an infinity stroke
 * lit from ice-blue to mint on a dark, softly lit tile (and a light variant).
 *
 *   node scripts/make-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* --------------------------------------------------------------- PNG encoder */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------- canvas */

const WHITE = [255, 255, 255];

function canvas(size) {
  return { size, data: new Float32Array(size * size * 4) };
}

/** Source-over a straight-alpha colour onto the canvas. */
function over(cv, index, rgb, alpha) {
  if (alpha <= 0) return;
  const d = cv.data;
  const da = d[index + 3];
  const outA = alpha + da * (1 - alpha);
  if (outA <= 0) return;
  for (let c = 0; c < 3; c++) {
    d[index + c] = (rgb[c] * alpha + d[index + c] * da * (1 - alpha)) / outA;
  }
  d[index + 3] = outA;
}

function toPng(cv) {
  const { size, data } = cv;
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const a = Math.min(1, Math.max(0, data[i * 4 + 3]));
    rgba[i * 4] = Math.round(Math.min(255, Math.max(0, data[i * 4])));
    rgba[i * 4 + 1] = Math.round(Math.min(255, Math.max(0, data[i * 4 + 1])));
    rgba[i * 4 + 2] = Math.round(Math.min(255, Math.max(0, data[i * 4 + 2])));
    rgba[i * 4 + 3] = Math.round(a * 255);
  }
  return encodePng(size, size, rgba);
}

/** Area-averaging downscale — good enough for icon sizes and keeps edges clean. */
function downscale(cv, target) {
  const out = canvas(target);
  const ratio = cv.size / target;
  for (let y = 0; y < target; y++) {
    const y0 = Math.floor(y * ratio);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * ratio));
    for (let x = 0; x < target; x++) {
      const x0 = Math.floor(x * ratio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * ratio));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * cv.size + sx) * 4;
          const sa = cv.data[i + 3];
          r += cv.data[i] * sa;
          g += cv.data[i + 1] * sa;
          b += cv.data[i + 2] * sa;
          a += sa;
          n++;
        }
      }
      const o = (y * target + x) * 4;
      if (a > 0) {
        out.data[o] = r / a;
        out.data[o + 1] = g / a;
        out.data[o + 2] = b / a;
      }
      out.data[o + 3] = a / n;
    }
  }
  return out;
}

/* -------------------------------------------------------------------- shapes */

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (edge0, edge1, v) => {
  const t = clamp01((v - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Signed distance to a rounded square: negative inside, positive outside. */
function roundedSquareDistance(x, y, size, radius) {
  const half = size / 2;
  const qx = Math.abs(x - half) - (half - radius);
  const qy = Math.abs(y - half) - (half - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function roundedSquareCoverage(x, y, size, radius) {
  return clamp01(-roundedSquareDistance(x, y, size, radius) + 0.5);
}

function circleCoverage(x, y, size) {
  const half = size / 2;
  return clamp01(half - Math.hypot(x - half, y - half) + 0.5);
}

/** Distance from point to a segment, used to rasterise the loop stroke. */
function segmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : clamp01(((px - x1) * dx + (py - y1) * dy) / len);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

/* ---------------------------------------------------------------------- tile */

/**
 * Dark tile: near-black base with a soft top light and a faint rim, so the mark
 * sits in the same OLED family as the app.
 */
function drawTile(cv, { top, bottom, rim, radiusRatio = 0.235, circle = false }) {
  const { size } = cv;
  const radius = circle ? size / 2 : size * radiusRatio;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const dist = circle ? Math.hypot(px - size / 2, py - size / 2) - size / 2 : roundedSquareDistance(px, py, size, radius);
      const cover = clamp01(-dist + 0.5);
      if (cover <= 0) continue;
      let color = mix(top, bottom, py / size);
      // radial key light from the upper left
      const key = Math.hypot(px - size * 0.3, py - size * 0.16) / (size * 0.9);
      color = mix(color, WHITE, 0.075 * (1 - smooth(0, 1, key)));
      // rim light: a 2px band just inside the silhouette
      const rimMask = smooth(-3.4, -0.6, dist);
      if (rimMask > 0) color = mix(color, rim, 0.55 * rimMask);
      over(cv, (y * size + x) * 4, color, cover);
    }
  }
}

/* --------------------------------------------------------------------- glyph */

const BLUE = [62, 168, 255];
const CYAN = [78, 214, 255];
const MINT = [124, 242, 200];

/**
 * Rasterises the OpenLink loop: a Gerono lemniscate stroked with a running
 * ice→mint gradient plus two halo passes for the neon bloom.
 */
/**
 * The OpenLink mark: one continuous neon ribbon — a Bernoulli lemniscate with
 * round lobes, a clean crossing in the middle and no visible ends. Lit from
 * ice-blue through cyan to mint. The bloom is a blurred copy of the stroke
 * coverage, which keeps the 1024 px master cheap to rasterise.
 */
function lemniscatePoints(size, span, offsetY) {
  const a = (size * span) / 2;
  const cx = size / 2;
  const cy = size / 2 + offsetY;
  const stretch = 1.45;
  const total = Math.max(900, Math.round(size * 3.2));
  const points = [];
  for (let i = 0; i <= total; i++) {
    const t = (i / total) * Math.PI * 2;
    const s = Math.sin(t);
    const c = Math.cos(t);
    const denom = 1 + s * s;
    points.push({ x: cx + (a * c) / denom, y: cy + (stretch * a * s * c) / denom });
  }
  return points;
}

/** Separable box blur over a coverage field — the cheap half of the neon glow. */
function blurCoverage(src, size, radius) {
  const r = Math.max(1, Math.round(radius));
  const norm = 1 / (r * 2 + 1);
  const clamp = (i) => (i < 0 ? 0 : i >= size ? size - 1 : i);
  const tmp = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + clamp(x)];
    for (let x = 0; x < size; x++) {
      tmp[row + x] = sum * norm;
      sum += src[row + clamp(x + r + 1)] - src[row + clamp(x - r)];
    }
  }
  const out = new Float32Array(size * size);
  for (let x = 0; x < size; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[clamp(y) * size + x];
    for (let y = 0; y < size; y++) {
      out[y * size + x] = sum * norm;
      sum += tmp[clamp(y + r + 1) * size + x] - tmp[clamp(y - r) * size + x];
    }
  }
  return out;
}

function drawLoop(cv, { span = 0.68, thickness = 0.05, glow = 1, offsetY = 0, tone = 'dark' }) {
  const { size } = cv;
  const points = lemniscatePoints(size, span, offsetY);
  const stroke = Math.max(1.8, size * thickness);
  const half = stroke / 2;

  const start = tone === 'dark' ? BLUE : [20, 108, 200];
  const middle = tone === 'dark' ? CYAN : [26, 150, 190];
  const end = tone === 'dark' ? MINT : [12, 146, 112];
  const left = size / 2 - (size * span) / 2;
  const colorAt = (x) => {
    const t = clamp01((x - (left - stroke)) / (size * span + stroke * 2));
    return t < 0.5 ? mix(start, middle, t * 2) : mix(middle, end, (t - 0.5) * 2);
  };

  // Stroke coverage, max-composited so the strand crossing itself stays even.
  const core = new Float32Array(size * size);
  const reach = Math.ceil(half + 1.5);
  for (const p of points) {
    const x0 = Math.max(0, Math.floor(p.x - reach));
    const x1 = Math.min(size - 1, Math.ceil(p.x + reach));
    const y0 = Math.max(0, Math.floor(p.y - reach));
    const y1 = Math.min(size - 1, Math.ceil(p.y + reach));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - p.y;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - p.x;
        const cover = clamp01(half + 0.75 - Math.hypot(dx, dy));
        const idx = y * size + x;
        if (cover > core[idx]) core[idx] = cover;
      }
    }
  }

  // Neon bloom: two blurred copies of the stroke, composited behind it.
  if (glow > 0) {
    const tight = blurCoverage(core, size, size * 0.018);
    const wide = blurCoverage(core, size, size * 0.055);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const halo = Math.min(1, (tight[i] * 1.4 + wide[i] * 1.6) * glow);
        if (halo > 0.002) over(cv, i * 4, colorAt(x), halo * 0.62);
      }
    }
  }

  // The ribbon itself.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cover = core[y * size + x];
      if (cover > 0) over(cv, (y * size + x) * 4, colorAt(x), cover);
    }
  }
}

/* --------------------------------------------------------------------- ICO */

function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((entry, index) => {
    const base = index * 16;
    dir[base] = entry.size >= 256 ? 0 : entry.size;
    dir[base + 1] = entry.size >= 256 ? 0 : entry.size;
    dir.writeUInt16LE(1, base + 4);
    dir.writeUInt16LE(32, base + 6);
    dir.writeUInt32LE(entry.data.length, base + 8);
    dir.writeUInt32LE(offset, base + 12);
    offset += entry.data.length;
  });
  return Buffer.concat([header, dir, ...entries.map((entry) => entry.data)]);
}

/* ------------------------------------------------------------------- assets */

const MASTER = 1024;

function darkTile() {
  const cv = canvas(MASTER);
  drawTile(cv, { top: [44, 47, 54], bottom: [22, 24, 28], rim: [120, 130, 148] });
  drawLoop(cv, { span: 0.7, thickness: 0.05, glow: 1.15 });
  return cv;
}

function darkRound() {
  const cv = canvas(MASTER);
  drawTile(cv, { top: [44, 47, 54], bottom: [22, 24, 28], rim: [120, 130, 148], circle: true });
  drawLoop(cv, { span: 0.64, thickness: 0.048, glow: 1.1 });
  return cv;
}

function lightTile() {
  const cv = canvas(MASTER);
  drawTile(cv, { top: [253, 253, 254], bottom: [231, 233, 237], rim: [255, 255, 255] });
  drawLoop(cv, { span: 0.7, thickness: 0.05, glow: 0.16, tone: 'light' });
  return cv;
}

function transparentGlyph({ span = 0.64, thickness = 0.05, glow = 1 }) {
  const cv = canvas(MASTER);
  drawLoop(cv, { span, thickness, glow });
  return cv;
}

function write(rel, data) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  console.log(`  ${rel} (${(data.length / 1024).toFixed(1)} KB)`);
}

console.log('OpenLink icons');
const dark = darkTile();
const round = darkRound();
const light = lightTile();
const glyph = transparentGlyph({ span: 0.64, thickness: 0.05 });

// Brand art (README, store listings, previews)
write('docs/logo.png', toPng(dark));
write('docs/logo-light.png', toPng(light));
write('desktop/public/logo.png', toPng(downscale(dark, 256)));
write('mobile/public/logo.png', toPng(downscale(dark, 256)));

// Desktop / Windows
write('desktop/build/icon.png', toPng(downscale(dark, 512)));
write('desktop/build/icon-light.png', toPng(downscale(light, 512)));
write('desktop/resources/icon.png', toPng(downscale(dark, 128)));
write(
  'desktop/build/icon.ico',
  ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: toPng(downscale(dark, size)) }))),
);
write('desktop/public/favicon.png', toPng(downscale(dark, 64)));
write('mobile/public/favicon.png', toPng(downscale(dark, 64)));

// Mobile source art
write('mobile/resources/icon.png', toPng(dark));
write('mobile/resources/icon-light.png', toPng(light));

// Android launcher assets
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [density, scale] of Object.entries(densities)) {
  const legacy = Math.round(48 * scale);
  const adaptive = Math.round(108 * scale);
  const res = `mobile/android/app/src/main/res/mipmap-${density}`;
  write(`${res}/ic_launcher.png`, toPng(downscale(dark, legacy)));
  write(`${res}/ic_launcher_round.png`, toPng(downscale(round, legacy)));
  // Adaptive foreground: transparent, mark inside the 66dp safe zone.
  write(`${res}/ic_launcher_foreground.png`, toPng(downscale(glyph, adaptive)));
  write(`${res}/ic_launcher_foreground_light.png`, toPng(downscale(transparentGlyph({ span: 0.64, thickness: 0.05, glow: 0.5 }), adaptive)));
  write(`mobile/android/app/src/main/res/drawable-${density}/splash.png`, toPng(downscale(glyph, Math.round(160 * scale))));
}

console.log('done');
