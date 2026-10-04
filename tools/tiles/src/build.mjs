// theme -> { relative file name: source text } for every machine.
import { MACHINES, nearest } from './palettes.mjs';
import { toPixelSymbol, toQuadSymbol, quadCodeForCell, QUAD_CODE } from './convert.mjs';
import { emitPixels, emitQuadrants } from './emit.mjs';
import { cellsFor } from './theme.mjs';

/** The PET screen code for a frame cell: the theme's explicit choice (a 4-bit quadrant pattern like "1100" = top half, or a screen code number), else the nearest block pattern. */
function petCode(cell) {
  if (typeof cell.pet === 'number') return cell.pet;
  if (typeof cell.pet === 'string') return QUAD_CODE[parseInt(cell.pet, 2)];
  return quadCodeForCell(cell.rows);
}

/** Convert a loaded theme for one machine. */
export function convertTheme(theme, machine) {
  const spec = MACHINES[machine];
  const { cellsW, cellsH } = cellsFor(theme, machine);
  if (spec.mode === 'quadrants') {
    const symbols = theme.symbols.map((s) => ({ id: s.id, ...toQuadSymbol(s.overrides[machine] ?? s.img, cellsW, cellsH) }));
    const frame = { names: theme.frame.map((c) => c.name), codes: theme.frame.map((c) => petCode(c)) };
    return { cellsW, cellsH, symbols, frame };
  }
  const symbols = theme.symbols.map((s) => ({ id: s.id, ...toPixelSymbol(s.overrides[machine] ?? s.img, machine, cellsW, cellsH) }));
  const frame = {
    names: theme.frame.map((c) => c.name),
    bitmaps: theme.frame.map((c) => c.rows),
    colors: theme.frame.map((c) => nearest(spec.palette, c.color, spec.fg)),
  };
  return { cellsW, cellsH, symbols, frame, background: nearest(spec.palette, theme.background) };
}

/** The files `build` writes: the base file is the C64's (and what any other machine gets). */
export const OUTPUTS = [
  { file: (t) => `${t}.8bs`, machine: 'c64' },
  { file: (t) => `${t}.vic20.8bs`, machine: 'vic20' },
  // the web shares the C64's colours but its glyph table reads a row with bit 0 on the left
  { file: (t) => `${t}.web.8bs`, machine: 'web', lsbLeft: true },
  { file: (t) => `${t}.cx16.8bs`, machine: 'cx16' },
  { file: (t) => `${t}.pet.8bs`, machine: 'pet' },
];

export function buildTheme(theme) {
  const files = {};
  const report = {};
  for (const out of OUTPUTS) {
    const data = convertTheme(theme, out.machine);
    const text = MACHINES[out.machine].mode === 'quadrants'
      ? emitQuadrants(theme, out.machine, data, QUAD_CODE)
      : emitPixels(theme, out.machine, data, out.serves, { lsbLeft: out.lsbLeft });
    files[out.file(theme.name)] = text;
    report[out.machine] = { data, bytes: Buffer.byteLength(text), clash: data.symbols.reduce((n, s) => n + (s.clash ?? 0), 0), ink: data.symbols.reduce((n, s) => n + s.ink, 0) };
  }
  return { files, report };
}
