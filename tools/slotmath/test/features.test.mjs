// Free spins, the wheel and the jackpot meters against independent derivations: a full
// probability tree for sessions, a truncated series for a meter, hand arithmetic for the wheel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionMoments, expectedSpins, jackpotMoments, wheelMoments, wheelSegmentProbability } from '../src/features.mjs';
import { tinySpec, sessionTree } from './naive.mjs';

const moments = (dist) => {
  let m1 = 0;
  let m2 = 0;
  for (const [v, p] of dist) { m1 += p * v; m2 += p * v * v; }
  return { m1, m2 };
};

const ITEMS = [
  { x: 0, a: 0, p: 0.55 }, { x: 4, a: 0, p: 0.25 }, { x: 10, a: 0, p: 0.1 }, { x: 6, a: 2, p: 0.07 }, { x: 20, a: 3, p: 0.03 },
];

test('session moments equal a full probability tree, with retriggers and the cap biting', () => {
  for (const cap of [3, 6, 9]) {
    const got = sessionMoments(ITEMS, cap);
    for (let n = 0; n <= cap; n += 1) {
      const tree = moments(sessionTree(ITEMS, cap, n, n));
      assert.ok(Math.abs(got.m1[n] - tree.m1) < 1e-9, `cap ${cap} n ${n}: mean ${got.m1[n]} vs ${tree.m1}`);
      assert.ok(Math.abs(got.m2[n] - tree.m2) < 1e-8, `cap ${cap} n ${n}: second moment`);
    }
  }
});

test('without retrigger a session is n independent spins', () => {
  const items = ITEMS.map((i) => ({ ...i, a: 0 }));
  const ex = items.reduce((s, i) => s + i.p * i.x, 0);
  const ex2 = items.reduce((s, i) => s + i.p * i.x * i.x, 0);
  const got = sessionMoments(items, 10);
  for (const n of [1, 5, 10]) {
    assert.ok(Math.abs(got.m1[n] - n * ex) < 1e-9);
    assert.ok(Math.abs(got.m2[n] - (n * ex2 + n * (n - 1) * ex * ex)) < 1e-8);
  }
});

test('with a high cap the expected session length is the geometric closed form n / (1 - r)', () => {
  const award = new Map([[0, 0.9], [1, 0.1]]); // r = 0.1 extra spins per spin
  const EN = expectedSpins(award, 250);
  for (const n of [1, 5, 10]) assert.ok(Math.abs(EN[n] - n / 0.9) < 1e-6, `n ${n}: ${EN[n]}`);
});

test('the cap is respected: a supercritical session ends at exactly cap spins', () => {
  const award = new Map([[5, 1]]); // every spin awards 5 more: runs until the cap stops it
  const EN = expectedSpins(award, 20);
  assert.equal(EN[3], 20);
  assert.equal(EN[20], 20);
});

test('a jackpot meter\'s mean and second moment match the geometric series', () => {
  const level = { seed: 500, contribution: { num: 1, den: 100 }, fixed: false };
  const bet = 100;
  const p = 0.002;
  const m = jackpotMoments(level, p, bet);
  let e1 = 0;
  let e2 = 0;
  for (let g = 1; g < 60000; g += 1) {
    const w = p * (1 - p) ** (g - 1);
    const j = 500 + 1 * g; // contribution 1% of 100 credits = 1 credit per spin
    e1 += w * j;
    e2 += w * j * j;
  }
  assert.ok(Math.abs(m.m1 - e1) < 1e-3, `${m.m1} vs ${e1}`);
  assert.ok(Math.abs(m.m2 - e2) / e2 < 1e-6, `${m.m2} vs ${e2}`);
  assert.equal(m.meterPerSpin, 1);
});

test('a fixed-odds jackpot always pays its seed, and a meter funds itself plus the seed', () => {
  assert.deepEqual(jackpotMoments({ seed: 80, fixed: true }, 0.01, 100), { m1: 80, m2: 6400, meterPerSpin: 0 });
  // RTP of a meter = p * mean payout = p * seed + contribution per spin.
  const level = { seed: 1000, contribution: { num: 5, den: 1000 }, fixed: false };
  const p = 0.0004;
  const m = jackpotMoments(level, p, 200);
  assert.ok(Math.abs(p * m.m1 - (p * 1000 + 1)) < 1e-12);
});

test('the wheel: segment probabilities, fallbacks for ineligible jackpots, and moments', () => {
  const spec = tinySpec();
  assert.equal(wheelSegmentProbability(spec, 'TOP'), 1 / 8);
  const jackpots = { TOP: { m1: 600, m2: 400000 } };
  const open = wheelMoments(spec, jackpots, new Set(['TOP']));
  // (4*30 + 3*70 + 1*600) / 8
  assert.ok(Math.abs(open.m1 - (4 * 30 + 3 * 70 + 600) / 8) < 1e-12);
  assert.ok(Math.abs(open.m2 - (4 * 900 + 3 * 4900 + 400000) / 8) < 1e-9);
  const shut = wheelMoments(spec, jackpots, new Set());
  assert.ok(Math.abs(shut.m1 - (4 * 30 + 3 * 70 + 50) / 8) < 1e-12, 'ineligible segment pays its fallback');
});
