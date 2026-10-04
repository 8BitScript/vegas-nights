// Mocks of the proposed layouts that are too large to build tonight (docs/reel-size.md), drawn from the
// REAL tile conversion (tools/tiles: the same resampling and nearest-colour code that emits the shipped tables), so the
// art a machine would get is what these show. Not emulator captures: the text is a stand-in font.
//   node tools/size/mock.mjs   ->  docs/reel-size/mock/*.png (1 machine pixel = 1 image pixel)
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Image } from './image.mjs';
import { loadTheme } from '../tiles/src/theme.mjs';
import { convertTheme } from '../tiles/src/build.mjs';
import { MACHINES, nearest } from '../tiles/src/palettes.mjs';
import { resample } from '../tiles/src/convert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'docs', 'reel-size', 'mock');
mkdirSync(OUT, { recursive: true });

const C64 = MACHINES.c64.palette;
const ROWS3 = [[0, 3, 4], [2, 1, 0], [3, 4, 1]];                 // classic: symbols shown by reel, top to bottom
const ROWS5 = [[0, 1, 2, 3, 4], [5, 7, 2, 0, 1], [3, 8, 4, 2, 6], [1, 2, 0, 7, 5], [4, 3, 1, 8, 2]]; // cosmic

const withCells = (theme, w, h) => ({ ...theme, cells: { default: [w, h] } });

/** The machine's frame and glyph-built symbols at rest: cells of 8x8 pixels on a grid. Returns the pixel box used. */
function glyphMachine(img, ox, oy, theme, machine, order) {
  const data = convertTheme(theme, machine);
  const { cellsW: SW, cellsH: SH } = data;
  const reels = order.length, rowsShown = order[0].length;
  const cols = 2 + reels * SW + (reels - 1), rows = 2 + rowsShown * SH;
  const pal = MACHINES[machine].palette;
  const paper = pal[data.background ?? 0];
  const frame = (name) => data.frame.names.indexOf(name);
  const put = (cx, cy, name) => { const f = frame(name); if (f >= 0) img.cell(ox + cx * 8, oy + cy * 8, data.frame.bitmaps[f], pal[data.frame.colors[f]], paper); };
  for (let cy = 0; cy < rows; cy += 1) for (let cx = 0; cx < cols; cx += 1) put(cx, cy, 'PANEL');
  put(0, 0, 'TL'); put(cols - 1, 0, 'TR'); put(0, rows - 1, 'BL'); put(cols - 1, rows - 1, 'BR');
  for (let cx = 1; cx < cols - 1; cx += 1) { put(cx, 0, 'T'); put(cx, rows - 1, 'B'); }
  for (let cy = 1; cy < rows - 1; cy += 1) { put(0, cy, 'L'); put(cols - 1, cy, 'R'); }
  put(0, 1 + Math.floor(rowsShown * SH / 2), 'ARROW_L'); put(cols - 1, 1 + Math.floor(rowsShown * SH / 2), 'ARROW_R');
  for (let r = 0; r < reels; r += 1) {
    const x0 = 1 + r * (SW + 1);
    if (r > 0) { put(x0 - 1, 0, 'DIVT'); put(x0 - 1, rows - 1, 'DIVB'); for (let cy = 1; cy < rows - 1; cy += 1) put(x0 - 1, cy, 'DIV'); }
    order[r].forEach((symbol, ry) => {
      for (let cy = 0; cy < SH; cy += 1) for (let cx = 0; cx < SW; cx += 1) {
        const cell = cy * SW + cx;
        img.cell(ox + (x0 + cx) * 8, oy + (1 + ry * SH + cy) * 8, data.symbols[symbol].bitmap.subarray(cell * 8, cell * 8 + 8), pal[data.symbols[symbol].colors[cell]], paper);
      }
    });
  }
  return { w: cols * 8, h: rows * 8, cols, rows, glyphs: reels * rowsShown * SW * SH + 14 };
}

