// Reads src/generated/<game>.8bs — the tables tools/slotmath emits — back into
// numbers, so tests check the game against the very file the 6502 builds from.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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
