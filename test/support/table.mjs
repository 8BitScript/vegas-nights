// Reads src/generated/<game>.8bs — the tables tools/slotmath emits — back into
// numbers, so tests check the game against the very file the 6502 builds from.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Parse any generated .8bs file (path relative to src/generated) into its consts and arrays. */
export function loadFile(rel) {
  const text = readFileSync(join(ROOT, 'src', 'generated', rel), 'utf8');
  const consts = {};
  const arrays = {};
  for (const m of text.matchAll(/^export const (\w+): \w+ = (\d+);/gm)) consts[m[1]] = Number(m[2]);
  for (const m of text.matchAll(/^export const (\w+): array<\w+, (\d+)> = \[([^\]]*)\];/gm)) {
    arrays[m[1]] = m[3].split(',').map((v) => Number(v.trim()));
    if (arrays[m[1]].length !== Number(m[2])) throw new Error(`${m[1]}: declared ${m[2]} elements, found ${arrays[m[1]].length}`);
  }
  return { text, consts, arrays };
}

export function loadTable(game = 'classic3x3') {
  const text = readFileSync(join(ROOT, 'src', 'generated', `${game}.8bs`), 'utf8');
  const consts = {};
  const arrays = {};
  for (const m of text.matchAll(/^export const (\w+): \w+ = (\d+);/gm)) consts[m[1]] = Number(m[2]);
  for (const m of text.matchAll(/^export const (\w+): array<\w+, (\d+)> = \[([^\]]*)\];/gm)) {
    const values = m[3].split(',').map((v) => Number(v.trim()));
    if (values.length !== Number(m[2])) throw new Error(`${m[1]}: declared ${m[2]} elements, found ${values.length}`);
    arrays[m[1]] = values;
  }
  // The header states what the engine computed exactly; tests recompute it.
  const rtp = /RTP ([\d.]+)% \(exact\)/.exec(text);
  const hit = /hit frequency ([\d.]+)%/.exec(text);
  return { text, consts, arrays, headerRtp: rtp ? Number(rtp[1]) / 100 : null, headerHit: hit ? Number(hit[1]) / 100 : null };
}

/** The number constants a lab's view (twin first, then the base) and its quadrant composer declare: where the game puts things. */
export function labConsts(lab, machine) {
  const dir = join(ROOT, 'src', 'labs', lab);
  const twins = { pet: 'view.pet.8bs', vic20: 'view.vic20.8bs', web: 'view.web.8bs' };
  const file = existsSync(join(dir, twins[machine] ?? '-')) ? twins[machine] : 'view.8bs';
  const read = (name) => {
    const out = {};
    for (const m of readFileSync(join(dir, name), 'utf8').matchAll(/^\s*const (\w+): u(?:tiny|small)int = (\d+);/gm)) out[m[1]] = Number(m[2]);
    return out;
  };
  const consts = read(file);
  // The 5x5's quadrant machines state where the block and panel sit in geometry*.8bs (the view reads it from there).
  if (lab === 'slot5x5' && ['pet', 'vic20', 'web'].includes(machine)) {
    const g = existsSync(join(dir, `geometry.${machine}.8bs`)) ? `geometry.${machine}.8bs` : 'geometry.8bs';
    Object.assign(consts, read(g));
  }
  // view.8bs serves the C64 and the X16, whose machines differ in size; their layout numbers are
  // block.8bs's (block.c64.8bs for the C64 and its wasm build), which view.8bs aliases
  if (file === 'view.8bs' && lab === 'slot3x3') {
    const block = blockFor(machine);
    Object.assign(consts, { BLOCK_WIDTH: block.WIDTH, CREDIT_ROW: block.CREDIT, BET_ROW: block.BET, WIN_ROW: block.WIN, MESSAGE_ROW: block.MESSAGE });
  }
  const quad = readFileSync(join(dir, 'quad.8bs'), 'utf8').match(/const TOP: utinyint = (\d+);/);
  if (quad) consts.QUAD_TOP = Number(quad[1]);
  return consts;
}

/** The 3x3's on-screen geometry for `machine` (src/labs/slot3x3/block.8bs, or block.c64.8bs for the C64 and its wasm build), as numbers. */
export function blockFor(machine) {
  const file = machine === 'c64' || machine === 'c64web' ? 'block.c64.8bs' : 'block.8bs';
  const text = readFileSync(join(ROOT, 'src', 'labs', 'slot3x3', file), 'utf8');
  const consts = {};
  for (const m of text.matchAll(/^\s*const (\w+): \w+ = (\d+);/gm)) consts[m[1]] = Number(m[2]);
  return consts;
}
