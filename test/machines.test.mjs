// The slot machine on the real machines — headless, through each target's own
// emulator (`8bs run <t> --screenshot`; no window is ever opened).
//
// What it holds the six hundred lines of 6502 to:
//   * exact: after 1, 2 and 3 automatic spins from the fixed seed, each reel on
//     the screen shows exactly the picture the odds table and the draw order say
//     — the pixels (C64, X16), the quadrant blocks (PET, VIC-20) or the symbols
//     (web) — and the WIN, CREDIT and BET numbers are the oracle's;
//   * scrolling: sampled frame after frame while a spin runs, every reel is at a
//     real position on its strip, and only ever moves down it;
//   * easing: in the last frames of a spin the steps are small (a few pixels),
//     never a jump of a symbol.
//
// It needs the emulators (xpet, xvic, x64sc, x16emu; the web needs none) and a few
// minutes a machine, so it is `pnpm run test:machines`, not part of CI's `pnpm
// test`. A machine whose emulator is not installed is skipped by name.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTable } from './support/table.mjs';
import { play } from './support/reference.mjs';
import { MACHINES, available, capture } from './support/emulator.mjs';
import { calibrate, reference, readNumber, loadPng, LAYOUT } from './support/screen.mjs';
import { adapterFor, inkReader, precompute, matches } from './support/adapters.mjs';

const table = loadTable();
const c = table.consts;

// Frames (at the machine's own refresh) by which N automatic spins, their win
// flashes and the idle pause are over and the screen is at rest. The VICE
// machines spend ~215 frames booting first.
const SETTLED = { 1: 900, 2: 1500, 3: 2100 };

// A frame a few frames into the first spin, with every reel at speed (measured:
// the spin starts 20 frames after the program does).
const SPIN_AT = { c64: 244, vic20: 244, pet: 204, cx16: 84, web: 26 };
const SAMPLES = { c64: 10, vic20: 10, pet: 10, cx16: 6, web: 10 };

const log = (...a) => console.log('   ', ...a);

