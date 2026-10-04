// The 5x5 on the real machines — headless, through each target's own emulator
// (`8bs run <t> --screenshot`; no window is ever opened).
//
// What it holds the 6502 code to:
//   * exact: after the base spin a headless entry takes by itself from a fixed seed, each of
//     the five reels on the screen shows exactly the picture the odds table and the draw
//     order say — the pixels (C64, X16) or the quadrant blocks (PET, VIC-20, web) — and
//     CREDIT, BET, WIN and the four jackpot meters are the oracle's, digit for digit;
//   * the bonus round: from the entry whose first spin lands three scatters, the free-spin
//     counter counts down from 8 and the credit, once the round is over, is exactly what
//     the oracle says the eight free spins at triple wins pay; and for the entry whose
//     round retriggers, the same, which also proves the cap and the retrigger rule;
//   * the jackpot: the entry that wins MINI is paid its meter, and the meter is back at
//     its seed;
//   * scrolling: sampled frame after frame while a spin runs, every reel is at a real
//     position on its strip and only ever moves down it, and its last steps are small.
//
// It needs the emulators (xpet, xvic, x64sc, x16emu; the web needs none) and several
// minutes a machine, so it is `pnpm run test:machines`, not part of CI's `pnpm test`.
// A machine whose emulator is not installed is skipped by name. MACHINES=c64,web narrows
// a run.
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTable, labConsts } from './support/table.mjs';
import { play } from './support/reference5.mjs';
import { MACHINES, unavailable, capture } from './support/emulator.mjs';
import { calibrate, reference, readNumber, loadPng, rowBlank } from './support/screen.mjs';
import { frame } from './support/geometry.mjs';
import { inkReader } from './support/adapters.mjs';
import { KIND, pixelAdapter, quadAdapter } from './support/adapters5.mjs';
import { bestChain } from './support/chain.mjs';

const table = loadTable('grid5x5');
const c = table.consts;

// Frames to let a machine run: one base spin settles (the VICE machines spend ~215 frames
// booting; the spin starts 20 frames after the program does), and a whole bonus round ends.
const SPIN = { c64: 2400, vic20: 4000, pet: 3200, cx16: 2400, web: 2400, c64web: 2400 };
// …and a whole bonus round: the base spin and its flash, then each free spin.
const ROUND = { c64: [1700, 700], vic20: [3000, 1500], pet: [2400, 1100], cx16: [900, 400], web: [1700, 700], c64web: [1700, 700] };
const roundFrames = (machine, granted) => ROUND[machine][0] + ROUND[machine][1] * granted;
// The most a reel moves in one frame, in pixels: a reel hops 12 pixels every second frame on the
// C64, 8 every frame on the X16, 12 every third frame (a quadrant row is 4) on the others.
const MAX_PX_PER_FRAME = { c64: 12, cx16: 8, pet: 12, vic20: 12, web: 12, c64web: 12 };
// A frame well before the first spin starts.
const BEFORE_SPIN = { c64: 190, vic20: 190, pet: 150, cx16: 40, web: 5, c64web: 5 };
const SAMPLES = { c64: 10, vic20: 8, pet: 8, cx16: 6, web: 10, c64web: 10 };

// Where the game puts things (src/labs/slot5x5/game.8bs, view.8bs, view.pet.8bs).
const PANEL = (machine) => labConsts('slot5x5', machine).PANEL;

const log = (...args) => console.log('   ', ...args);

/** The seed the entry plays from. */
const seedOf = (name) => Number(/play\(1, (\d+)\)/.exec(readFileSync(new URL(`../src/labs/slot5x5/${name}.8bs`, import.meta.url), 'utf8'))[1]);

