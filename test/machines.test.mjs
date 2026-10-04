// The slot machine on the real machines — headless, through each target's own
// emulator (`8bs run <t> --screenshot`; no window is ever opened):
//
//   * exact: after 1, 2 and 3 automatic spins from the fixed seed, the nine
//     symbols on the reels, the WIN and the CREDIT on the screen are exactly
//     what the JavaScript oracle (test/support/reference.mjs) says the odds
//     table and the draw order produce;
//   * scrolling: in consecutive frames while a spin runs, every reel shows a
//     real run of its strip and only ever moves down it, a few stops at a time.
//
// It needs the emulators (xpet, xvic, x64sc, x16emu; the web needs none) and
// a few minutes, so it is `pnpm run test:machines`, not part of CI's `pnpm
// test`. A machine whose emulator is not installed is skipped by name.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTable } from './support/table.mjs';
import { play } from './support/reference.mjs';
import { MACHINES, available, capture } from './support/emulator.mjs';
import { calibrate, reference, readWindow, readNumber, loadPng, LAYOUT } from './support/screen.mjs';

const table = loadTable();
const c = table.consts;

// Frames (at the machine's own refresh) generous enough that N automatic
// spins, their win flashes and the idle pause are all over and the screen is
// at rest. The VICE machines spend ~215 frames booting first.
const SETTLED = { 1: 800, 2: 1300, 3: 1900 };

// A frame a few frames into the first spin, with every reel at speed, per
// machine (measured: the spin starts 20 frames after the program does).
const SPIN_AT = { c64: 244, vic20: 244, pet: 204, cx16: 84, web: 26 };
const MOTION_FRAMES = 6;

function stripWindowPositions(reel, column) {
  const out = [];
  for (let p = 0; p < c.STOPS; p += 1) {
    let same = true;
    for (let row = 0; row < c.ROWS; row += 1) {
      if (table.arrays.STRIPS[reel * c.STOPS + ((p + row) & c.STOP_MASK)] !== column[row]) { same = false; break; }
    }
    if (same) out.push(p);
  }
  return out;
}

for (const machine of MACHINES) {
  describe(machine, { skip: available(machine) ? false : `${machine}: emulator not installed` }, () => {
    let geo;
    let ref;
    test('reads the screen: cell size from the ruler, every symbol and digit from the glyph sheet', async () => {
      geo = calibrate(loadPng(await capture(machine, 'slot3x3-ruler', 'ruler')));
      ref = reference(loadPng(await capture(machine, 'slot3x3-glyphs', 'glyphs')), geo, c.SYMBOL_COUNT);
      assert.ok(ref.symbols.size === c.SYMBOL_COUNT && ref.digits.size === 10);
    });

    for (const spins of [1, 2, 3]) {
      test(`after ${spins} automatic spin${spins > 1 ? 's' : ''}: exactly the symbols, win and credit the odds table says`, async () => {
        const expected = play(table, spins)[spins - 1];
        const png = loadPng(await capture(machine, `slot3x3-auto${spins}`, `auto${spins}`, SETTLED[spins]));
        const got = readWindow(png, geo, ref);
        assert.deepEqual(got, expected.window, `reels (stops ${expected.stops.join(',')})`);
        assert.equal(readNumber(png, geo, ref, LAYOUT.numberCol, LAYOUT.winRow, LAYOUT.numberWidth), expected.win, 'WIN');
        assert.equal(readNumber(png, geo, ref, LAYOUT.numberCol, LAYOUT.creditRow, LAYOUT.numberWidth), expected.credits, 'CREDIT');
        assert.equal(readNumber(png, geo, ref, LAYOUT.numberCol, LAYOUT.betRow, LAYOUT.numberWidth), c.BET_CREDITS, 'BET');
      });
    }

    test('while a spin runs, each reel scrolls down its strip a few stops per frame, never up', async () => {
      const shots = [];
      for (let i = 0; i < MOTION_FRAMES; i += 1) {
        shots.push(readWindow(loadPng(await capture(machine, 'slot3x3-auto1', `motion${i}`, SPIN_AT[machine] + i)), geo, ref));
      }
      let moved = 0;
      for (let reel = 0; reel < c.REELS; reel += 1) {
        const columns = shots.map((w) => w.map((row) => row[reel]));
        const readable = columns.map((col) => (col.every((s) => s !== null) ? col : null));
        // A capture can land mid-redraw (a cell not yet drawn): that frame says nothing.
        let reachable = null; // positions consistent with a downward chain so far
        let previous = null;
        readable.forEach((col, t) => {
          if (col === null) return;
          const here = stripWindowPositions(reel, col);
          assert.ok(here.length > 0, `reel ${reel}, frame ${t}: ${col.join(',')} is not a window of its strip`);
          if (reachable === null) {
            reachable = here;
          } else {
            const next = here.filter((p) => reachable.some((q) => ((q - p) & c.STOP_MASK) <= 3));
            assert.ok(next.length > 0, `reel ${reel}, frame ${t}: ${col.join(',')} does not follow ${previous.join(',')} by scrolling down`);
            reachable = next;
          }
          if (previous !== null && previous.join() !== col.join()) moved += 1;
          previous = col;
        });
      }
      assert.ok(moved > 0, 'at least one reel moved during the sampled frames');
    });
  });
}
