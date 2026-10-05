// Where is each reel, and when does the spin end? This captures the 3x3 playing from its fixed seed every
// STEP frames, decodes every reel's position in its strip with the same adapter the on-screen tests use
// (the number of pixels from the top of the strip, or ? where no valid window of the strip is on the screen),
// and prints the table and the first capture from which no reel moves again.
//
//   node scripts/spin-timeline.mjs c64 --from 20 --to 700 --step 20
//
// `--frames` counts CPU cycles on the VICE machines, not video frames, so the numbers are comparable between two
// builds of the same program on the same machine and not a count of displayed frames. Headless; never opens a window.
import { calibrate, loadPng } from '../test/support/screen.mjs';
import { capture } from '../test/support/emulator.mjs';
import { loadTable } from '../test/support/table.mjs';
import { adapterFor, inkReader, precompute, matches } from '../test/support/adapters.mjs';

const args = process.argv.slice(2);
const machine = args[0];
const at = (flag, fallback) => (args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : fallback);
const from = at('--from', 20);
const to = at('--to', 700);
const step = at('--step', 20);

const c = loadTable().consts;
const geo = calibrate(loadPng(await capture(machine, 'slot3x3-ruler', 'timeline-ruler')));
const adapter = adapterFor(machine, undefined);
const expectedAt = precompute(adapter, c.REELS);

const rows = [];
for (let f = from; f <= to; f += step) {
  const png = loadPng(await capture(machine, 'slot3x3-lines', `timeline${f}`, f));
  const ink = inkReader(png);
  const where = [];
  for (let reel = 0; reel < c.REELS; reel += 1) {
    const found = matches(adapter, expectedAt[reel], adapter.observe(png, geo, ink, reel));
    where.push(found.length === 0 ? '?' : String(found[0]));
  }
  rows.push({ f, where });
  console.log(`${String(f).padStart(5)}  ${where.map((w) => w.padStart(5)).join(' ')}`);
}

// the first capture after which no reel's position ever changes again (a '?' counts as moving)
let rest = null;
for (let i = rows.length - 1; i >= 0; i -= 1) {
  const same = rows[i].where.every((w, reel) => w !== '?' && w === rows[rows.length - 1].where[reel]);
  if (!same) break;
  rest = rows[i].f;
}
console.log(`${machine}: every reel is at its final position from frame ${rest === null ? 'never (not by ' + to + ')' : rest}`);