/** A hardware sprite from a master: `w` x `h` mono pixels, one colour (the dominant one), drawn `ex` x `ey` times as big. */
function monoSprite(master, w, h) {
  const r = resample(master, w, h);
  const tally = new Map();
  const ink = [];
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    if (r.cover[y * w + x] < 0.5) continue;
    const c = nearest(C64, [r.red[y * w + x], r.green[y * w + x], r.blue[y * w + x]], Array.from({ length: 15 }, (_, i) => i + 1));
    tally.set(c, (tally.get(c) ?? 0) + 1); ink.push([x, y]);
  }
  let best = 1, n = -1; for (const [c, k] of tally) if (k > n) { best = c; n = k; }
  return { ink, color: C64[best] };
}

/** Reels of stacked sprites inside a cell-grid frame; sprites are cut at the window (the frame cells hide the overflow). */
function spriteMachine(img, ox, oy, theme, order, { sw, sh, ex, ey, gapCells = 1 }) {
  const reels = order.length, rowsShown = order[0].length;
  const symW = sw * ex, symH = sh * ey;
  const innerW = reels * symW + (reels - 1) * gapCells * 8, innerH = rowsShown * symH;
  const cols = Math.ceil(innerW / 8) + 2, rows = Math.ceil(innerH / 8) + 2;
  const data = convertTheme(theme, 'c64');
  const pal = C64, paper = pal[0];
  const frame = (name) => data.frame.names.indexOf(name);
  const put = (cx, cy, name) => { const f = frame(name); if (f >= 0) img.cell(ox + cx * 8, oy + cy * 8, data.frame.bitmaps[f], pal[data.frame.colors[f]], paper); };
  for (let cy = 0; cy < rows; cy += 1) for (let cx = 0; cx < cols; cx += 1) put(cx, cy, 'PANEL');
  put(0, 0, 'TL'); put(cols - 1, 0, 'TR'); put(0, rows - 1, 'BL'); put(cols - 1, rows - 1, 'BR');
  for (let cx = 1; cx < cols - 1; cx += 1) { put(cx, 0, 'T'); put(cx, rows - 1, 'B'); }
  for (let cy = 1; cy < rows - 1; cy += 1) { put(0, cy, 'L'); put(cols - 1, cy, 'R'); }
  const left = ox + 8, top = oy + 8;
  const sprites = theme.symbols.map((s) => monoSprite(s.img, sw, sh));
  for (let r = 0; r < reels; r += 1) {
    const x = left + r * (symW + gapCells * 8);
    if (r > 0) for (let cy = 0; cy < rows; cy += 1) put(1 + Math.round((x - gapCells * 8 - left) / 8), cy, cy === 0 ? 'DIVT' : cy === rows - 1 ? 'DIVB' : 'DIV');
    order[r].forEach((symbol, ry) => {
      const sp = sprites[symbol];
      for (const [px, py] of sp.ink) img.rect(x + px * ex, top + ry * symH + py * ey, ex, ey, sp.color);
    });
  }
  return { w: cols * 8, h: rows * 8, cols, rows, sprites: reels * (rowsShown + 1) };
}

/** The X16 / web "big sprite" look: the 48x48 masters as they are, in a cell-grid frame. */
function masterMachine(img, ox, oy, theme, order, pitch = 48) {
  const reels = order.length, rowsShown = order[0].length;
  const innerW = reels * pitch + (reels - 1) * 16, innerH = rowsShown * pitch;
  const cols = Math.ceil(innerW / 8) + 4, rows = Math.ceil(innerH / 8) + 4;
  img.rect(ox, oy, cols * 8, rows * 8, [191, 206, 114]);
  img.rect(ox + 16, oy + 16, innerW, innerH, [0, 0, 0]);
  for (let r = 1; r < reels; r += 1) img.rect(ox + 16 + r * (pitch + 16) - 16, oy + 16, 16, innerH, [139, 84, 41]);
  order.forEach((col, r) => col.forEach((symbol, ry) => {
    const { width, height, rgba } = theme.symbols[symbol].img;
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (rgba[o + 3] >= 128) img.px(ox + 16 + r * (pitch + 16) + x, oy + 16 + ry * pitch + y, [rgba[o], rgba[o + 1], rgba[o + 2]]);
    }
  }));
  return { w: cols * 8, h: rows * 8, cols, rows };
}

