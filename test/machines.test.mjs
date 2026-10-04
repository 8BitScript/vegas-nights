// The slot machine on the real machines — headless, through each target's own
// emulator (`8bs run <t> --screenshot`; no window is ever opened).
//
// What it holds the 6502 code to:
//   * exact: after the spins a headless entry takes by itself from a fixed seed,
//     each reel on the screen shows exactly the picture the odds table and the draw
//     order say — the pixels (C64, X16 and the web's 16x16 art) or the quadrant blocks
//     (PET, VIC-20) — and WIN, CREDIT and BET are the oracle's. Four entries cover a
//     loss, a two-payline win, small wins and the jackpot;
//   * scrolling: sampled frame after frame while a spin runs, every reel is at a real
//     position on its strip and only ever moves down it;
//   * easing: in the last frames of a spin the steps are small (a few pixels),
//     never a jump of a symbol;
//   * the win flash: the paying lines blink and the reels end up as they were.
//
// It needs the emulators (xpet, xvic, x64sc, x16emu; the web needs none) and several
// minutes a machine, so it is `pnpm run test:machines`, not part of CI's `pnpm test`.
// A machine whose emulator is not installed is skipped by name, and so is the web
// until the pinned 8BitScript has its glyph table (EIGHTBS_CHECKOUT=/path/to/8bitscript
// runs a checkout that does). MACHINES=c64,web narrows a run.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTable } from './support/table.mjs';
import { play } from './support/reference.mjs';
import { MACHINES, unavailable, capture } from './support/emulator.mjs';
import { calibrate, reference, readNumber, loadPng, layoutFor } from './support/screen.mjs';
import { adapterFor, inkReader, precompute, matches } from './support/adapters.mjs';
import { bestChain } from './support/chain.mjs';

const table = loadTable();
const c = table.consts;

// The headless entries: the seed they play from and the spins they take.
const PROGRAMS = {
  lose: { seed: 2026, spins: 3, frames: 2100 },
  lines: { seed: 145, spins: 1, frames: 900 },
  cherries: { seed: 304, spins: 3, frames: 2100 },
  jackpot: { seed: 315, spins: 1, frames: 900 },
};

// A frame well before the first spin starts (the VICE machines spend ~215 frames
// booting; the spin starts 20 frames after the program does), per machine.
const BEFORE_SPIN = { c64: 190, vic20: 190, pet: 150, cx16: 40, web: 5, c64web: 5 };
// How much longer than the C64's a spin takes to come to rest (a reel redraw costs a
// VIC-20 more of its frame, and its hops are smaller and less frequent).
const SETTLE_SCALE = { c64: 1.3, vic20: 2, pet: 1.4, cx16: 1, web: 1, c64web: 1 };
const SAMPLES = { c64: 10, vic20: 10, pet: 10, cx16: 6, web: 10, c64web: 10 };

const log = (...a) => console.log('   ', ...a);

