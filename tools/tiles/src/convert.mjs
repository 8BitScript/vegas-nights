// Symbol art -> machine tables. Two shapes, both fixed-width and indexable:
//
//  pixels     1 bit per pixel, 8x8 pixels to a character cell, ONE ink colour per
//             cell (the VIC-II, VIC-I, VERA and the web's glyph table all colour a
//             cell, not a pixel). SYMBOL_BITMAP[symbol * SYMBOL_BYTES + cell * 8 +
//             pixelRow], bit 7 = leftmost pixel; SYMBOL_COLOR[symbol * SYMBOL_CELLS +
//             cell] = the machine's own colour number. Paper (the 0 bits) is the
//             screen background, global on every one of these machines.
//  quadrants  the PET: no glyphs to redefine and one ink, but the ROM holds all 16
//             2x2 block patterns. SYMBOL_PIXELS[symbol * SYMBOL_PIXEL_ROWS + row] is
//             one byte per pseudo-pixel row (bit 7 = leftmost), and QUAD_CODE[...]
//             turns four of them into a screen code.
import { MACHINES, nearest, luma } from './palettes.mjs';

/** The sixteen quadrant screen codes, indexed topLeft<<3 | topRight<<2 | bottomLeft<<1 | bottomRight.
 *  Read off the real character ROMs (PET characters-2, C64 and VIC-20 chargen): codes 96-127 hold
 *  eight patterns and bit 7 reverses a glyph, so the other eight are those +128. Identical on all
 *  three machines, and it matches packages/pet/src/blocks.8bs. */
export const QUAD_CODE = [32, 108, 123, 98, 124, 225, 255, 254, 126, 127, 97, 252, 226, 251, 236, 160];

/** Area-average an RGBA image to tw x th. Returns { w, h, cover: Float32Array, red, green, blue }
 *  where the colour channels are the coverage-weighted mean colour of what the pixel covers. */
export function resample(img, tw, th) {
  const { width: sw, height: sh, rgba } = img;
  const cover = new Float32Array(tw * th);
  const red = new Float32Array(tw * th);
  const green = new Float32Array(tw * th);
  const blue = new Float32Array(tw * th);
  const fx = sw / tw, fy = sh / th;
  for (let ty = 0; ty < th; ty += 1) {
    for (let tx = 0; tx < tw; tx += 1) {
      const x0 = tx * fx, x1 = (tx + 1) * fx, y0 = ty * fy, y1 = (ty + 1) * fy;
      let area = 0, a = 0, r = 0, g = 0, b = 0;
      for (let sy = Math.floor(y0); sy < Math.min(sh, Math.ceil(y1)); sy += 1) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.min(sw, Math.ceil(x1)); sx += 1) {
          const w = wy * (Math.min(sx + 1, x1) - Math.max(sx, x0));
          const o = (sy * sw + sx) * 4;
          const al = (rgba[o + 3] / 255) * w;
          area += w; a += al; r += rgba[o] * al; g += rgba[o + 1] * al; b += rgba[o + 2] * al;
        }
      }
      const i = ty * tw + tx;
      cover[i] = area > 0 ? a / area : 0;
      if (a > 0) { red[i] = r / a; green[i] = g / a; blue[i] = b / a; }
    }
  }
  return { w: tw, h: th, cover, red, green, blue };
}

const INK = 0.5; // a pixel is ink when at least half of it is covered

/** Convert one symbol to the pixel form for `machine`. */
export function toPixelSymbol(img, machine, cellsW, cellsH) {
  const spec = MACHINES[machine];
  const tw = cellsW * 8, th = cellsH * 8;
  const s = resample(img, tw, th);
  const cells = cellsW * cellsH;
  const bitmap = new Uint8Array(cells * 8);
  const colors = new Uint8Array(cells);
  const pixelColor = new Int16Array(tw * th).fill(-1);
  let ink = 0, clash = 0;
  for (let y = 0; y < th; y += 1) {
    for (let x = 0; x < tw; x += 1) {
      const i = y * tw + x;
      if (s.cover[i] < INK) continue;
      ink += 1;
      pixelColor[i] = nearest(spec.palette, [s.red[i], s.green[i], s.blue[i]], spec.fg);
    }
  }
  for (let cy = 0; cy < cellsH; cy += 1) {
    for (let cx = 0; cx < cellsW; cx += 1) {
      const cell = cy * cellsW + cx;
      const histogram = new Map();
      for (let r = 0; r < 8; r += 1) {
        let byte = 0;
        for (let c = 0; c < 8; c += 1) {
          const p = pixelColor[(cy * 8 + r) * tw + cx * 8 + c];
          if (p < 0) continue;
          byte |= 0x80 >> c;
          histogram.set(p, (histogram.get(p) ?? 0) + 1);
        }
        bitmap[cell * 8 + r] = byte;
      }
      let best = nearest(spec.palette, [255, 255, 255], spec.fg), bestN = -1;
      for (const [color, n] of histogram) {
        if (n > bestN || (n === bestN && luma(spec.palette[color]) > luma(spec.palette[best]))) { best = color; bestN = n; }
      }
      colors[cell] = best;
      for (const [color, n] of histogram) if (color !== best) clash += n;
    }
  }
  return { bitmap, colors, ink, clash };
}

/** Convert one symbol to the PET's quadrant form: cellsW*2 x cellsH*2 pseudo-pixels, one byte a row. */
export function toQuadSymbol(img, cellsW, cellsH) {
  const pw = cellsW * 2, ph = cellsH * 2;
  if (pw > 8) throw new Error(`a quadrant symbol is at most 4 cells wide (8 pseudo-pixels), not ${cellsW}`);
  const s = resample(img, pw, ph);
  const rows = new Uint8Array(ph);
  let ink = 0;
  for (let y = 0; y < ph; y += 1) {
    for (let x = 0; x < pw; x += 1) {
      if (s.cover[y * pw + x] >= INK) { rows[y] |= 0x80 >> x; ink += 1; }
    }
  }
  return { rows, ink };
}

/** An 8x8 cell given as eight strings of '#' (ink) and '.' (paper) -> its eight row bytes. */
export function cellFromRows(rows) {
  if (rows.length !== 8) throw new Error(`a cell has 8 rows, got ${rows.length}`);
  return Uint8Array.from(rows.map((row) => {
    if (row.length !== 8) throw new Error(`a cell row has 8 pixels: "${row}"`);
    let byte = 0;
    for (let c = 0; c < 8; c += 1) if (row[c] === '#') byte |= 0x80 >> c;
    return byte;
  }));
}

/** The quadrant screen code that best stands in for an 8x8 cell (a quadrant is on when most of its 16 pixels are). */
export function quadCodeForCell(rows) {
  let pattern = 0;
  [[0, 0, 8], [0, 4, 4], [4, 0, 2], [4, 4, 1]].forEach(([r0, c0, bit]) => {
    let on = 0;
    for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) on += (rows[r0 + r] >> (7 - (c0 + c))) & 1;
    if (on >= 8) pattern |= bit;
  });
  return QUAD_CODE[pattern];
}
