// What does one step of the bigger quadrant reels cost, in video frames, on the PET and VIC-20?
//   EIGHTBS_CHECKOUT=/path/to/8bitscript node tools/size/measure-quad.mjs [machine:lab ...] [--reps 60]
// The lab redraws every reel REPS times (one pseudo-pixel row step each) and then prints DONE; this runs it with
// REPS = 0 and REPS = N headless under the machine's own emulator, bisects for the first frame at which DONE is
// on the screen, and divides the difference by N. The boot and setup cancel (same method as scripts/measure-redraw.mjs).
import { calibrate, cellKey, loadPng } from '../../test/support/screen.mjs';
import { capture } from '../../test/support/emulator.mjs';

const args = process.argv.slice(2);
const repsAt = args.indexOf('--reps');
const reps = repsAt >= 0 ? Number(args[repsAt + 1]) : 60;
const asked = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--reps');
// machine, lab, reels, indent of the lab's block on that machine, row of DONE
const ALL = [
  ['pet', 'proto-quad-3x3', 3, 9, 21, 0],
  ['vic20', 'proto-quad-3x3', 3, 0, 21, 0],
  ['pet', 'proto-quad-5x5', 5, 7, 22, 0],
  // HOP=1: a whole cell row (8 pixels) of scroll by moving the cells, composing only the new top row
  ['pet', 'proto-quad-3x3', 3, 9, 21, 1],
  ['vic20', 'proto-quad-3x3', 3, 0, 21, 1],
  ['pet', 'proto-quad-5x5', 5, 7, 22, 1],
  // HOP=2: the same move as a 6502 block copy
  ['pet', 'proto-quad-3x3', 3, 9, 21, 2],
  ['vic20', 'proto-quad-3x3', 3, 0, 21, 2],
  ['pet', 'proto-quad-5x5', 5, 7, 22, 2],
];
const INDENT_RULER = { pet: 13, vic20: 4 };

async function measure([machine, lab, reels, indent, row, hop]) {
  const geo = calibrate(loadPng(await capture(machine, 'slot3x3-ruler', 'ruler-size')));
  const col = indent + 17 - INDENT_RULER[machine];
  const key = (png) => cellKey(png, geo, col, row);
  const shoot = async (f, n) => loadPng(await capture(machine, lab, `m-${lab}-${hop}`, f, { REPS: n, HOP: hop }));
  const blank = key(await shoot(1500, 0));
  const firstDone = async (n) => {
    let lo = 1, hi = 6000;
    if (key(await shoot(hi, n)) === blank) return Infinity;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (key(await shoot(mid, n)) === blank) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  const base = await firstDone(1);
  const full = await firstDone(reps);
  return { perStep: (full - base) / (reps - 1), base, full, reels };
}

for (const entry of ALL) {
  const [machine, lab, , , , hop] = entry;
  if (asked.length && !asked.includes(`${machine}:${lab}:${hop}`)) continue;
  const r = await measure(entry);
  console.log(`${machine.padEnd(6)} ${lab} ${['STEP (4 px)', 'HOP compiled (8 px)', 'HOP asm (8 px)'][hop]}  ${r.perStep.toFixed(2)} frames per step of ${r.reels} reels = ${(r.perStep / r.reels).toFixed(2)} per reel   (DONE at frame ${r.base} with 1 step, ${r.full} with ${reps})`);
}
