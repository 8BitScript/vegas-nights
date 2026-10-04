// Contact sheets, so the art can be judged without an emulator: every symbol as
// the machine would draw it, and a mocked reel window (frame, dividers, three
// reels) at two scroll offsets. The mock reproduces the machine's real limit —
// one ink colour per 8x8 cell — so a symbol scrolled half a cell shows the same
// colour clash the machine would.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from './png.mjs';
import { MACHINES, MACHINE_IDS } from './palettes.mjs';
import { convertTheme } from './build.mjs';
import { QUAD_CODE } from './convert.mjs';

const S = 4; // screen pixels per machine pixel

// 5x7 label font, one 5-bit row per line.
const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 27, 17], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0], '-': [0, 0, 0, 31, 0, 0, 0], ':': [0, 4, 0, 0, 0, 4, 0], '.': [0, 0, 0, 0, 0, 12, 12], '/': [1, 1, 2, 4, 8, 16, 16], '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8], x: [0, 0, 17, 10, 4, 10, 17],
};

class Image {
  constructor(w, h, bg = [24, 24, 28]) { this.w = w; this.h = h; this.rgba = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i += 1) this.rgba.set([...bg, 255], i * 4); }
  px(x, y, c) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.rgba.set([c[0], c[1], c[2], 255], (y * this.w + x) * 4); }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) this.px(x + i, y + j, c); }
  text(x, y, s, c = [230, 230, 230], scale = 2) {
    [...String(s).toUpperCase()].forEach((ch, k) => {
      const g = FONT[ch] ?? FONT[' '];
      g.forEach((row, j) => { for (let i = 0; i < 5; i += 1) if ((row >> (4 - i)) & 1) this.rect(x + (k * 6 + i) * scale, y + j * scale, scale, scale, c); });
    });
  }
}

/** A cell, drawn at S screen pixels per machine pixel. */
function drawCell(img, x, y, rows, ink, paper) {
  img.rect(x, y, 8 * S, 8 * S, paper);
  rows.forEach((byte, r) => { for (let c = 0; c < 8; c += 1) if ((byte >> (7 - c)) & 1) img.rect(x + c * S, y + r * S, S, S, ink); });
}
function quadRows(code) {
  const p = Math.max(0, QUAD_CODE.indexOf(code));
  const q = [(p >> 3) & 1, (p >> 2) & 1, (p >> 1) & 1, p & 1];
  const half = (a, b) => (a ? 0xf0 : 0) | (b ? 0x0f : 0);
  return [half(q[0], q[1]), half(q[0], q[1]), half(q[0], q[1]), half(q[0], q[1]), half(q[2], q[3]), half(q[2], q[3]), half(q[2], q[3]), half(q[2], q[3])];
}
function pseudoToCellRows(rowsA, rowsB, cx) {
  // two pseudo-pixel rows (bytes, bit7 = leftmost) -> the quadrant code for cell column cx -> 8 pixel rows
  const bit = (row, x) => (row >> (7 - x)) & 1;
  const p = (bit(rowsA, cx * 2) << 3) | (bit(rowsA, cx * 2 + 1) << 2) | (bit(rowsB, cx * 2) << 1) | bit(rowsB, cx * 2 + 1);
  return quadRows(QUAD_CODE[p]);
}

