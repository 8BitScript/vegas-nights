// What does one reel redraw cost, in frames, on each machine?
//
//   node scripts/measure-redraw.mjs [machine ...] [--reps 60]
//
// src/labs/slot3x3/probe.8bs redraws reel 0 REPS times and then writes DONE; this
// builds it with REPS = 0 and REPS = N, runs each headless under the machine's own
// emulator, bisects for the first frame at which DONE is on the screen, and
// divides the difference by N. The boot, the glyph staging and the setup cancel.
// (A reel redraws at one fixed position here, so the colour pass is skipped as it
// is for most steps of a real spin; a step that crosses a colour boundary costs
// one more pass, ~0.2 of a frame on the C64.)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calibrate, cellKey, loadPng } from '../test/support/screen.mjs';
import { capture, MACHINES } from '../test/support/emulator.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = join(ROOT, 'src', 'labs', 'slot3x3', 'probe.8bs');
const args = process.argv.slice(2);
const repsAt = args.indexOf('--reps');
const reps = repsAt >= 0 ? Number(args[repsAt + 1]) : 60;
const machines = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--reps');
const original = readFileSync(PROBE, 'utf8');

async function measure(machine) {
  const geo = calibrate(loadPng(await capture(machine, 'slot3x3-ruler', 'ruler')));
  const key = (png) => cellKey(png, geo, 1, 22) + '/' + cellKey(png, geo, 2, 22);
  const withReps = (n) => writeFileSync(PROBE, original.replace(/const REPS: usmallint = \d+;/, `const REPS: usmallint = ${n};`));
  const shoot = async (f) => loadPng(await capture(machine, 'slot3x3-probe', 'probe', f));
  withReps(0);
  const signature = key(await shoot(1200));
  const firstDone = async (n) => {
    withReps(n);
    let lo = 1;
    let hi = 1200;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (key(await shoot(mid)) === signature) hi = mid; else lo = mid + 1;
    }
    return lo;
  };
  const base = await firstDone(0);
  const full = await firstDone(reps);
  return { base, full, perRedraw: (full - base) / reps };
}

try {
  for (const machine of machines.length ? machines : MACHINES.filter((m) => m !== 'web')) {
    const r = await measure(machine);
    console.log(`${machine.padEnd(6)} ${r.perRedraw.toFixed(2)} frames per reel redraw   (DONE at frame ${r.base} with none, ${r.full} with ${reps})`);
  }
} finally {
  writeFileSync(PROBE, original);
}
