// Reading a text screen back out of a screenshot, on any machine.
//
// A screenshot is pixels; the game thinks in text cells. The two small
// programs next to the game bridge them without knowing any machine's font,
// border or scale: slot3x3-ruler prints a letter at two cells a known
// distance apart (which gives the pixel size and position of a cell), and
// slot3x3-glyphs prints every symbol and digit the way the game does
// (which gives what each one looks like on this machine). A cell in a game
// capture is then identified by comparing its pixels, exactly, with those.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { decodePng } from './png.mjs';

export const loadPng = (file) => decodePng(readFileSync(file));

/** Bounding boxes of the 8-connected blobs of non-background pixels, top first. */
function blobs(png) {
  const { width, height, at } = png;
  const counts = new Map();
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const v = at(x, y);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const background = [...counts.entries()].sort((p, q) => q[1] - p[1])[0][0];
  const seen = new Uint8Array(width * height);
  const found = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (seen[y * width + x] || at(x, y) === background) continue;
    const stack = [[x, y]];
    seen[y * width + x] = 1;
    const box = { minX: x, minY: y, maxX: x, maxY: y, size: 0 };
    while (stack.length) {
      const [px, py] = stack.pop();
      box.size += 1;
      box.minX = Math.min(box.minX, px); box.maxX = Math.max(box.maxX, px);
      box.minY = Math.min(box.minY, py); box.maxY = Math.max(box.maxY, py);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = px + dx, ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[ny * width + nx] || at(nx, ny) === background) continue;
        seen[ny * width + nx] = 1;
        stack.push([nx, ny]);
      }
    }
    found.push(box);
  }
  return found.sort((p, q) => p.minY - q.minY || p.minX - q.minX);
}

/**
 * Cell geometry from a capture of slot3x3-ruler: a letter at block cell
 * (0, 1) and another at (10, 15). The two topmost blobs are the letters (an
 * emulator's mouse pointer, on the X16, sits lower).
 */
export function calibrate(rulerPng) {
  const [one, two] = blobs(rulerPng);
  if (!one || !two) throw new Error('ruler: expected two letters on the screen');
  const pitchX = (two.minX - one.minX) / 10;
  const pitchY = (two.minY - one.minY) / 14;
  if (!(pitchX >= 4 && pitchY >= 4)) throw new Error(`ruler: implausible cell size ${pitchX} x ${pitchY}`);
  return { x0: one.minX, y0: one.minY, pitchX, pitchY };
}

/** A fingerprint of the pixels of block cell (col, row). */
export function cellKey(png, geo, col, row) {
  const x = Math.round(geo.x0 + col * geo.pitchX);
  const y = Math.round(geo.y0 + (row - 1) * geo.pitchY);
  const w = Math.round(geo.pitchX);
  const h = Math.round(geo.pitchY);
  const hash = createHash('sha256');
  const bytes = Buffer.alloc(w * h * 3);
  let n = 0;
  for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) {
    const v = png.at(xx, yy);
    bytes[n++] = v >> 16; bytes[n++] = (v >> 8) & 255; bytes[n++] = v & 255;
  }
  return hash.update(bytes).digest('hex').slice(0, 16);
}

/** What the game's symbols and digits look like on this machine. */
export function reference(glyphPng, geo, symbolCount) {
  const symbols = new Map();
  for (let k = 0; k < symbolCount; k += 1) {
    const key = [0, 1, 2].map((i) => cellKey(glyphPng, geo, 1 + i, 2 + k)).join('|');
    if (symbols.has(key)) throw new Error(`symbols ${symbols.get(key)} and ${k} look identical on this machine`);
    symbols.set(key, k);
  }
  const digits = new Map();
  for (let d = 0; d < 10; d += 1) {
    const key = cellKey(glyphPng, geo, 1 + d, 10);
    if (digits.has(key)) throw new Error(`digits ${digits.get(key)} and ${d} look identical`);
    digits.set(key, d);
  }
  return { symbols, digits };
}

/** The `width`-digit number printed from block cell (col, row), or null. */
export function readNumber(png, geo, ref, col, row, width) {
  let value = 0;
  for (let i = 0; i < width; i += 1) {
    const key = cellKey(png, geo, col + i, row);
    if (!ref.digits.has(key)) return null;
    value = value * 10 + ref.digits.get(key);
  }
  return value;
}

// Where the game puts things (src/labs/slot3x3/game.8bs).
export const LAYOUT = { creditRow: 15, betRow: 16, winRow: 17, numberCol: 8, numberWidth: 6 };
