// How often is a reel caught half-redrawn? The reel redraw is not synchronised to the raster beam
// (README, "Tearing"), so a headless capture of a spinning reel sometimes shows a window that is
// part the old picture and part the new. This captures COUNT consecutive frames of the 3x3 playing
// from its fixed seed, decodes every reel with the same adapter the on-screen tests use, and counts
// the captures in which a reel is at NO valid position of its strip.
//
//   node scripts/tear-rate.mjs c64 --from 300 --count 24
//
// (Shape only: a colour that lags the shape by a frame is not seen here.) Headless; never opens a window.
import { calibrate, loadPng } from '../test/support/screen.mjs';
import { capture } from '../test/support/emulator.mjs';
import { loadTable } from '../test/support/table.mjs';
import { adapterFor, inkReader, precompute, matches } from '../test/support/adapters.mjs';

const args = process.argv.slice(2);
const machine = args[0];
const at = (flag, fallback) => (args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : fallback);
const from = at('--from', 300);
const count = at('--count', 24);

const c = loadTable().consts;
const geo = calibrate(loadPng(await capture(machine, 'slot3x3-ruler', 'tear-ruler')));
const adapter = adapterFor(machine, undefined);
const expectedAt = precompute(adapter, c.REELS);

let torn = 0;
const perReel = Array(c.REELS).fill(0);
const rows = [];
for (let f = from; f < from + count; f += 1) {
  const png = loadPng(await capture(machine, 'slot3x3-lines', `tear${f}`, f));
  const ink = inkReader(png);
  const bad = [];
  for (let reel = 0; reel < c.REELS; reel += 1) {
    if (matches(adapter, expectedAt[reel], adapter.observe(png, geo, ink, reel)).length === 0) { bad.push(reel); perReel[reel] += 1; }
  }
  if (bad.length) torn += 1;
  rows.push(`${f}${bad.length ? ` torn(reel ${bad.join(',')})` : ''}`);
}
console.log(`${machine}: frames ${from}-${from + count - 1}: ${torn} of ${count} captures show a reel caught mid-redraw (per reel: ${perReel.join(', ')})`);
console.log(rows.filter((r) => r.includes('torn')).join('  '));
