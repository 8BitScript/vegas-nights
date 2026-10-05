// How the 5x5 draws a reel on each kind of machine, and how to read it back (the same
// idea as adapters.mjs, for the 5x5's geometry: five reels, five rows, the cosmic tiles).
// A position is a number of "units" down a reel's strip: pixels on the machines that redefine
// characters (C64, X16: 16x16 art, 16 pixels a symbol), rows of four pixels on the ones that
// build the reel from quadrant blocks (PET, VIC-20, web: 24 pixels, six rows a symbol).
import { loadFile, loadTable } from './table.mjs';
import { nibbleOf, quadCell } from './adapters.mjs';
import { quadAdapter as tableQuadAdapter } from './quadadapter.mjs';
import { labConsts } from './table.mjs';

const table = loadTable('grid5x5');
const c = table.consts;
const a = table.arrays;

export const KIND = { pet: 'quad', vic20: 'quad', web: 'quad', c64: 'pixel', cx16: 'pixel', c64web: 'pixel' };

// Where the game puts the window's first row (src/labs/slot5x5/view.8bs; geometry*.8bs for the quadrant machines).
export const TOP = (machine) => labConsts('slot5x5', machine).TOP;

export function pixelAdapter(machine) {
  const bitmap = loadFile(machine === 'cx16' ? 'tiles/cosmic.cx16.8bs' : 'tiles/cosmic.8bs').arrays.SYMBOL_BITMAP;
  const PX = 16;
  const rowBits = (symbol, y) => (bitmap[symbol * 32 + ((y >> 3) * 2) * 8 + (y & 7)] << 8) | bitmap[symbol * 32 + ((y >> 3) * 2 + 1) * 8 + (y & 7)];
  return {
    unit: 'pixel',
    positions: c.STOPS * PX,
    unitsPerSymbol: PX,
    pxPerUnit: 1,
    expected(reel, position) {
      const out = [];
      for (let v = 0; v < 80; v += 1) {
        const at = position + v;
        out.push(rowBits(a.STRIPS[reel * c.STOPS + (Math.floor(at / PX) % c.STOPS)], at % PX));
      }
      return out.join(',');
    },
    observe(png, geo, ink, reel) {
      const out = [];
      const sx = geo.pitchX / 8;
      const sy = geo.pitchY / 8;
      for (let v = 0; v < 80; v += 1) {
        let row = 0;
        for (let bit = 0; bit < 16; bit += 1) {
          const x = geo.x0 + (1 + 3 * reel + (bit >> 3)) * geo.pitchX + Math.floor(((bit & 7) + 0.5) * sx);
          const y = geo.y0 + (TOP(machine) - 1) * geo.pitchY + Math.floor((v + 0.5) * sy);
          row = (row << 1) | ink(x, y);
        }
        out.push(row >>> 0);
      }
      return out.join(',');
    },
  };
}

/**
 * The PET and the web draw the 5x5 from the table-driven quadrant composer (labs/slot5x5/quad.8bs), whose picture is the
 * generated tables decoded back to pseudo-pixels (quadadapter.mjs); the VIC-20 keeps the compact original, which composes
 * from the symbols' 6x6 pseudo-pixels (cosmic.pet.8bs).
 */
export function quadAdapter(machine) {
  if (machine !== 'vic20') {
    return tableQuadAdapter({ table, tiles: machine === 'web' ? 'tiles/cosmic.quad.web.8bs' : 'tiles/cosmic.quad.8bs', web: machine === 'web', top: TOP(machine) });
  }
  const pixels = loadFile('tiles/cosmic.pet.8bs').arrays.SYMBOL_PIXELS;
  const R = 6; // pseudo-pixel rows in a symbol
  const rowAt = (reel, at) => pixels[a.STRIPS[reel * c.STOPS + (Math.floor(at / R) % c.STOPS)] * R + (at % R)];
  return {
    unit: 'quadrant row (4 pixels)',
    positions: c.STOPS * R,
    unitsPerSymbol: R,
    pxPerUnit: 4,
    expected(reel, position) {
      const nibbles = [];
      for (let down = 0; down < 15; down += 1) {
        const upper = rowAt(reel, position + down * 2);
        const lower = rowAt(reel, position + down * 2 + 1);
        for (let across = 0; across < 3; across += 1) nibbles.push(nibbleOf(upper, lower, across));
      }
      return nibbles.join(',');
    },
    observe(png, geo, ink, reel) {
      const out = [];
      for (let down = 0; down < 15; down += 1) {
        for (let across = 0; across < 3; across += 1) {
          out.push(quadCell(ink, geo, geo.x0 + (1 + 4 * reel + across) * geo.pitchX, geo.y0 + (TOP(machine) + down - 1) * geo.pitchY));
        }
      }
      return out.join(',');
    },
  };
}
