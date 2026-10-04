// The 5x5's odds, held to the engine's exact figures — with no emulator, so this runs
// in CI. What it proves:
//   * the game's rules (test/support/reference5.mjs, which mirrors game.8bs line for
//     line) pay, over ALL 32^5 reel positions, exactly the ways + scatter return the
//     engine computed independently (61.132% + 3.171% of the bet);
//   * the bonus round's rules (triple wins, retrigger, the cap) return what the engine's
//     recursion says — here by a large simulation with a proper generator, to within
//     sampling error, which is plenty to catch a missing ×3 or a wrong cap;
//   * the constants game.8bs keeps by hand (the 32-bit jackpot seeds the 6502 backends
//     cannot read) equal the generated file's;
//   * each headless entry's seed shows what the entry is for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTable, ROOT } from './support/table.mjs';
import { evaluate, play, SEED } from './support/reference5.mjs';
import { build } from '../tools/slotmath/src/index.mjs';

const table = loadTable('grid5x5');
const c = table.consts;
const a = table.arrays;

test('the game pays, over every one of the 33,554,432 reel positions, exactly the ways and scatter return the engine computed', async () => {
  const { analysis } = await build('grid5x5');
  // Per reel, per stop: how many cells match each paying symbol (itself or a wild), and the scatters.
  const match = [];
  const scat = [];
  for (let reel = 0; reel < c.REELS; reel += 1) {
    match.push([]);
    scat.push([]);
    for (let stop = 0; stop < c.STOPS; stop += 1) {
      const counts = new Array(c.PAY_SYMBOLS).fill(0);
      let s = 0;
      for (let row = 0; row < c.ROWS; row += 1) {
        const sym = a.STRIPS[reel * c.STOPS + ((stop + row) & c.STOP_MASK)];
        for (let p = 0; p < c.PAY_SYMBOLS; p += 1) if (sym === p || sym === c.WILD_SYMBOL) counts[p] += 1;
        if (sym === c.SCATTER_SYMBOL) s += 1;
      }
      match[reel].push(counts);
      scat[reel].push(s);
    }
  }
  const paying = [];
  for (let p = 0; p < c.PAY_SYMBOLS; p += 1) if (a.PAYS.slice(p * c.PAY_WIDTH, p * c.PAY_WIDTH + c.PAY_WIDTH).some((v) => v !== 0)) paying.push(p);
  let total = 0;
  const idx = [0, 0, 0, 0, 0];
  const reelsOf = [match[0], match[1], match[2], match[3], match[4]];
  for (idx[0] = 0; idx[0] < c.STOPS; idx[0] += 1) for (idx[1] = 0; idx[1] < c.STOPS; idx[1] += 1) for (idx[2] = 0; idx[2] < c.STOPS; idx[2] += 1) {
    for (idx[3] = 0; idx[3] < c.STOPS; idx[3] += 1) for (idx[4] = 0; idx[4] < c.STOPS; idx[4] += 1) {
      let win = 0;
      for (const p of paying) {
        let ways = 1;
        let run = 0;
        for (let r = 0; r < 5; r += 1) {
          const n = reelsOf[r][idx[r]][p];
          if (n === 0) break;
          ways *= n;
          run += 1;
        }
        win += a.PAYS[p * c.PAY_WIDTH + run] * ways;
      }
      total += win + a.SCATTER_PAYS[scat[0][idx[0]] + scat[1][idx[1]] + scat[2][idx[2]] + scat[3][idx[3]] + scat[4][idx[4]]];
    }
  }
  const mean = total / c.STOPS ** 5 / c.BET_CREDITS;
  assert.ok(Math.abs(mean - (analysis.components.lines + analysis.components.scatter)) < 1e-12,
    `enumerated ${mean}, engine ${analysis.components.lines + analysis.components.scatter}`);

  // …and the oracle the 6502 side is held to evaluates a position exactly as that fast route does.
  let state = 12345;
  const next = () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state >>> 8; };
  for (let i = 0; i < 4000; i += 1) {
    const positions = [0, 1, 2, 3, 4].map(() => next() & c.STOP_MASK);
    let want = 0;
    for (const p of paying) {
      let ways = 1;
      let run = 0;
      for (let r = 0; r < 5; r += 1) {
        const n = match[r][positions[r]][p];
        if (n === 0) break;
        ways *= n;
        run += 1;
      }
      want += a.PAYS[p * c.PAY_WIDTH + run] * ways;
    }
    want += a.SCATTER_PAYS[positions.reduce((sum, stop, r) => sum + scat[r][stop], 0)];
    assert.equal(evaluate(table, positions).win, want, `positions ${positions}`);
  }
});

