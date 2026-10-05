// The X16 draws a reel as a stack of VERA sprites, 48 pixels to a symbol, and these read it
// back out of a screenshot: every pixel of the window, compared by colour with what the strip
// and the art say it must be. Used by the 3x3 and 5x5 adapters (adapters.mjs, adapters5.mjs).
//
// A reel's position is a number of "units" down its strip, and a unit is one of the labs' own
// rows — 24 to a symbol in the 3x3, 16 in the 5x5 — drawn `scale` pixels tall (2 and 3), so a
// symbol is 48 pixels either way. The window starts at block cell (2, 5): the sprites' art sits
// exactly on the text grid (the reel view says why), and the ruler gives that grid.
import { loadFile } from './table.mjs';

const SIDE = 48;
export const WINDOW_COL = 2;   // block column of the first reel's art
export const WINDOW_ROW = 5;   // block row of the window's first pixel row
export const REEL_CELLS = 8;   // cells from one reel's left edge to the next (48 px of art and a 16-px gap)

/** The 16 VERA palette entries as packed RGB (the 4-bit channels widened as the emulator does), black and the clear index both 0. */
function palette(file) {
  const bytes = loadFile(file).arrays.VERA_PALETTE;
  const rgb = [];
  for (let i = 0; i < 16; i += 1) {
    const gb = bytes[i * 2], r = bytes[i * 2 + 1] & 15;
    const g = gb >> 4, b = gb & 15;
    rgb.push(i < 2 ? 0 : ((r * 17) << 16) | ((g * 17) << 8) | (b * 17));
  }
  return rgb;
}

/**
 * @param {object} o
 * @param {string} o.file     the generated sprite file, relative to src/generated (tiles/classic-vera.8bs)
 * @param {number[]} o.strips the game's STRIPS array
 * @param {number} o.stops    STOPS
 * @param {number} o.rows     symbols in the window
 * @param {number} o.logical  rows a symbol is counted as (24 or 16)
 * @param {number} o.reels
 */
export function spriteAdapter({ file, strips, stops, rows, logical, reels }) {
  const art = loadFile(file);
  const pixels = art.arrays.VERA_PIXELS;
  const rgb = palette(file);
  const scale = SIDE / logical;
  if (!Number.isInteger(scale)) throw new Error(`a ${logical}-row symbol does not scale to ${SIDE} pixels`);
  const classOf = new Map(rgb.map((v, i) => [v, i === 1 ? 0 : i]));
  const bytesPer = SIDE * SIDE / 2;
  const colour = (symbol, x, y) => {
    const byte = pixels[symbol * bytesPer + y * (SIDE / 2) + (x >> 1)];
    const index = x & 1 ? byte & 15 : byte >> 4;
    return index === 1 ? 0 : index;
  };
  const hex = '0123456789abcdef';
  const windowRows = rows * SIDE;
  return {
    unit: 'pixel',
    positions: stops * logical,
    unitsPerSymbol: logical,
    symbolPixels: SIDE,
    pxPerUnit: SIDE / logical,
    // The cells the flash test compares: the reels with their frame, in block cells.
    window: { col: 0, row: WINDOW_ROW - 2, cols: 4 + reels * REEL_CELLS - 2, rows: rows * (SIDE / 8) + 4 },
    scale,
    expected(reel, position) {
      const out = [];
      for (let v = 0; v < windowRows; v += 1) {
        const at = position * scale + v;
        const symbol = strips[reel * stops + (Math.floor(at / SIDE) % stops)];
        const y = at % SIDE;
        let row = '';
        for (let x = 0; x < SIDE; x += 1) row += hex[colour(symbol, x, y)];
        out.push(row);
      }
      return out.join(',');
    },
    observe(png, geo, ink, reel) {
      if (geo.pitchX !== 8 || geo.pitchY !== 8) throw new Error(`the sprite reels are read at 8x8-pixel cells, not ${geo.pitchX}x${geo.pitchY}`);
      const out = [];
      const x0 = geo.x0 + (WINDOW_COL + REEL_CELLS * reel) * 8;
      const y0 = geo.y0 + (WINDOW_ROW - 1) * 8;
      for (let v = 0; v < windowRows; v += 1) {
        let row = '';
        for (let x = 0; x < SIDE; x += 1) {
          const c = classOf.get(png.at(x0 + x, y0 + v));
          row += c === undefined ? '?' : hex[c];
        }
        out.push(row);
      }
      return out.join(',');
    },
  };
}