for (const machine of MACHINES) {
  describe(machine, { skip: available(machine) ? false : `${machine}: emulator not installed` }, () => {
    let geo;
    let ref;
    let adapter;
    let expectedAt;
    const shoot = async (program, name, frames) => loadPng(await capture(machine, program, `${name}-${machine}`.replace(`-${machine}`, ''), frames));

    test('reads the screen: cell size from the ruler, digits and fallback text from the glyph sheet', async () => {
      geo = calibrate(loadPng(await capture(machine, 'slot3x3-ruler', 'ruler')));
      ref = reference(loadPng(await capture(machine, 'slot3x3-glyphs', 'glyphs')), geo, c.SYMBOL_COUNT);
      adapter = adapterFor(machine, ref);
      expectedAt = precompute(adapter, c.REELS);
      assert.ok(ref.digits.size === 10);
      log(`cell ${geo.pitchX}x${geo.pitchY} px, reel unit = ${adapter.unit}, ${adapter.positions} positions a reel`);
    });

    for (const spins of [1, 2, 3]) {
      test(`after ${spins} automatic spin${spins > 1 ? 's' : ''}: exactly the reels, win and credit the odds table says`, async () => {
        const expected = play(table, spins)[spins - 1];
        const png = await shoot(`slot3x3-auto${spins}`, `auto${spins}`, SETTLED[spins]);
        const ink = inkReader(png);
        for (let reel = 0; reel < c.REELS; reel += 1) {
          const want = expectedAt[reel][expected.stops[reel] * adapter.unitsPerSymbol];
          const got = adapter.observe(png, geo, ink, reel);
          assert.equal(got, want, `reel ${reel} at stop ${expected.stops[reel]} (the draw plan's byte & ${c.STOP_MASK})`);
        }
        assert.equal(readNumber(png, geo, ref, LAYOUT.numberCol, LAYOUT.winRow, LAYOUT.numberWidth), expected.win, 'WIN');
        assert.equal(readNumber(png, geo, ref, LAYOUT.numberCol, LAYOUT.creditRow, LAYOUT.numberWidth), expected.credits, 'CREDIT');
        assert.equal(readNumber(png, geo, ref, LAYOUT.numberCol, LAYOUT.betRow, LAYOUT.numberWidth), c.BET_CREDITS, 'BET');
      });
    }

    /** Capture `frames`, decode each reel's candidate positions, and chain them downward. */
    async function track(frames) {
      const per = [];
      for (const f of frames) {
        const png = await shoot('slot3x3-auto1', `track${f}`, f);
        const ink = inkReader(png);
        const seen = Array.from({ length: c.REELS }, (_, reel) => adapter.observe(png, geo, ink, reel));
        per.push({ frame: f, seen, reels: seen.map((o, reel) => matches(adapter, expectedAt[reel], o)) });
      }
      const result = [];
      for (let reel = 0; reel < c.REELS; reel += 1) {
        let reachable = null;
        let last = null;
        const deltas = [];
        let readable = 0;
        let moves = 0;
        for (const shot of per) {
          const here = shot.reels[reel];
          if (here.length === 0) continue; // a capture caught mid-redraw says nothing
          readable += 1;
          if (reachable === null) {
            reachable = here;
          } else {
            const gap = shot.frame - last.frame;
            const limit = adapter.unitsPerSymbol * (Math.floor(gap / 2) + 1);
            // every way the reel could have got from where it was to where it is, going down
            const ways = [];
            for (const p of here) for (const q of reachable) {
              const d = (q - p + adapter.positions) % adapter.positions;
              if (d <= limit) ways.push([p, d]);
            }
            assert.ok(ways.length > 0, `reel ${reel}, frame ${shot.frame}: position(s) ${here.slice(0, 4)} do not follow ${reachable.slice(0, 4)} by scrolling down at most ${limit} ${adapter.unit}s`);
            if (shot.seen[reel] !== last.seen[reel]) {
              moves += 1;
              deltas.push(Math.min(...ways.map(([, d]) => d)));
            } else {
              deltas.push(0);
            }
            reachable = [...new Set(ways.map(([p]) => p))];
          }
          last = shot;
        }
        result.push({ reel, readable, moves, deltas });
      }
      return { result, readable: per.length };
    }

    test('while a spin runs, every reel is at a real strip position and only moves down', async () => {
      const start = SPIN_AT[machine];
      const frames = Array.from({ length: SAMPLES[machine] }, (_, i) => start + i);
      const { result } = await track(frames);
      let moved = 0;
      for (const r of result) {
        assert.ok(r.readable >= Math.ceil(frames.length / 3), `reel ${r.reel}: only ${r.readable} of ${frames.length} captures decoded to a strip position`);
        moved += r.moves;
        log(`reel ${r.reel}: ${r.readable}/${frames.length} decoded, steps (${adapter.unit}s): ${r.deltas.join(' ')}`);
      }
      assert.ok(moved > 0, 'at least one reel moved during the sampled frames');
    });

    test('a reel eases in: its last steps before it stops are small', async () => {
      // Find, by a coarse scan, the first frame at which reel 0 is where it will stop…
      const expected = play(table, 1)[0];
      const home = expectedAt[0][expected.stops[0] * adapter.unitsPerSymbol];
      let lo = SPIN_AT[machine];
      let hi = SPIN_AT[machine] + 320;
      while (hi - lo > 6) {
        const mid = (lo + hi) >> 1;
        const png = await shoot('slot3x3-auto1', `ease${mid}`, mid);
        if (adapter.observe(png, geo, inkReader(png), 0) === home) hi = mid; else lo = mid;
      }
      // …then watch the frames up to it.
      const frames = [];
      for (let f = hi - 30; f <= hi + 2; f += machine === 'cx16' ? 4 : 2) frames.push(f);
      const { result } = await track(frames);
      const r = result[0];
      log(`reel 0 comes to rest at frame ~${hi}; steps (${adapter.unit}s): ${r.deltas.join(' ')}`);
      assert.ok(r.readable >= 4, 'enough captures decoded');
      const small = Math.ceil(adapter.unitsPerSymbol / 2); // half a symbol
      assert.ok(r.deltas.every((d) => d <= small + adapter.unitsPerSymbol), `no step of more than a symbol and a half`);
      assert.ok(r.deltas.some((d) => d !== 0 && d <= small), 'the reel makes steps of less than half a symbol before it stops');
    });
  });
}