test('the bonus round, played by the game\'s rules, returns the engine\'s exact figure (triple wins, retrigger, the cap)', async () => {
  const { analysis } = await build('grid5x5');
  // A proper generator (xorshift32), not the machine's 16-bit LCG: the point is the rules.
  let x = 0x9e3779b9;
  const rng = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x >>> 24; };
  const spins = 300_000;
  const results = play(table, spins, { rng });
  let sum = 0;
  let sessions = 0;
  let longest = 0;
  for (const r of results) {
    sum += (r.win - r.jackpotPaid) + r.session;
    if (r.free.length) { sessions += 1; longest = Math.max(longest, r.granted); }
    assert.ok(!r.granted || r.granted <= c.FREE_SPIN_CAP, 'a session never grants more than the cap');
    assert.equal(r.free.length, r.granted ?? 0, 'every granted free spin is played');
  }
  const rtp = sum / (spins * c.BET_CREDITS);
  const engine = analysis.components.lines + analysis.components.scatter + analysis.components.freeSpins;
  // Standard error of the mean at 5.5 bets a spin, 300,000 spins: about 0.010. Four of them.
  assert.ok(Math.abs(rtp - engine) < 0.04, `simulated ${rtp.toFixed(4)} vs engine ${engine.toFixed(4)}`);
  // A missing x3 would put the bonus at a third of its share, a missing retrigger a little short of it.
  assert.ok(sessions > spins / 120 && sessions < spins / 45, `${sessions} bonus rounds in ${spins} spins (the engine says 1 in ${Math.round(1 / analysis.freeSpinTrigger)})`);
  assert.ok(longest > 8, 'some round retriggers');
});

test('the jackpot seeds game.8bs keeps by hand are the generated file\'s, and the meters grow by whole credits', () => {
  const game = readFileSync(join(ROOT, 'src', 'labs', 'slot5x5', 'game.8bs'), 'utf8');
  const millions = /const SEED_MILLIONS: array<usmallint, 4> = \[([^\]]*)\]/.exec(game)[1].split(',').map(Number);
  const thousands = /const SEED_THOUSANDS: array<usmallint, 4> = \[([^\]]*)\]/.exec(game)[1].split(',').map(Number);
  for (let j = 0; j < c.JACKPOT_COUNT; j += 1) {
    assert.equal(millions[j] * 1_000_000 + thousands[j] * 1000, a.JACKPOT_SEED[j], `jackpot ${j}`);
    assert.equal(a.JACKPOT_CONTRIB_Q8[j] % 256, 0, `jackpot ${j} grows by whole credits, so the 6502 side needs no fractions`);
  }
  assert.equal(c.PAY_SYMBOLS, 8);
  assert.equal(c.REELS, 5);
});

test('each headless entry\'s seed shows what the entry is for', () => {
  const entry = (name) => /play\((\d+), (\d+)\)/.exec(readFileSync(join(ROOT, 'src', 'labs', 'slot5x5', `${name}.8bs`), 'utf8')).slice(1).map(Number);
  const first = (name) => { const [spins, seed] = entry(name); assert.equal(spins, 1); return play(table, 1, { seed })[0]; };
  const lose = first('lose');
  assert.equal(lose.win, 0);
  assert.equal(lose.free.length, 0);
  const win = first('win');
  assert.ok(win.win >= 3000 && win.free.length === 0 && win.jackpot < 0, `the win entry pays ${win.win}`);
  const bonus = first('bonus');
  assert.ok(bonus.scatters >= 3 && bonus.free.length === a.FREE_SPIN_AWARD[bonus.scatters], 'the bonus entry starts a round with no retrigger');
  const retrigger = first('retrigger');
  assert.ok(retrigger.granted > a.FREE_SPIN_AWARD[retrigger.scatters], 'the retrigger entry\'s round is extended');
  const jackpot = first('jackpot');
  assert.equal(jackpot.jackpot, 0, 'the jackpot entry wins MINI');
  assert.equal(jackpot.jackpotPaid, a.JACKPOT_SEED[0] + (a.JACKPOT_CONTRIB_Q8[0] >> 8), 'MINI pays its seed plus the one spin\'s contribution');
  assert.equal(SEED, 2026);
});
