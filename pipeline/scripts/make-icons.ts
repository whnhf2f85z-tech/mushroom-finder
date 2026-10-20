/**
 * Draws the app icons (PNG) without image libraries: a brown, porcini-like mushroom on the app's green,
 * 4× supersampled. (Not red with white dots: that would be a poisonous fly agaric.)
 *   npx tsx pipeline/scripts/make-icons.ts   → web/public/icons/*.png
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT = join(import.meta.dirname, '../../web/public/icons');
const GREEN = [47, 93, 58];
const CAP = [139, 90, 43];
const STEM = [243, 234, 216];

/** Colour at (x, y) in a unit square, for a mushroom scaled by `s` around the centre (s < 1 leaves a safe zone). */
function colour(x: number, y: number, s: number, rounded: boolean): number[] | null {
  if (rounded) {
    const r = 0.18;
    const dx = Math.max(r - x, 0, x - (1 - r));
    const dy = Math.max(r - y, 0, y - (1 - r));
    if (dx * dx + dy * dy > r * r) return null; // transparent corner
  }
  const u = (x - 0.5) / s + 0.5;
  const v = (y - 0.5) / s + 0.5;
  // Cap: upper half of an ellipse.
  const cx = (u - 0.5) / 0.38;
  const cy = (v - 0.55) / 0.34;
  if (v <= 0.55 && cx * cx + cy * cy <= 1) return CAP;
  // Stem: rounded rectangle.
  if (u >= 0.38 && u <= 0.62 && v >= 0.54 && v <= 0.82) {
    const k = 0.05;
    const ex = Math.max(0.38 + k - u, 0, u - (0.62 - k));
    const ey = Math.max(0, v - (0.82 - k));
    if (ex * ex + ey * ey <= k * k) return STEM;
  }
  return GREEN;
}

function png(size: number, s: number, rounded: boolean): Buffer {
  const S = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let j = 0; j < S; j++)
        for (let i = 0; i < S; i++) {
          const c = colour((x + (i + 0.5) / S) / size, (y + (j + 0.5) / S) / size, s, rounded);
          if (!c) continue;
          r += c[0]!;
          g += c[1]!;
          b += c[2]!;
          a++;
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? r / a : 0;
      raw[o + 1] = a ? g / a : 0;
      raw[o + 2] = a ? b / a : 0;
      raw[o + 3] = Math.round((255 * a) / (S * S));
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(join(OUT, 'icon-192.png'), png(192, 0.9, true));
writeFileSync(join(OUT, 'icon-512.png'), png(512, 0.9, true));
// Maskable: full-bleed square, artwork inside the central 80 % safe zone.
writeFileSync(join(OUT, 'icon-maskable-512.png'), png(512, 0.72, false));
// iOS adds its own rounded corners and needs no transparency.
writeFileSync(join(OUT, 'apple-touch-icon.png'), png(180, 0.85, false));
writeFileSync(join(OUT, 'favicon-32.png'), png(32, 1, true));
console.log('Wrote icons to', OUT);
