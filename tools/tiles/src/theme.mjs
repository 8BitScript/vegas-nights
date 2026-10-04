// Load a theme: assets/themes/<name>/theme.json, its symbol PNGs, and its frame
// cells. Symbol order and ids come from the engine spec the theme dresses
// (tools/slotmath/specs/<game>.mjs), so art can never drift from the odds tables.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodePng } from './png.mjs';
import { rgb } from './raster.mjs';
import { cellFromRows } from './convert.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function themeDir(name) { return join(ROOT, 'assets', 'themes', name); }

export async function loadTheme(name) {
  const dir = themeDir(name);
  const meta = JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8'));
  if (meta.name !== name) throw new Error(`theme.json says "${meta.name}" but the folder is "${name}"`);
  const specPath = join(ROOT, 'tools', 'slotmath', 'specs', `${meta.game}.mjs`);
  if (!existsSync(specPath)) throw new Error(`theme ${name}: no engine spec "${meta.game}" at ${specPath}`);
  const spec = (await import(pathToFileURL(specPath).href)).default;
  const colors = Object.fromEntries(Object.entries(meta.palette).map(([k, v]) => [k, rgb(v)]));
  const colorOf = (key) => {
    if (!(key in colors)) throw new Error(`theme ${name}: unknown palette colour "${key}"`);
    return colors[key];
  };
  const symbols = spec.symbols.map((s) => {
    const file = join(dir, 'symbols', `${s.id}.png`);
    if (!existsSync(file)) throw new Error(`theme ${name}: missing art for symbol ${s.id} (${file})`);
    const overrides = {};
    for (const machine of ['pet', 'vic20', 'cx16', 'web', 'c64']) {
      const o = join(dir, 'symbols', `${s.id}.${machine}.png`);
      if (existsSync(o)) overrides[machine] = decodePng(readFileSync(o));
    }
    return { id: s.id, img: decodePng(readFileSync(file)), overrides };
  });
  const frameMeta = JSON.parse(readFileSync(join(dir, meta.frame ?? 'frame.json'), 'utf8'));
  const frame = Object.entries(frameMeta.cells).map(([cellName, c]) => ({
    name: cellName, rows: cellFromRows(c.rows), color: colorOf(c.color), pet: c.pet,
  }));
  return { name, title: meta.title ?? name, game: meta.game, background: colorOf(meta.background ?? 'black'), cells: meta.cells ?? { default: [3, 3] }, colors, symbols, frame, dir, meta };
}

export function cellsFor(theme, machine) {
  const [w, h] = theme.cells[machine] ?? theme.cells.default ?? [3, 3];
  return { cellsW: w, cellsH: h };
}
