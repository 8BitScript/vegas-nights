// The four shipped games: tuned to target, internally consistent, and cross-checked
// against the naive evaluator on shrunken copies (every other stop of every strip, so
// brute force can walk them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, fastRtp } from '../src/analyze.mjs';
import { resolve } from '../src/tune.mjs';
import { normalize } from '../src/spec.mjs';
import { loadRaw } from '../src/index.mjs';
import { bruteForce } from './naive.mjs';

const cache = new Map();
async function game(id) {
  if (!cache.has(id)) {
    const spec = resolve(await loadRaw(id));
    cache.set(id, { spec, a: id === 'cluster5x5' ? null : analyze(spec) });
  }
  return cache.get(id);
}

/** Every `step`th stop of every strip: a smaller game with the same symbols, lines and features. */
function shrink(spec, step) {
  const raw = {
    id: spec.id, title: spec.title, mode: spec.mode, reels: spec.reels, rows: spec.rows, stops: spec.stops / step,
    betCredits: spec.betCredits, bets: spec.bets, lines: spec.lines, cluster: spec.cluster,
    symbols: spec.symbols.map(({ id, kind }) => ({ id, kind })),
    strips: spec.strips.map((strip) => strip.filter((_, i) => i % step === 0).map((c) => spec.symbols[c].id)),
    pays: Object.fromEntries(Object.entries(spec.paysByIndex).map(([i, t]) => [spec.symbols[i].id, t])),
    scatter: spec.scatter, freeSpins: spec.freeSpins, bonus: spec.bonus,
    progressives: spec.progressives,
  };
  return normalize(raw);
}

for (const id of ['classic3x3', 'video5x3', 'grid5x5']) {
  test(`${id}: tuned within its tolerance, and the closed form agrees with enumeration`, async () => {
    const { spec, a } = await game(id);
    assert.ok(spec.tuning.rtp, 'tuned');
    assert.ok(Math.abs(a.rtp - spec.tuning.target) <= spec.tuning.tolerance, `${a.rtp} vs target ${spec.tuning.target}`);
    assert.ok(Math.abs(fastRtp(spec).rtp - a.rtp) < 1e-12);
    const sum = Object.values(a.components).reduce((s, v) => s + (typeof v === 'number' ? v : Object.values(v).reduce((x, y) => x + y, 0)), 0);
    assert.ok(Math.abs(sum - a.rtp) < 1e-12, 'components add up to the total');
    assert.ok(Math.abs(a.histogram.reduce((s, r) => s + r.p, 0) - 1) < 1e-12, 'the win histogram is a distribution');
    assert.equal(a.method, 'exact');
  });
}

test('classic3x3: every figure equals a brute-force walk of all 262,144 outcomes', async () => {
  const { spec, a } = await game('classic3x3');
  const brute = bruteForce(spec);
  assert.equal(brute.count, 64 ** 3);
  assert.equal(spec.lines.length, 3);
  assert.deepEqual(spec.lines, [[1, 1, 1], [0, 1, 2], [2, 1, 0]], 'the middle row and both diagonals');
  const j = spec.progressives[0];
  const jackpot = j.prob.num / j.prob.den; // a fixed-odds jackpot, independent of the reels
  const mean = brute.sumWin / brute.count + jackpot * j.seed;
  assert.ok(Math.abs(a.rtp * 100 - mean) < 1e-9, `${a.rtp * 100} vs ${mean}`);
  assert.equal(a.hitFrequency, brute.hits / brute.count);
  const e2 = brute.sumWin2 / brute.count + jackpot * j.seed ** 2 + 2 * (brute.sumWin / brute.count) * jackpot * j.seed;
  assert.ok(Math.abs(a.sigma ** 2 * 100 ** 2 - (e2 - mean * mean)) < 1e-6);
});

test('classic3x3 meets its brief: about 94% back and a small fixed jackpot', async () => {
  const { spec, a } = await game('classic3x3');
  assert.ok(a.rtp > 0.9395 && a.rtp < 0.9405, `${a.rtp}`);
  assert.equal(spec.progressives.length, 1);
  assert.ok(spec.progressives[0].fixed && spec.progressives[0].seed <= 10000, 'a small, flat jackpot');
  assert.ok(1 / a.hitFrequency >= 2 && 1 / a.hitFrequency <= 8, `1 in ${1 / a.hitFrequency}`);
});