for (const machine of MACHINES) {
  describe(machine, { skip: unavailable(machine) ?? false }, () => {
    const L = layoutFor(machine);
    let geo;
    let ref;
    let adapter;
    let expectedAt;
    const shoot = async (program, name, frames) => loadPng(await capture(machine, program, name, frames));
    const creditOf = (png) => readNumber(png, geo, ref, L.creditCol, L.creditRow, L.numberWidth);

    test('reads the screen: cell size from the ruler, digits and fallback text from the glyph sheet', async () => {
      geo = calibrate(loadPng(await capture(machine, 'slot3x3-ruler', 'ruler')));
      ref = reference(loadPng(await capture(machine, 'slot3x3-glyphs', 'glyphs')), geo, c.SYMBOL_COUNT);
      adapter = adapterFor(machine, ref);
      expectedAt = precompute(adapter, c.REELS);
      assert.ok(ref.digits.size === 10);
      log(`cell ${geo.pitchX}x${geo.pitchY} px, reel unit = ${adapter.unit}, ${adapter.positions} positions a reel`);
    });

    for (const [name, p] of Object.entries(PROGRAMS)) {
      test(`${name}: after ${p.spins} spin${p.spins > 1 ? 's' : ''} from seed ${p.seed}, exactly the reels, win and credit the odds table says`, async () => {
        const expected = play(table, p.spins, { seed: p.seed })[p.spins - 1];
        const png = await shoot(`slot3x3-${name}`, name, Math.round(p.frames * SETTLE_SCALE[machine]));
        const ink = inkReader(png);
        for (let reel = 0; reel < c.REELS; reel += 1) {
          const want = expectedAt[reel][expected.stops[reel] * adapter.unitsPerSymbol];
          assert.equal(adapter.observe(png, geo, ink, reel), want, `reel ${reel} at stop ${expected.stops[reel]} (the draw plan's byte & ${c.STOP_MASK})`);
        }
        assert.equal(readNumber(png, geo, ref, L.winCol, L.winRow, L.numberWidth), expected.win, 'WIN');
        assert.equal(creditOf(png), expected.credits, 'CREDIT');
        assert.equal(readNumber(png, geo, ref, L.betCol, L.betRow, L.numberWidth), c.BET_CREDITS, 'BET');
        if (name === 'lines') assert.ok(expected.lines.filter((v) => v > 0).length >= 2, 'the entry is meant to pay on two lines');
        if (name === 'jackpot') assert.ok(expected.jackpot, 'the entry is meant to hit the jackpot');
      });
    }

    /** The first frame in [lo, hi] at which `test(png)` holds, by bisection (true stays true after). */
    async function firstFrame(program, lo, hi, holds, step = 4) {
      while (hi - lo > step) {
        const mid = (lo + hi) >> 1;
        if (holds(await shoot(program, `find${mid}`, mid))) hi = mid; else lo = mid;
      }
      return hi;
    }

    /** Capture `frames` of the `lines` entry and decode each reel's candidate positions. */
    async function observe(frames) {
      const shots = [];
      for (const f of frames) {
        const png = await shoot('slot3x3-lines', `obs${f}`, f);
        const ink = inkReader(png);
        shots.push({ frame: f, png, reels: Array.from({ length: c.REELS }, (_, reel) => {
          const seen = adapter.observe(png, geo, ink, reel);
          return { seen, cands: adapter.match ? adapter.match(expectedAt[reel], seen) : matches(adapter, expectedAt[reel], seen) };
        }) });
      }
      return shots;
    }

    /** Chain each reel's captures; the number of distinct positions it passed through and its steps. */
    function chains(shots) {
      return Array.from({ length: c.REELS }, (_, reel) => {
        const chain = bestChain(shots.map((s) => ({ frame: s.frame, cands: s.reels[reel].cands })), adapter.positions, adapter.unitsPerSymbol);
        const steps = chain.slice(1).map((n, i) => (chain[i].p - n.p + adapter.positions) % adapter.positions);
        const moved = new Set(shots.map((s) => s.reels[reel].seen)).size - 1;
        return { reel, chain, steps, moved };
      });
    }

    test('while a spin runs, every reel is at a real strip position and only moves down', async () => {
      const start = await firstFrame('slot3x3-lines', BEFORE_SPIN[machine], BEFORE_SPIN[machine] + 120,
        (png) => creditOf(png) === play(table, 1, { seed: PROGRAMS.lines.seed })[0].credits - play(table, 1, { seed: PROGRAMS.lines.seed })[0].win, 2);
      const frames = Array.from({ length: SAMPLES[machine] }, (_, i) => start + 8 + i);
      const shots = await observe(frames);
      let moved = 0;
      for (const r of chains(shots)) {
        assert.ok(r.chain.length >= Math.max(3, Math.ceil(frames.length / 2)), `reel ${r.reel}: only ${r.chain.length} of ${frames.length} captures chain down the strip`);
        moved += r.moved;
        log(`reel ${r.reel}: ${r.chain.length}/${frames.length} chain; steps (${adapter.unit}s): ${r.steps.join(' ')}`);
      }
      assert.ok(moved > 0, 'at least one reel moved during the sampled frames');
    });

    test('a reel eases in: its last steps before it stops are small', async () => {
      const expected = play(table, 1, { seed: PROGRAMS.lines.seed })[0];
      const home = expectedAt[0][expected.stops[0] * adapter.unitsPerSymbol];
      const rest = await firstFrame('slot3x3-lines', BEFORE_SPIN[machine] + 20, BEFORE_SPIN[machine] + 520,
        (png) => adapter.observe(png, geo, inkReader(png), 0) === home, 6);
      const frames = [];
      // every frame near the stop on the X16, where a reel hops every frame, so one sample is one hop
      if (machine === 'cx16') { for (let f = rest - 16; f <= rest + 2; f += 1) frames.push(f); } else { for (let f = rest - 48; f <= rest + 2; f += 2) frames.push(f); }
      const [r] = chains(await observe(frames));
      log(`reel 0 comes to rest at frame ~${rest}; steps (${adapter.unit}s): ${r.steps.join(' ')}`);
      assert.ok(r.chain.length >= 4, 'enough captures chain down the strip');
      const pxPerUnit = adapter.symbolPixels / adapter.unitsPerSymbol;
      if (adapter.unitsPerSymbol > 1) {
        const last = r.steps.filter((d) => d > 0).slice(-4);
        assert.ok(last.length > 0 && last.every((d) => d * pxPerUnit <= 12), `the last steps are 12 pixels or less (${last.map((d) => d * pxPerUnit).join(', ')})`);
      }
    });

    test('the paying lines flash, and the reels come to rest as they were', async () => {
      const expected = play(table, 1, { seed: PROGRAMS.lines.seed })[0];
      const home = expectedAt[0][expected.stops[0] * adapter.unitsPerSymbol];
      const rest = await firstFrame('slot3x3-lines', BEFORE_SPIN[machine] + 20, BEFORE_SPIN[machine] + 520,
        (png) => adapter.observe(png, geo, inkReader(png), 0) === home, 6);
      const regionOf = (png) => {
        // every pixel of the reel window, as one string: sees a colour change as well as a shape change
        const out = [];
        const w = adapter.window;
        for (let y = geo.y0 + w.row * geo.pitchY; y < geo.y0 + (w.row + w.rows) * geo.pitchY; y += 2) for (let x = geo.x0 + w.col * geo.pitchX; x < geo.x0 + (w.col + w.cols) * geo.pitchX; x += 2) out.push(png.at(x, y));
        return out.join(',');
      };
      const seen = new Set();
      for (let f = rest + 6; f < rest + 96; f += machine === 'cx16' ? 12 : 8) seen.add(regionOf(await shoot('slot3x3-lines', `flash${f}`, f)));
      assert.ok(seen.size >= 2, `the reel window changes while the win flashes (${seen.size} distinct pictures)`);
      const png = await shoot('slot3x3-lines', 'flashEnd', Math.round(PROGRAMS.lines.frames * SETTLE_SCALE[machine]));
      const ink = inkReader(png);
      for (let reel = 0; reel < c.REELS; reel += 1) {
        assert.equal(adapter.observe(png, geo, ink, reel), expectedAt[reel][expected.stops[reel] * adapter.unitsPerSymbol], `reel ${reel} is back as it was after the flash`);
      }
    });
  });
}
