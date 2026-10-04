// How each kind of machine draws a reel, and how to read it back.
//
// A reel's position is a number of "units" down its strip: pixels on the machines
// that compose glyphs (C64, X16 and the web), pseudo-pixel rows of four pixels on the
// ones that build the reel from the ROM's quadrant blocks (PET, VIC-20), and, on a
// machine with neither, whole symbols (the text fallback). For each kind the adapter can
//   expected(reel, position)  what a reel at that position looks like, computed
//                             here from the tile data, and
//   observe(png, geo, reel)   what the screenshot shows of that reel,
// as values that compare with ===/join, so a screenshot can be matched to the
// exact position it shows — or to none, which is a failed test.
import { loadFile, loadTable } from './table.mjs';
import { cellKey } from './screen.mjs';
import { labConsts } from './table.mjs';
import { quadAdapter as makeQuadAdapter } from './quadadapter.mjs';

const table = loadTable();
const c = table.consts;
const strip = table.arrays.STRIPS;

export const KINDS = { pet: 'quad', vic20: 'quad', c64: 'pixel', cx16: 'pixel', web: 'quad', c64web: 'pixel' };

/** A background-aware reader of logical pixels of a screenshot. */
export function inkReader(png) {
  const counts = new Map();
  for (let y = 0; y < png.height; y += 1) for (let x = 0; x < png.width; x += 1) {
    const v = png.at(x, y);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const background = [...counts.entries()].sort((p, q) => q[1] - p[1])[0][0];
  return (x, y) => (png.at(x, y) !== background ? 1 : 0);
}

const REEL_COL = (reel) => 1 + reel * 4; // block column of a reel's first cell
const REEL_TOP = 4;                       // block row of a reel's first cell

/** The 8 bits of a byte in the other order. */
const mirror = (byte) => { let out = 0; for (let i = 0; i < 8; i += 1) out |= ((byte >> i) & 1) << (7 - i); return out; };

// ---- pixel machines -----------------------------------------------------------
// The C64 and X16 compose 3x3-cell (24x24) symbols, bit 7 the leftmost pixel; the web
// composes 2x2-cell (16x16) symbols, bit 0 the leftmost, and sits 1 column in from the
// block's edge with its reels starting on row 6 (view.web.8bs).
function pixelAdapter(machine) {
  const web = machine === 'web';
  const tiles = loadFile(machine === 'cx16' ? 'tiles/classic.cx16.8bs' : web ? 'tiles/classic.web.8bs' : 'tiles/classic.8bs');
  const bitmap = tiles.arrays.SYMBOL_BITMAP;
  const cw = tiles.consts.SYMBOL_CELLS_W;
  const ch = tiles.consts.SYMBOL_CELLS_H;
  const bytes = tiles.consts.SYMBOL_BYTES;
  const PX = ch * 8;            // pixels in a symbol
  const WIDTH = cw * 8;         // pixels across one
  const ROWS_PX = c.ROWS * PX;  // pixel rows in the reel window
  const col = (reel) => (web ? 2 : 1) + reel * (cw + 1);
  const top = web ? 6 : REEL_TOP;
  const rowBits = (symbol, y) => {
    // the pixels of pixel row y of a symbol, as one number, leftmost pixel highest
    let v = 0;
    for (let k = 0; k < cw; k += 1) {
      const byte = bitmap[symbol * bytes + ((y >> 3) * cw + k) * 8 + (y & 7)];
      v = (v << 8) | (web ? mirror(byte) : byte);
    }
    return v >>> 0;
  };
  return {
    unit: 'pixel',
    positions: c.STOPS * PX,
    unitsPerSymbol: PX,
    symbolPixels: PX,
    // The cells the flash test compares: the reels with their frame, in block cells.
    window: web ? { col: 1, row: top - 1, cols: 2 + c.REELS * cw + c.REELS - 1, rows: ch * c.ROWS + 2 }
      : { col: 1, row: 3, cols: c.REELS * cw + c.REELS - 1, rows: ch * c.ROWS + 1 },
    expected(reel, position) {
      const out = [];
      for (let v = 0; v < ROWS_PX; v += 1) {
        const a = position + v;
        const stop = Math.floor(a / PX) % c.STOPS;
        out.push(rowBits(strip[reel * c.STOPS + stop], a % PX));
      }
      return out.join(',');
    },
    observe(png, geo, ink, reel) {
      const out = [];
      const sx = geo.pitchX / 8;
      const sy = geo.pitchY / 8;
      for (let v = 0; v < ROWS_PX; v += 1) {
        let row = 0;
        for (let bit = 0; bit < WIDTH; bit += 1) {
          const cellCol = col(reel) + (bit >> 3);
          const x = geo.x0 + cellCol * geo.pitchX + Math.floor(((bit & 7) + 0.5) * sx);
          const y = geo.y0 + (top - 1) * geo.pitchY + Math.floor((v + 0.5) * sy);
          row = (row << 1) | ink(x, y);
        }
        out.push(row >>> 0);
      }
      return out.join(',');
    },
  };
}

// ---- quadrant machines --------------------------------------------------------
/** The 0-15 number of the cell `across` (0-2) of a block row built from two pseudo-pixel rows. */
export function nibbleOf(upper, lower, across) {
  const shift = 6 - across * 2;
  return (((upper >> shift) & 3) << 2) | ((lower >> shift) & 3);
}

/**
 * What one cell of a quadrant-block reel shows, as the number 0-15 the composer works out
 * (top-left highest): the middle of each of the cell's four 4x4 quadrants, read from `ink`.
 * (`ox`, `oy` are the cell's top-left pixel in the screenshot.)
 */
export function quadCell(ink, geo, ox, oy) {
  const sx = geo.pitchX / 8;
  const sy = geo.pitchY / 8;
  const at = (px, py) => ink(ox + Math.floor((px + 0.5) * sx), oy + Math.floor((py + 0.5) * sy));
  return (at(1, 1) << 3) | (at(5, 1) << 2) | (at(1, 5) << 1) | at(5, 5);
}

function quadAdapter(machine) {
  const tiles = machine === 'vic20' ? 'tiles/classic.quad.vic20.8bs' : machine === 'web' ? 'tiles/classic.quad.web.8bs' : 'tiles/classic.quad.8bs';
  return makeQuadAdapter({ table, tiles, web: machine === 'web', top: labConsts('slot3x3', machine).QUAD_TOP });
}

// ---- the text fallback --------------------------------------------------------
function textAdapter(reference) {
  return {
    unit: 'symbol',
    positions: c.STOPS,
    unitsPerSymbol: 1,
    symbolPixels: 24,
    window: { col: 1, row: 3, cols: 11, rows: 10 },
    expected(reel, position) {
      const out = [];
      for (let row = 0; row < c.ROWS; row += 1) out.push(strip[reel * c.STOPS + ((position + row) % c.STOPS)]);
      return out.join(',');
    },
    observe(png, geo, ink, reel) {
      const out = [];
      for (let row = 0; row < c.ROWS; row += 1) {
        const key = [0, 1, 2].map((i) => cellKey(png, geo, REEL_COL(reel) + i, 7 + row)).join('|');
        out.push(reference.symbols.has(key) ? reference.symbols.get(key) : -1);
      }
      return out.join(',');
    },
  };
}

export function adapterFor(machine, textReference) {
  const kind = KINDS[machine];
  if (kind === 'pixel') return pixelAdapter(machine);
  if (kind === 'quad') return quadAdapter(machine);
  return textAdapter(textReference);
}

/** Every position of a reel that shows exactly what `observed` shows. */
export function matches(adapter, expectedByPosition, observed) {
  const out = [];
  for (let p = 0; p < adapter.positions; p += 1) if (expectedByPosition[p] === observed) out.push(p);
  return out;
}

/** expected(reel, p) for every p, once per reel. */
export function precompute(adapter, reels) {
  return Array.from({ length: reels }, (_, reel) => Array.from({ length: adapter.positions }, (_, p) => adapter.expected(reel, p)));
}
