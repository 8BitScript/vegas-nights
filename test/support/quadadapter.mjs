// How a quadrant-block reel looks, for any game, symbol size and machine that builds its reels from 2x2 block glyphs
// (the PET and VIC-20, and the web's host font), and how to read it back from a screenshot.
//
// The reference picture is not computed from the composer's own idea of the reel: it is the generated quadrant tables
// (src/generated/tiles/<theme>.quad*.8bs, the very file the 6502 build indexes) decoded back into the symbols'
// pseudo-pixels — a symbol's QUAD_C0 table holds, for every display cell, the block that covers two of its rows and two
// of its columns, so together they ARE the symbol's bitmap — and then composed here the plain way: a display cell takes
// two consecutive pseudo-pixel rows of the window and two consecutive columns. So a mistake in the composer's table
// indexing, in the hop, or in the phase of an odd start shows up as a difference from a picture it did not make.
import { loadFile } from './table.mjs';

// The sixteen block glyphs by pattern (top-left<<3 | top-right<<2 | bottom-left<<1 | bottom-right), per machine.
const PET_CODES = [32, 108, 123, 98, 124, 225, 255, 254, 126, 127, 97, 252, 226, 251, 236, 160];
const WEB_CODES = Array.from({ length: 16 }, (_, i) => 128 + i);

/** The 0-15 number of one cell: the middle of each of its four 4x4 quadrants, read from `ink`. */
export function quadCell(ink, geo, ox, oy) {
  const sx = geo.pitchX / 8;
  const sy = geo.pitchY / 8;
  const at = (px, py) => ink(ox + Math.floor((px + 0.5) * sx), oy + Math.floor((py + 0.5) * sy));
  return (at(1, 1) << 3) | (at(5, 1) << 2) | (at(1, 5) << 1) | at(5, 5);
}

/**
 * @param {object} o
 *   table    the odds table (loadTable) of the game: REELS, ROWS, STOPS, STRIPS
 *   tiles    the generated quadrant file for this machine ('tiles/classic.quad.8bs', ...)
 *   web      true if the machine's blocks are the web font's (codes 128-143)
 *   top      the block row of the window's first cell row (the lab's quad.TOP)
 */
export function quadAdapter({ table, tiles, web = false, top }) {
  const c = table.consts;
  const strip = table.arrays.STRIPS;
  const t = loadFile(tiles);
  const S = t.consts.QUAD_S;
  const P = t.consts.QUAD_P;
  const codes = web ? WEB_CODES : PET_CODES;
  const pattern = new Map(codes.map((code, i) => [code, i]));
  const C0 = t.arrays.QUAD_C0;
  // pseudo[symbol][row] = the 2S pixels of that pseudo-pixel row, leftmost first
  const pseudo = [];
  for (let s = 0; s < t.consts.QUAD_SYMBOLS; s += 1) {
    const rows = Array.from({ length: P }, () => new Array(P).fill(0));
    for (let k = 0; k < S; k += 1) for (let cc = 0; cc < S; cc += 1) {
      const p = pattern.get(C0[(s * S + k) * S + cc]);
      if (p === undefined) throw new Error(`QUAD_C0 holds a code that is no block: ${C0[(s * S + k) * S + cc]}`);
      rows[2 * k][2 * cc] = (p >> 3) & 1; rows[2 * k][2 * cc + 1] = (p >> 2) & 1;
      rows[2 * k + 1][2 * cc] = (p >> 1) & 1; rows[2 * k + 1][2 * cc + 1] = p & 1;
    }
    pseudo.push(rows);
  }
  const rowAt = (reel, at) => pseudo[strip[reel * c.STOPS + (Math.floor(at / P) % c.STOPS)]][at % P];
  const col = (reel) => 1 + reel * (S + 1);
  const down = c.ROWS * S;
  return {
    unit: 'quadrant row (4 pixels)',
    positions: c.STOPS * P,
    unitsPerSymbol: P,
    pxPerUnit: 4,
    symbolPixels: 8 * S,
    S,
    // The cells the flash test compares: the reels with their frame, in block cells.
    window: { col: 1, row: top - 1, cols: c.REELS * (S + 1) - 1, rows: down + 1 },
    expected(reel, position) {
      const out = [];
      for (let d = 0; d < down; d += 1) {
        const upper = rowAt(reel, position + d * 2);
        const lower = rowAt(reel, position + d * 2 + 1);
        for (let across = 0; across < S; across += 1) {
          out.push((upper[2 * across] << 3) | (upper[2 * across + 1] << 2) | (lower[2 * across] << 1) | lower[2 * across + 1]);
        }
      }
      return out.join(',');
    },
    /**
     * Every position of a reel whose picture `observed` is, allowing the one thing a moving reel can show that a resting
     * one cannot: a SEAM. The screen is rewritten while the beam is drawing it, so for a frame one band of the window is
     * the picture before the move and the rest the picture after it. A hop (8 pixels, two units) moves the cells down
     * bottom-first, against the beam: the rows above the seam are still the old picture. A four-pixel recompose writes
     * top-first, behind the beam: the rows below the seam are still the old picture. Anything else — a row that is neither
     * — is no picture the reel can be in, and matches nothing.
     */
    match(expectedByPosition, observed) {
      const exact = [];
      expectedByPosition.forEach((e, p) => { if (e === observed) exact.push(p); });
      if (exact.length) return exact;
      const seen = observed.split(',');
      const same = new Map();
      const rowsEq = (position) => {
        if (!same.has(position)) {
          const want = expectedByPosition[position].split(',');
          same.set(position, Array.from({ length: down }, (_, r) => {
            for (let k = 0; k < S; k += 1) if (want[r * S + k] !== seen[r * S + k]) return false;
            return true;
          }));
        }
        return same.get(position);
      };
      const out = [];
      const n = expectedByPosition.length;
      // Is there a seam row (1..down-1) with the old picture on one side of it and the new on the other?
      const seamBetween = (now, before, topOld) => {
        for (let seam = 1; seam < down; seam += 1) {
          let ok = true;
          for (let r = 0; r < down && ok; r += 1) ok = (topOld ? r < seam : r >= seam) ? before[r] : now[r];
          if (ok) return true;
        }
        return false;
      };
      for (let p = 0; p < n; p += 1) {
        const now = rowsEq(p);
        if (seamBetween(now, rowsEq((p + 2) % n), true) || seamBetween(now, rowsEq((p + 1) % n), false)) out.push(p);
      }
      return out;
    },
    observe(png, geo, ink, reel) {
      const out = [];
      for (let d = 0; d < down; d += 1) {
        for (let across = 0; across < S; across += 1) {
          out.push(quadCell(ink, geo, geo.x0 + (col(reel) + across) * geo.pitchX, geo.y0 + (top + d - 1) * geo.pitchY));
        }
      }
      return out.join(',');
    },
  };
}