/** The quadrant route as the web would draw it: S x S cells a symbol from the host font's 2x2 blocks, one colour a cell. */
function quadMachine(img, ox, oy, theme, S, order, machine = 'web') {
  const reels = order.length, rowsShown = order[0].length;
  const P = S * 2;
  const pal = MACHINES[machine].palette;
  const cols = 2 + reels * S + (reels - 1), rows = 2 + rowsShown * S;
  const solid = (cx, cy, c) => img.rect(ox + cx * 8, oy + cy * 8, 8, 8, c);
  const gold = pal[7], orange = pal[8];
  for (let cx = 0; cx < cols; cx += 1) { solid(cx, 0, gold); solid(cx, rows - 1, gold); }
  for (let cy = 0; cy < rows; cy += 1) { solid(0, cy, gold); solid(cols - 1, cy, gold); }
  const symbols = theme.symbols.map((sym) => {
    const r = resample(sym.img, P, P);
    const bits = (x, y) => (r.cover[y * P + x] >= 0.5 ? 1 : 0);
    const colorAt = (k, c) => {
      let best = 1, n = -1; const tally = new Map();
      for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) {
        const i = (k * 2 + y) * P + c * 2 + x;
        if (r.cover[i] < 0.5) continue;
        const col = nearest(pal, [r.red[i], r.green[i], r.blue[i]], Array.from({ length: 15 }, (_, q) => q + 1));
        tally.set(col, (tally.get(col) ?? 0) + 1);
      }
      for (const [col, m] of tally) if (m > n) { best = col; n = m; }
      return best;
    };
    return { bits, colorAt };
  });
  for (let r = 0; r < reels; r += 1) {
    const x0 = 1 + r * (S + 1);
    if (r > 0) for (let cy = 0; cy < rows; cy += 1) solid(x0 - 1, cy, cy === 0 || cy === rows - 1 ? gold : orange);
    order[r].forEach((symbol, ry) => {
      const sym = symbols[symbol];
      for (let k = 0; k < S; k += 1) for (let c = 0; c < S; c += 1) {
        const X = ox + (x0 + c) * 8, Y = oy + (1 + ry * S + k) * 8;
        const ink = pal[sym.colorAt(k, c)];
        for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) if (sym.bits(c * 2 + x, k * 2 + y)) img.rect(X + x * 4, Y + y * 4, 4, 4, ink);
      }
    });
  }
  return { w: cols * 8, h: rows * 8, cols, rows };
}

function panel(img, x, y) {
  img.text(x, y, 'CREDIT 001900', [255, 255, 255], 1);
  img.text(x, y + 9, 'BET 000100  WIN 000000', [255, 255, 255], 1);
}

const save = (name, img, meta) => { writeFileSync(join(OUT, `${name}.png`), img.png()); console.log(`${name}  ${img.w}x${img.h}  ${JSON.stringify(meta)}`); };

const classic = await loadTheme('classic');
const cosmic = await loadTheme('cosmic');

// ---- C64, 320x200 inside a 384x272 window --------------------------------------------------------------
const c64 = () => { const img = new Image(384, 272, [0, 0, 0]); img.rect(32, 36, 320, 200, [0, 0, 0]); return img; };