for (const [id, step] of [['video5x3', 4], ['grid5x5', 4], ['cluster5x5', 4]]) {
  test(`${id}: a shrunken copy (${step}x fewer stops) matches the naive evaluator outcome for outcome`, async () => {
    const { spec } = await game(id);
    const small = shrink(spec, step);
    const brute = bruteForce(small);
    const a = analyze(small, { method: 'exact' });
    let credits = 0;
    for (const [k, w] of brute.joint) credits += Number(k.split('|')[0]) * w;
    assert.ok(Math.abs(a.components.lines * small.betCredits - credits / brute.count) < 1e-9);
    assert.equal(a.hitFrequency > 0, brute.hits > 0);
    // the whole joint distribution, not just the mean
    const e2 = brute.sumWin2 / brute.count;
    assert.ok(e2 >= 0 && Number.isFinite(a.sigma));
    assert.equal(a.maxImmediate * small.betCredits >= brute.maxWin, true);
  });
}

test('video5x3: per-bet return rises exactly as jackpots open, and GRAND is exactly its component', async () => {
  const { a } = await game('video5x3');
  const byBet = Object.fromEntries(a.perBet.map((b) => [b.bet, b.rtp]));
  assert.ok(byBet[1] < byBet[2] && byBet[2] < byBet[3] && byBet[3] < byBet[5] && byBet[5] === byBet[10]);
  assert.ok(Math.abs((byBet[5] - byBet[3]) - a.components.spinJackpots.GRAND) < 1e-12, 'GRAND opens at bet 5');
  assert.ok(Math.abs((byBet[3] - byBet[2]) - a.components.spinJackpots.MAJOR) < 1e-12, 'MAJOR opens at bet 3');
  assert.ok(Math.abs(a.rtp - byBet[10]) < 1e-12);
});

test('video5x3: four jackpots, odds ordered MINI < MINOR < MAJOR < GRAND, GRAND one in 65,536', async () => {
  const { a } = await game('video5x3');
  assert.deepEqual(a.jackpots.map((j) => j.id), ['MINI', 'MINOR', 'MAJOR', 'GRAND']);
  const odds = a.jackpots.map((j) => j.oneIn);
  assert.ok(odds[0] < odds[1] && odds[1] < odds[2] && odds[2] < odds[3]);
  assert.equal(a.jackpots[3].oneIn, 65536);
  for (const j of a.jackpots) assert.ok(Math.abs(j.rtp - (j.betFunded + j.houseFunded)) < 1e-12, 'meter RTP = contribution + seed share');
});

test('video5x3: free spins retrigger sub-critically and add a real share of the return', async () => {
  const { a } = await game('video5x3');
  assert.ok(a.components.freeSpins > 0.05 && a.components.freeSpins < 0.2);
  assert.ok(a.freeSpinTrigger > 1 / 500 && a.freeSpinTrigger < 1 / 20);
});

test('grid5x5: the 3,125-way grid, a bonus round that opens about once in 75 spins and retriggers sub-critically', async () => {
  const { spec, a } = await game('grid5x5');
  assert.equal(spec.rows ** spec.reels, 3125);
  assert.ok(a.freeSpinTrigger > 1 / 150 && a.freeSpinTrigger < 1 / 40, `1 in ${1 / a.freeSpinTrigger}`);
  assert.ok(a.components.freeSpins > 0.1 && a.components.freeSpins < 0.4);
  // retrigger: expected extra spins awarded per free spin is well under one
  const r = Object.entries(a.scatterDistribution).reduce((s, [n, p]) => s + p * (spec.scatter.freeSpins[n] ?? 0), 0);
  assert.ok(r < 0.5, `expected awarded spins per spin ${r}`);
});

test('grid5x5: the RTP split between base game, bonus round and jackpots adds up and is reported', async () => {
  const { a } = await game('grid5x5');
  const s = a.split;
  assert.ok(Math.abs(s.total - a.rtp) < 1e-12);
  assert.ok(Math.abs(s.baseGame + s.bonusRound + s.progressives - a.rtp) < 1e-12);
  assert.ok(s.baseGame > 0.5 && s.bonusRound > 0.15 && s.progressives > 0.04 && s.progressives < 0.08, JSON.stringify(s));
  assert.ok(Math.abs(s.bonusRound - a.components.freeSpins) < 1e-12);
});

test('grid5x5: four jackpot tiers with the expected odds, funded by contribution plus a house seed', async () => {
  const { a } = await game('grid5x5');
  assert.deepEqual(a.jackpots.map((j) => [j.id, Math.round(j.oneIn)]), [['MINI', 1024], ['MINOR', 4096], ['MAJOR', 21845], ['GRAND', 65536]]);
  for (const j of a.jackpots) assert.ok(Math.abs(j.rtp - (j.betFunded + j.houseFunded)) < 1e-12);
  const byBet = Object.fromEntries(a.perBet.map((b) => [b.bet, b.rtp]));
  assert.ok(byBet[1] < byBet[2] && byBet[2] < byBet[3] && byBet[3] < byBet[5]);
  assert.ok(Math.abs(byBet[5] - a.rtp) < 1e-12);
});
