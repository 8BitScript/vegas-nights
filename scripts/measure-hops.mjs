// What does a hop cost, in frames, on the machines that copy their screen?
//
//   node scripts/measure-hops.mjs [pet vic20] [--hops 40]
//
// src/labs/slot3x3/hops.8bs walks three reels up their strips HOPS times, STEP pixels each, and writes DONE. This runs
// it with HOPS = 0 and HOPS = N under the machine's own emulator, finds the first frame at which DONE is on the screen,
// and divides the difference by the 3 * N reel moves: the boot and the setup cancel. FULL=1 does the same with a full
// redraw after every move, which is what a hop is the cheaper way to (scripts/measure-redraw.mjs measures one redraw).
import { calibrate, cellKey, loadPng } from '../test/support/screen.mjs';
import { capture } from '../test/support/emulator.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--hops');
const hops = at >= 0 ? Number(args[at + 1]) : 40;
const machines = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--hops');

async function frameOfDone(machine, geo, defines) {
  const key = (png) => cellKey(png, geo, 1, 22) + '/' + cellKey(png, geo, 2, 22);
  const shoot = async (f, d = defines) => key(loadPng(await capture(machine, 'slot3x3-hops', 'hopsm', f, d)));
  // what DONE looks like: a run with no moves, long after it has finished
  const done = await shoot(900, { ...defines, HOPS: 0 });
  let lo = 20, hi = 400;
  while ((await shoot(hi)) !== done) { lo = hi; hi *= 2; if (hi > 8000) throw new Error('DONE never appeared'); }
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((await shoot(mid)) !== done) lo = mid; else hi = mid; }
  return hi;
}

for (const machine of machines.length ? machines : ['pet', 'vic20']) {
  const geo = calibrate(loadPng(await capture(machine, 'slot3x3-ruler', 'ruler')));
  const row = {};
  for (const [name, defines] of [['hop 8 px', { STEP: 8, FULL: 0 }], ['hop 16 px', { STEP: 16, FULL: 0 }], ['redraw (8 px moves)', { STEP: 8, FULL: 1 }]]) {
    const none = await frameOfDone(machine, geo, { ...defines, HOPS: 0 });
    const many = await frameOfDone(machine, geo, { ...defines, HOPS: hops });
    row[name] = ((many - none) / (3 * hops)).toFixed(2);
  }
  console.log(`${machine}: frames per reel move — ${Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
}