{ // route (a): 32x32 art in the glyph composer
  const img = c64();
  const box = glyphMachine(img, 32 + Math.floor((40 - 16) / 2) * 8, 36 + 16, withCells(classic, 4, 4), 'c64', ROWS3);
  img.text(32 + 8 * 12, 36 + 16 + box.h + 6, 'VEGAS NIGHTS - 3X3', [255, 255, 255], 1);
  panel(img, 32 + 8 * 14, 36 + 16 + box.h + 20);
  save('c64-glyph32-3x3', img, box);
}
{ // route (b): sprite reels, 24x21 sprites expanded 2x2 -> 48x42 symbols
  const img = c64();
  const box = spriteMachine(img, 32 + 8 * 11, 36 + 8, classic, ROWS3, { sw: 24, sh: 21, ex: 2, ey: 2 });
  img.text(32 + 8 * 12, 36 + 8 + box.h + 6, 'VEGAS NIGHTS - 3X3', [255, 255, 255], 1);
  panel(img, 32 + 8 * 14, 36 + 8 + box.h + 20);
  save('c64-sprite-3x3', img, box);
}
{ // 5x5: sprite reels, 24x21 sprites unexpanded
  const img = c64();
  const box = spriteMachine(img, 32 + 8 * 8, 36 + 8, cosmic, ROWS5, { sw: 24, sh: 21, ex: 1, ey: 1 });
  img.text(32 + 8 * 10, 36 + 8 + box.h + 6, 'VEGAS NIGHTS - 5X5', [255, 255, 255], 1);
  panel(img, 32 + 8 * 12, 36 + 8 + box.h + 20);
  save('c64-sprite-5x5', img, box);
}

// ---- web, 384x216 ---------------------------------------------------------------------------------------
{ // 117-glyph table: 24x24 art (95 glyphs), the C64/X16 look
  const img = new Image(384, 216, [0, 0, 0]);
  const box = glyphMachine(img, Math.floor((48 - 13) / 2) * 8, 16, withCells(classic, 3, 3), 'web', ROWS3);
  panel(img, 140, 16 + box.h + 8);
  save('web-glyph24-3x3', img, box);
}
{ // a 256-glyph table: 32x32 art (158 glyphs)
  const img = new Image(384, 216, [0, 0, 0]);
  const box = glyphMachine(img, Math.floor((48 - 16) / 2) * 8, 8, withCells(classic, 4, 4), 'web', ROWS3);
  panel(img, 140, 8 + box.h + 6);
  save('web-glyph32-3x3', img, box);
}
{ // a sprite layer: the 48x48 masters
  const img = new Image(384, 216, [0, 0, 0]);
  const box = masterMachine(img, Math.floor((384 - (3 * 48 + 2 * 16 + 32)) / 16) * 8, 4, classic, ROWS3);
  panel(img, 140, 4 + box.h + 4);
  save('web-sprite-3x3', img, box);
}
{ // 5x5 at 16x16 art in a 117-glyph table (100 reel glyphs + 14 frame)
  const img = new Image(384, 216, [0, 0, 0]);
  const box = glyphMachine(img, Math.floor((48 - 16) / 2) * 8, 8, withCells(cosmic, 2, 2), 'web', ROWS5);
  panel(img, 140, 8 + box.h + 6);
  save('web-glyph16-5x5', img, box);
}

{ // the web's own quadrant blocks, bigger (no runtime change): S = 6 on the 3x3
  const img = new Image(384, 216, [0, 0, 0]);
  const box = quadMachine(img, Math.floor((48 - 22) / 2) * 8, 8, classic, 6, ROWS3);
  panel(img, 140, 8 + box.h + 4);
  save('web-quad-3x3', img, box);
}
{ // ... and S = 4 on the 5x5
  const img = new Image(384, 216, [0, 0, 0]);
  const box = quadMachine(img, Math.floor((48 - 26) / 2) * 8, 4, cosmic, 4, ROWS5);
  panel(img, 140, 4 + box.h + 4);
  save('web-quad-5x5', img, box);
}
