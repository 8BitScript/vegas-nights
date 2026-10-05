// How often is a reel caught half-redrawn? The reel redraw is not synchronised to the raster beam
// (README, "Tearing"), so a headless capture of a spinning reel sometimes shows a window that is
// part the old picture and part the new. This captures COUNT consecutive frames of the 3x3 playing
// from its fixed seed, decodes every reel with the same adapter the on-screen tests use, and counts
// the captures in which a reel is at NO valid position of its strip.
//
//   node scripts/tear-rate.mjs c64 --from 300 --count 24 [--program lines] [--rest 800]
//
// --program names one of the seeded runs (lines, cherries, lose, jackpot): each draws different stops.
//
// It also checks colour (the pixel machines only): for every reel at a valid position the colour index each
// cell must have is worked out from the tile data, the way the reel view does, and the frame counts as
// colour-torn if a cell shows another colour than that index has on a capture at rest (--rest) — the new
// shape drawn in the last frame's colours. Headless; never opens a window.
import { calibrate, loadPng } from '../test/support/screen.mjs';
import { capture } from '../test/support/emulator.mjs';
import { loadTable } from '../test/support/table.mjs';
import { adapterFor, inkReader, precompute, matches } from '../test/support/adapters.mjs';
import { loadFile } from '../test/support/table.mjs';

const args = process.argv.slice(2);
const machine = args[0];
const at = (flag, fallback) => (args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : fallback);
const from = at('--from', 300);
const count = at('--count', 24);
const program = args.includes('--program') ? args[args.indexOf('--program') + 1] : 'lines';

const table = loadTable();
const c = table.consts;
const tiles = machine === 'c64' || machine === 'c64web' ? loadFile('tiles/classic.8bs') : null;
const geo = calibrate(loadPng(await capture(machine, 'slot3x3-ruler', 'tear-ruler')));
const adapter = adapterFor(machine, undefined);
const expectedAt = precompute(adapter, c.REELS);

// The colour index of the cell at (down, across) of a reel whose window starts `position` pixels down its strip
// (the rule of view.stageInk: the ink of the symbol cell that supplies most of the cell's eight rows).
function expectedInk(reel, position) {
  const cw = tiles.consts.SYMBOL_CELLS_W;
  const ch = tiles.consts.SYMBOL_CELLS_H;
  const px = ch * 8;
  const out = [];
  let stop = Math.floor(position / px) % c.STOPS;
  let row = position % px;
  for (let down = 0; down < ch * c.ROWS; down += 1) {
    let symbol = table.arrays.STRIPS[reel * c.STOPS + stop];
    let inkRow = row >> 3;
    if ((row & 7) > 4) {
      if (inkRow < ch - 1) inkRow += 1;
      else { inkRow = 0; symbol = table.arrays.STRIPS[reel * c.STOPS + ((stop + 1) % c.STOPS)]; }
    }
    for (let across = 0; across < cw; across += 1) out.push(tiles.arrays.SYMBOL_COLOR[symbol * tiles.consts.SYMBOL_CELLS + inkRow * cw + across]);
    row += 8;
    if (row >= px) { row -= px; stop = (stop + 1) % c.STOPS; }
  }
  return out;
}

// The colour a cell actually shows: the first ink pixel found in it, or null if it has none.
function shownInk(png, geo, ink, reel, down, across) {
  const cw = tiles.consts.SYMBOL_CELLS_W;
  const sx = geo.pitchX / 8;
  const sy = geo.pitchY / 8;
  for (let v = down * 8; v < down * 8 + 8; v += 1) {
    for (let bit = 0; bit < 8; bit += 1) {
      const x = geo.x0 + (1 + reel * (cw + 1) + across) * geo.pitchX + Math.floor((bit + 0.5) * sx);
      const y = geo.y0 + 3 * geo.pitchY + Math.floor((v + 0.5) * sy);
      if (ink(x, y)) return png.at(x, y);
    }
  }
  return null;
}

// What colour does each colour index look like on this machine's screen? Learned from a capture taken
// after the spin has ended (--rest, default 800), where the exact-window tests already hold every cell to the
// right colours: index -> the colour of an ink pixel of any cell that has that index.
const palette = new Map();
function learnPalette(png, geo, ink, reel, position) {
  const wanted = expectedInk(reel, position);
  const cw = tiles.consts.SYMBOL_CELLS_W;
  for (let i = 0; i < wanted.length; i += 1) {
    const shown = shownInk(png, geo, ink, reel, Math.floor(i / cw), i % cw);
    if (shown !== null && !palette.has(wanted[i])) palette.set(wanted[i], shown);
  }
}

// Does every cell of one reel show the colour its index has in `palette`? Cells whose index was never
// seen at rest are not judged.
function colourTorn(png, geo, ink, reel, position) {
  const wanted = expectedInk(reel, position);
  const cw = tiles.consts.SYMBOL_CELLS_W;
  for (let i = 0; i < wanted.length; i += 1) {
    if (!palette.has(wanted[i])) continue;
    const shown = shownInk(png, geo, ink, reel, Math.floor(i / cw), i % cw);
    if (shown !== null && shown !== palette.get(wanted[i])) return true;
  }
  return false;
}

if (tiles) {
  const rest = at('--rest', 800);
  const restPng = loadPng(await capture(machine, `slot3x3-${program}`, 'tear-rest', rest));
  const restInk = inkReader(restPng);
  for (let reel = 0; reel < c.REELS; reel += 1) {
    const found = matches(adapter, expectedAt[reel], adapter.observe(restPng, geo, restInk, reel));
    if (found.length === 1) learnPalette(restPng, geo, restInk, reel, found[0]);
  }
  console.log(`palette learned from frame ${rest}: ${palette.size} colour indices`);
}

let torn = 0;
let tornColour = 0;
const perReel = Array(c.REELS).fill(0);
const rows = [];
for (let f = from; f < from + count; f += 1) {
  const png = loadPng(await capture(machine, `slot3x3-${program}`, `tear${f}`, f));
  const ink = inkReader(png);
  const bad = [];
  const badColour = [];
  for (let reel = 0; reel < c.REELS; reel += 1) {
    const found = matches(adapter, expectedAt[reel], adapter.observe(png, geo, ink, reel));
    if (found.length === 0) { bad.push(reel); perReel[reel] += 1; }
    else if (tiles && found.length === 1 && colourTorn(png, geo, ink, reel, found[0])) badColour.push(reel);
  }
  if (bad.length) torn += 1;
  if (badColour.length) tornColour += 1;
  rows.push(`${f}${bad.length ? ` torn(reel ${bad.join(',')})` : ''}${badColour.length ? ` colour(reel ${badColour.join(',')})` : ''}`);
}
console.log(`${machine} ${program}: frames ${from}-${from + count - 1}: ${torn} of ${count} captures show a reel caught mid-redraw (per reel: ${perReel.join(', ')})${tiles ? `; ${tornColour} of ${count} show a reel in the wrong colours for its shape` : ''}`);
console.log(rows.filter((r) => r.includes('torn') || r.includes('colour')).join('  '));
