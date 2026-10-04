// What src/labs/tile-test/main.8bs puts on the screen, as pixels: the expected
// image the cell-exact test compares a headless screenshot against. Keep this and
// main.8bs in step — the test failing is how drift shows.
import { MACHINES } from './palettes.mjs';
import { QUAD_CODE } from './convert.mjs';

const REELS = 3;
const WINDOW_ROWS = 3;
const REEL_SYMBOLS = [0, 1, 2, 2, 3, 4, 4, 5, 0]; // [reel * 3 + row], symbol indexes in the engine's order

/** [{ col, row, symbol?: {index, cx, cy}, frame?: name }] for every cell the lab draws. */
export function tileTestCells(data) {
  const cells = [];
  const { cellsW: SW, cellsH: SH } = data;
  const symbolAt = (col, row, symbol) => {
    for (let cy = 0; cy < SH; cy += 1) for (let cx = 0; cx < SW; cx += 1) cells.push({ col: col + cx, row: row + cy, symbol, cx, cy });
  };
  const frameAt = (col, row, name) => cells.push({ col, row, frame: name });
  for (let s = 0; s < data.symbols.length; s += 1) symbolAt(1 + s * SW, 1, s);
  const left = 4, top = 5, rows = SH * WINDOW_ROWS;
  const right = left + 1 + REELS * SW + (REELS - 1);
  const bottom = top + 1 + rows;
  frameAt(left, top, 'TL'); frameAt(right, top, 'TR'); frameAt(left, bottom, 'BL'); frameAt(right, bottom, 'BR');
  for (let col = left + 1; col < right; col += 1) { frameAt(col, top, 'T'); frameAt(col, bottom, 'B'); }
  for (let row = top + 1; row < bottom; row += 1) { frameAt(left, row, 'L'); frameAt(right, row, 'R'); }
  frameAt(left, top + 1 + (rows >> 1), 'ARROW_L');
  frameAt(right, top + 1 + (rows >> 1), 'ARROW_R');
  for (let reel = 0; reel < REELS; reel += 1) {
    const x0 = left + 1 + reel * (SW + 1);
    if (reel > 0) {
      frameAt(x0 - 1, top, 'DIVT'); frameAt(x0 - 1, bottom, 'DIVB');
      for (let row = top + 1; row < bottom; row += 1) frameAt(x0 - 1, row, 'DIV');
    }
    for (let k = 0; k < WINDOW_ROWS; k += 1) symbolAt(x0, top + 1 + k * SH, REEL_SYMBOLS[reel * WINDOW_ROWS + k]);
  }
  return cells;
}

/** The expected screen as one colour index per pixel (-1 = paper), `cols` x `rows` cells of 8x8. */
export function expectedScreen(machine, data, cols, rows) {
  const spec = MACHINES[machine];
  const w = cols * 8, h = rows * 8;
  const px = new Int16Array(w * h).fill(-1);
  const put = (col, row, bytes, color) => {
    for (let r = 0; r < 8; r += 1) for (let c = 0; c < 8; c += 1) px[(row * 8 + r) * w + col * 8 + c] = -1; // a cell replaces what was there
    for (let r = 0; r < 8; r += 1) for (let c = 0; c < 8; c += 1) if ((bytes[r] >> (7 - c)) & 1) px[(row * 8 + r) * w + col * 8 + c] = color;
  };
  for (const cell of tileTestCells(data)) {
    if (spec.mode === 'quadrants') {
      let code;
      if (cell.frame) code = data.frame.codes[data.frame.names.indexOf(cell.frame)];
      else {
        const s = data.symbols[cell.symbol];
        const top = s.rows[cell.cy * 2], bottom = s.rows[cell.cy * 2 + 1];
        const bit = (row, x) => (row >> (7 - x)) & 1;
        const x = cell.cx * 2;
        code = QUAD_CODE[(bit(top, x) << 3) | (bit(top, x + 1) << 2) | (bit(bottom, x) << 1) | bit(bottom, x + 1)];
      }
      const p = QUAD_CODE.indexOf(code);
      const half = (a, b) => (a ? 0xf0 : 0) | (b ? 0x0f : 0);
      const upper = half((p >> 3) & 1, (p >> 2) & 1), lower = half((p >> 1) & 1, p & 1);
      put(cell.col, cell.row, [upper, upper, upper, upper, lower, lower, lower, lower], 1);
    } else if (cell.frame) {
      const f = data.frame.names.indexOf(cell.frame);
      put(cell.col, cell.row, data.frame.bitmaps[f], data.frame.colors[f]);
    } else {
      const g = cell.symbol * data.cellsW * data.cellsH + cell.cy * data.cellsW + cell.cx;
      put(cell.col, cell.row, data.symbols[cell.symbol].bitmap.subarray((cell.cy * data.cellsW + cell.cx) * 8, (cell.cy * data.cellsW + cell.cx) * 8 + 8), data.symbols[cell.symbol].colors[cell.cy * data.cellsW + cell.cx]);
    }
  }
  return { w, h, px };
}
