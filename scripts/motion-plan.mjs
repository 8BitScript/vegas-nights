// Plan sketches for the bonus round's new look: a real capture on the left, the same machine and art
// with the proposed border treatment on the right. Not a build: the owner's approval sketch, made by
// repainting a real frame (shots/motion/<machine>/f<N>.png from scripts/motion.mjs).
//
//   node scripts/motion-plan.mjs c64|cx16
//
// The proposed look in one line: the playfield and the rows under the panel stay black; the border
// carries ONE warm gold ramp (never the whole palette) in a few wide stripes that step slowly.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { ROOT } from '../test/support/table.mjs';
import { decodePng } from '../test/support/png.mjs';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]); const h = Buffer.alloc(4); h.writeUInt32BE(data.length); const t = Buffer.alloc(4); t.writeUInt32BE(crc(body)); return Buffer.concat([h, body, t]); };
function savePng(file, w, h, px) {
  const raw = Buffer.alloc((1 + w * 3) * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { const v = px[y * w + x], o = y * (1 + w * 3) + 1 + x * 3; raw[o] = (v >> 16) & 255; raw[o + 1] = (v >> 8) & 255; raw[o + 2] = v & 255; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

const load = (m, n) => decodePng(readFileSync(join(ROOT, 'shots', 'motion', m, `f${n}.png`)));
const BLACK = 0x000000;

// The proposed ramps (RGB). C64/VIC-20: entries that exist in the machine's own palette; X16: a smooth 12-bit gradient.
const GOLD_C64 = [0x000000, 0x433900, 0x6f4f25, 0x9a6759, 0xb8c76f, 0xffffff, 0xb8c76f, 0x9a6759, 0x6f4f25, 0x433900];
const mix = (a, b, t) => {
  const c = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (c(16) << 16) | (c(8) << 8) | c(0);
};
const gradient = (stops, n) => Array.from({ length: n }, (_, i) => {
  const f = (i / (n - 1)) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(f));
  return mix(stops[k], stops[k + 1], f - k);
});

/** The longest run of black along a line, as [start, end). */
function blackRun(length, at) {
  let best = [0, 0], from = -1;
  for (let i = 0; i <= length; i += 1) {
    const black = i < length && at(i) === BLACK;
    if (black && from < 0) from = i;
    if (!black && from >= 0) { if (i - from > best[1] - best[0]) best = [from, i]; from = -1; }
  }
  return best;
}

/** The playfield rectangle: the longest black run across the middle row and down a margin column. */
function playfield(png) {
  const row = Math.floor(png.height * 0.62);
  const [x0, x1] = blackRun(png.width, (x) => png.at(x, row));
  const col = x0 + 6;
  const [y0, y1] = blackRun(png.height, (y) => png.at(col, y));
  return { x0, x1, y0, y1 };
}

function repaint(png, { stripeH, ramp, phase = 0, glowRows = true, playfield: pf }) {
  const out = Array.from({ length: png.width * png.height }, (_, i) => png.at(i % png.width, Math.floor(i / png.width)));
  const f = pf ?? playfield(png);
  const inside = (x, y) => x >= f.x0 && x < f.x1 && y >= f.y0 && y < f.y1;
  for (let y = 0; y < png.height; y += 1) for (let x = 0; x < png.width; x += 1) {
    if (!inside(x, y)) out[y * png.width + x] = ramp[(Math.floor(y / stripeH) + phase) % ramp.length];
  }
  if (glowRows) {
    // Rows under the panel that are mostly non-black are the glow bands: back to black.
    for (let y = f.y0; y < f.y1; y += 1) {
      let lit = 0;
      for (let x = f.x0; x < f.x1; x += 1) if (png.at(x, y) !== BLACK) lit += 1;
      if (lit > 0.7 * (f.x1 - f.x0)) for (let x = f.x0; x < f.x1; x += 1) out[y * png.width + x] = BLACK;
    }
  }
  return out;
}

// playfield: the picture area in capture pixels (the C64's 320x200 inside a 32-pixel side border, the VICE
// capture cropping the top border to 22 lines); omit to detect it from the black run.
const SPEC = {
  // frame: a capture with no flash; stripeH in capture pixels (one stripe = 18 raster lines on the C64).
  c64: { frame: 1004, stripeH: 18, ramp: GOLD_C64, playfield: { x0: 32, x1: 352, y0: 22, y1: 222 } },
    cx16: { frame: 1104, stripeH: 20, ramp: gradient([0x120a3a, 0x6a3a9a, 0xffb830, 0xfff0b0, 0xffb830, 0x6a3a9a, 0x120a3a], 24), playfield: { x0: 16, x1: 624, y0: 16, y1: 464 } },
};

// Only the two machines this sketches; the name builds file paths, so it is checked against a list
// rather than used as typed.
// (The name is chosen between two literals, so nothing typed on the command line reaches a path.)
const m = process.argv[2] === 'c64' ? 'c64' : process.argv[2] === 'cx16' ? 'cx16' : undefined;
if (m === undefined) {
  console.error('usage: node scripts/motion-plan.mjs c64|cx16');
  process.exit(2);
}
if (!SPEC[m]) { console.error('usage: node scripts/motion-plan.mjs c64|cx16'); process.exit(2); }
const { frame, stripeH, ramp, playfield: pf } = SPEC[m];
const png = load(m, frame);
const after = repaint(png, { stripeH, ramp, playfield: pf });
const w = png.width, h = png.height, gap = 12;
const sheet = new Array((w * 2 + gap) * h).fill(0x202020);
for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
  sheet[y * (w * 2 + gap) + x] = png.at(x, y);
  sheet[y * (w * 2 + gap) + w + gap + x] = after[y * w + x];
}
const out = join(ROOT, 'docs', 'motion', m);
mkdirSync(out, { recursive: true });
savePng(join(out, 'plan-before-after.png'), w * 2 + gap, h, sheet);
console.log(`${join(out, 'plan-before-after.png')}: ${w * 2 + gap}x${h}  playfield ${JSON.stringify(pf ?? playfield(png))}`);