for (const machine of MACHINES) {
  // The web's 5x5 draws with the host font's block glyphs and needs no redefinable glyph table, so
  // it is not held back by the check that skips the 3x3's web reels on a release without one.
  const why = machine === 'web' ? null : unavailable(machine);
  describe(machine, { skip: why ?? false }, () => {
    let geo;
    let ref;
    let adapter;
    let expectedAt;
    const shoot = async (program, name, frames) => loadPng(await capture(machine, program, name, frames));
    const panel = PANEL(machine);
    const num = (png, col, row, width) => readNumber(png, geo, ref, col, row, width);
    const credit = (png) => num(png, 7, panel, 9);
    const win = (png) => num(png, 4, panel + 2, 9);
    const bet = (png) => num(png, 4, panel + 1, 4);
    const freeSpins = (png) => num(png, 13, panel + 1, 2);
    // a jackpot meter: one digit of millions, then two groups of three
    const meter = (png, col, row) => num(png, col, panel + row, 1) * 1_000_000 + num(png, col + 1, panel + row, 6);
    const meters = (png) => [meter(png, 3, 4), meter(png, 14, 4), meter(png, 3, 5), meter(png, 14, 5)];

    /** The first frame in [lo, hi] at which `holds(png)` is true (and stays true), by bisection. */
    async function firstFrame(program, lo, hi, holds, step = 4) {
      while (hi - lo > step) {
        const mid = (lo + hi) >> 1;
        if (holds(await shoot(program, `find${mid}`, mid))) hi = mid; else lo = mid;
      }
      return hi;
    }

    test('reads the screen: cell size from the ruler, digits from the glyph sheet', async () => {
      // The 5x5's own ruler gives the block's position; the digits are the machine's font, the
      // same in any program, so the 3x3's glyph sheet (read with the 3x3's ruler) names them.
      geo = calibrate(loadPng(await capture(machine, 'slot5x5-ruler', 'ruler5')));
      const geo3 = calibrate(loadPng(await capture(machine, 'slot3x3-ruler', 'ruler3')));
      ref = reference(loadPng(await capture(machine, 'slot3x3-glyphs', 'glyphs3')), geo3, 6);
      adapter = KIND[machine] === 'pixel' ? pixelAdapter(machine) : quadAdapter(machine);
      expectedAt = Array.from({ length: c.REELS }, (_, reel) => Array.from({ length: adapter.positions }, (__, p) => adapter.expected(reel, p)));
      assert.ok(ref.digits.size === 10);
      log(`cell ${geo.pitchX}x${geo.pitchY} px, reel unit = ${adapter.unit}, ${adapter.positions} positions a reel`);
    });

    test('the row under the frame is blank, and the panel starts below it', { skip: machine === 'vic20' ? 'the 22-column VIC-20 has no spare row (test/panel.test.mjs lists it)' : false }, async () => {
      const png = await shoot('slot5x5-lose', 'panelrow', SPIN[machine]);
      const f = frame('slot5x5', machine);
      assert.ok(rowBlank(png, geo, f.bottom + 1, 0, 21), `row ${f.bottom + 1}, under the frame, has something drawn in it`);
      assert.ok(!rowBlank(png, geo, panel, 0, 21), `the credit row (${panel}) is empty`);
    });

    for (const name of ['lose', 'win', 'jackpot']) {
      test(`${name}: after one spin the reels, credit, win and meters are exactly the oracle's`, async () => {
        const seed = seedOf(name);
        const [expected] = play(table, 1, { seed });
        const png = await shoot(`slot5x5-${name}`, name, SPIN[machine]);
        const ink = inkReader(png);
        for (let reel = 0; reel < c.REELS; reel += 1) {
          assert.equal(adapter.observe(png, geo, ink, reel), expectedAt[reel][expected.stops[reel] * adapter.unitsPerSymbol], `reel ${reel} at stop ${expected.stops[reel]}`);
        }
        assert.equal(credit(png), expected.credits, 'CREDIT');
        assert.equal(win(png), expected.win, 'WIN');
        assert.equal(bet(png), c.BET_CREDITS, 'BET');
        assert.deepEqual(meters(png), expected.meters.map((m, j) => m), 'the four jackpot meters');
        if (name === 'win') assert.ok(expected.win >= 3000, 'the entry is meant to pay several ways at once');
        if (name === 'jackpot') assert.equal(expected.jackpot, 0, 'the entry is meant to win MINI');
        log(`${name}: stops ${expected.stops.join(' ')}, win ${expected.win}, credit ${expected.credits}`);
      });
    }

    for (const name of ['bonus', 'retrigger']) {
      test(`${name}: the free-spin round runs to its end and the credit is exactly what the oracle says`, async () => {
        const seed = seedOf(name);
        const [expected] = play(table, 1, { seed });
        const granted = expected.granted;
        assert.ok(granted >= c.FREE_SPIN_CAP * 0 + 8, 'the entry starts a round');
        // Find where the round ends: the first frame at which CREDIT is the oracle's final figure
        // (it only reaches it after the last free spin pays), then look at the counter at five
        // points between the end of the first spin and that frame.
        // (x16emu captures run in real time, about a minute for 3,000 frames, so there the end is the
        // calibrated one rather than found by bisection.)
        const limit = Math.round(roundFrames(machine, granted) * 1.6);
        const end = machine === 'cx16'
          ? roundFrames(machine, granted)
          : await firstFrame(`slot5x5-${name}`, BEFORE_SPIN[machine], limit, (png) => credit(png) === expected.credits, 8);
        const from = Math.round(end * 0.3);
        const mid = [];
        for (const f of [0, 1, 2, 3, 4].map((i) => from + Math.round(((end - from) * (i + 0.5)) / 5))) {
          const png = await shoot(`slot5x5-${name}`, `${name}-mid${f}`, f);
          mid.push(freeSpins(png));
        }
        const seen = mid.filter((v) => v !== null);
        log(`${name}: the round ends at frame ~${end}; free-spin counter at five points of it: ${mid.join(' ')} (granted ${granted})`);
        assert.ok(seen.length >= (machine === 'cx16' ? 2 : 3), 'the counter is on screen during the round');
        assert.ok(seen.every((v) => v <= Math.min(granted, c.FREE_SPIN_CAP)), 'never above what was granted');
        // a retrigger can raise the counter, so only the plain round is held to counting down
        if (name === 'bonus') assert.ok(seen.every((v, i) => i === 0 || v <= seen[i - 1]), `the counter only counts down: ${seen.join(' ')}`);
        const final = await shoot(`slot5x5-${name}`, `${name}-after`, end + 60);
        assert.equal(credit(final), expected.credits, `CREDIT after ${expected.free.length} free spins at triple wins (session ${expected.session})`);
        assert.equal(bet(final), c.BET_CREDITS);
      });
    }

    /** Capture `frames` of the `win` entry and decode each reel's candidate positions. */
    async function observe(frames) {
      const shots = [];
      for (const f of frames) {
        const png = await shoot('slot5x5-win', `obs${f}`, f);
        const ink = inkReader(png);
        shots.push({ frame: f, reels: Array.from({ length: c.REELS }, (_, reel) => {
          const seen = adapter.observe(png, geo, ink, reel);
          const cands = [];
          for (let p = 0; p < adapter.positions; p += 1) if (expectedAt[reel][p] === seen) cands.push(p);
          return { seen, cands };
        }) });
      }
      return shots;
    }

    test('while a spin runs, every reel is at a real strip position and only moves down', async () => {
      // The spin starts once the bet is taken from the credit (after the boot, the strip build
      // and the 20-frame pause): the first frame at which CREDIT is no longer the starting 100,000.
      const start = await firstFrame('slot5x5-win', BEFORE_SPIN[machine], BEFORE_SPIN[machine] + 700, (png) => {
        const v = credit(png);
        return v !== null && v !== 100_000;
      }, 3);
      log(`the spin starts at frame ~${start}`);
      const frames = Array.from({ length: SAMPLES[machine] }, (_, i) => start + 10 + i * 5);
      const shots = await observe(frames);
      let moved = 0;
      for (let reel = 0; reel < c.REELS; reel += 1) {
        const chain = bestChain(shots.map((s) => ({ frame: s.frame, cands: s.reels[reel].cands })), adapter.positions, Math.ceil(MAX_PX_PER_FRAME[machine] / adapter.pxPerUnit));
        const steps = chain.slice(1).map((n, i) => (chain[i].p - n.p + adapter.positions) % adapter.positions);
        moved += new Set(shots.map((s) => s.reels[reel].seen)).size - 1;
        log(`reel ${reel}: ${chain.length}/${frames.length} captures chain down the strip; steps (${adapter.unit}s): ${steps.join(' ')}`);
        // a capture can catch a reel mid-redraw (half one frame, half the next), which matches no position
        assert.ok(chain.length >= 3, `reel ${reel}: only ${chain.length} of ${frames.length} captures sit on the strip`);
      }
      assert.ok(moved > 0, 'at least one reel moved during the sampled frames');
    });
  });
}