/** The reel window, composed the way a machine would: pixel rows pulled from the strip at `offset`. */
function drawWindow(img, ox, oy, theme, machine, data, order, offsetPx) {
  const spec = MACHINES[machine];
  const quad = spec.mode === 'quadrants';
  const { cellsW: SW, cellsH: SH } = data;
  const reels = 3, rowsVisible = 3;
  const frame = (name) => data.frame.names.indexOf(name);
  const ink = (i) => (quad ? spec.palette[1] : spec.palette[i]);
  const paper = quad ? spec.palette[0] : spec.palette[data.background ?? 0];
  const cols = 2 + reels * SW + (reels - 1);
  const rows = 2 + rowsVisible * SH;
  const put = (cx, cy, name) => {
    const f = frame(name);
    if (f < 0) return;
    const bits = quad ? quadRows(data.frame.codes[f]) : data.frame.bitmaps[f];
    drawCell(img, ox + cx * 8 * S, oy + cy * 8 * S, bits, quad ? ink(1) : ink(data.frame.colors[f]), paper);
  };
  for (let cy = 0; cy < rows; cy += 1) for (let cx = 0; cx < cols; cx += 1) put(cx, cy, 'PANEL');
  put(0, 0, 'TL'); put(cols - 1, 0, 'TR'); put(0, rows - 1, 'BL'); put(cols - 1, rows - 1, 'BR');
  for (let cx = 1; cx < cols - 1; cx += 1) { put(cx, 0, 'T'); put(cx, rows - 1, 'B'); }
  for (let cy = 1; cy < rows - 1; cy += 1) { put(0, cy, 'L'); put(cols - 1, cy, 'R'); }
  put(0, 1 + Math.floor(rowsVisible * SH / 2), 'ARROW_L'); put(cols - 1, 1 + Math.floor(rowsVisible * SH / 2), 'ARROW_R');
  const symbolPx = quad ? SH * 2 : SH * 8; // strip units: pseudo-pixel rows on the PET, pixels elsewhere
  for (let r = 0; r < reels; r += 1) {
    const x0 = 1 + r * (SW + 1);
    if (r > 0) { put(x0 - 1, 0, 'DIVT'); put(x0 - 1, rows - 1, 'DIVB'); for (let cy = 1; cy < rows - 1; cy += 1) put(x0 - 1, cy, 'DIV'); }
    const strip = order[r];
    for (let cy = 0; cy < rowsVisible * SH; cy += 1) {
      for (let cx = 0; cx < SW; cx += 1) {
        const X = ox + (x0 + cx) * 8 * S, Y = oy + (1 + cy) * 8 * S;
        if (quad) {
          const y0 = offsetPx + cy * 2;
          const rowAt = (y) => { const sym = data.symbols[strip[Math.floor(y / symbolPx) % strip.length]]; return sym.rows[y % symbolPx]; };
          drawCell(img, X, Y, pseudoToCellRows(rowAt(y0), rowAt(y0 + 1), cx), ink(1), paper);
        } else {
          const rowsBits = [], tally = new Map();
          for (let k = 0; k < 8; k += 1) {
            const y = offsetPx + cy * 8 + k;
            const si = strip[Math.floor(y / symbolPx) % strip.length];
            const yy = y % symbolPx;
            const cell = Math.floor(yy / 8) * SW + cx;
            const sym = data.symbols[si];
            const byte = sym.bitmap[cell * 8 + (yy % 8)];
            rowsBits.push(byte);
            let n = 0; for (let b = 0; b < 8; b += 1) n += (byte >> b) & 1;
            tally.set(sym.colors[cell], (tally.get(sym.colors[cell]) ?? 0) + n);
          }
          let best = 1, bestN = -1;
          for (const [c, n] of tally) if (n > bestN) { best = c; bestN = n; }
          drawCell(img, X, Y, rowsBits, ink(best), paper);
        }
      }
    }
  }
  return { w: cols * 8 * S, h: rows * 8 * S };
}

function drawSymbol(img, x, y, machine, data, index) {
  const spec = MACHINES[machine];
  const quad = spec.mode === 'quadrants';
  const sym = data.symbols[index];
  const paper = quad ? spec.palette[0] : spec.palette[data.background ?? 0];
  for (let cy = 0; cy < data.cellsH; cy += 1) {
    for (let cx = 0; cx < data.cellsW; cx += 1) {
      const X = x + cx * 8 * S, Y = y + cy * 8 * S;
      if (quad) drawCell(img, X, Y, pseudoToCellRows(sym.rows[cy * 2], sym.rows[cy * 2 + 1], cx), spec.palette[1], paper);
      else drawCell(img, X, Y, sym.bitmap.subarray((cy * data.cellsW + cx) * 8, (cy * data.cellsW + cx) * 8 + 8), spec.palette[sym.colors[cy * data.cellsW + cx]], paper);
    }
  }
}

export async function renderPreviews(theme, outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const machine of MACHINE_IDS) {
    const data = convertTheme(theme, machine);
    const n = data.symbols.length;
    const tile = data.cellsW * 8 * S;
    const gap = 3 * S;
    const perRow = Math.min(n, 9);
    const symbolRows = Math.ceil(n / perRow);
    const winW = (2 + 3 * data.cellsW + 2) * 8 * S;
    const width = Math.max(perRow * (tile + gap) + gap, 2 * winW + 3 * gap);
    const symbolBlock = symbolRows * (data.cellsH * 8 * S + 12 * S) + 10 * S;
    const winH = (2 + 3 * data.cellsH) * 8 * S;
    const img = new Image(width, symbolBlock + winH + 24 * S + 10 * S);
    img.text(gap, 2 * S, `${theme.title}  -  ${MACHINES[machine].label}`, [255, 255, 255], 2);
    data.symbols.forEach((s, i) => {
      const x = gap + (i % perRow) * (tile + gap), y = 10 * S + Math.floor(i / perRow) * (data.cellsH * 8 * S + 12 * S);
      drawSymbol(img, x, y, machine, data, i);
      img.text(x, y + data.cellsH * 8 * S + 2 * S, s.id, [200, 200, 120], 2);
    });
    const order = [0, 1, 2].map((r) => Array.from({ length: n }, (_, k) => (k + r * 2) % n));
    const symbolPx = MACHINES[machine].mode === 'quadrants' ? data.cellsH * 2 : data.cellsH * 8;
    const half = MACHINES[machine].mode === 'quadrants' ? Math.floor(symbolPx / 2) : symbolPx / 2;
    const top = symbolBlock + 8 * S;
    img.text(gap, top - 6 * S, 'REEL WINDOW  AT REST  /  SCROLLED HALF A SYMBOL', [160, 160, 160], 2);
    drawWindow(img, gap, top + 6 * S, theme, machine, data, order, 0);
    drawWindow(img, 2 * gap + winW, top + 6 * S, theme, machine, data, order, half);
    const file = join(outDir, `${theme.name}.${machine}.png`);
    writeFileSync(file, encodePng(img.w, img.h, img.rgba));
    console.log(`preview: ${file}`);
  }
}
