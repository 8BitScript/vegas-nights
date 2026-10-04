// The full-feature mean and variance against an independent construction: for a discrete game
// (credits-only wheel, no meters) the whole distribution of one paid spin is built outcome by
// outcome - base win, plus a free-spin session tree, plus a wheel prize - and its moments taken
// directly. The engine, which combines moments by formula, must land on the same numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.mjs';
import { bruteForce, sessionTree, tinySpec } from './naive.mjs';

function independent(spec) {
  const brute = bruteForce(spec);
  const total = brute.count;
  const scPay = (sc) => spec.scatter.pays[sc] ?? 0;
  const award = (sc) => spec.scatter.freeSpins[sc] ?? 0;
  const items = new Map();
  for (const [k, w] of brute.joint) {
    const [win, sc] = k.split('|').map(Number);
    const x = spec.freeSpins.multiplier * (win + scPay(sc));
    const a = spec.freeSpins.retrigger ? award(sc) : 0;
    items.set(`${x}|${a}`, (items.get(`${x}|${a}`) ?? 0) + w / total);
  }
  const free = [...items].map(([k, p]) => { const [x, a] = k.split('|').map(Number); return { x, a, p }; });
  const wheel = new Map(spec.bonus.wheel.map((seg) => [seg.credits, 0]));
  for (const seg of spec.bonus.wheel) wheel.set(seg.credits, wheel.get(seg.credits) + seg.weight / spec.bonus.wheelTotal);
  const dist = new Map();
  const memo = new Map(); // (left, granted) -> distribution of the rest of the session; shared across outcomes
  const put = (v, p) => dist.set(v, (dist.get(v) ?? 0) + p);
  for (const [k, w] of brute.joint) {
    const [win, sc, bn] = k.split('|').map(Number);
    const x = win + scPay(sc);
    const n = award(sc);
    const S = n > 0 ? sessionTree(free, spec.freeSpins.cap, n, n, memo) : new Map([[0, 1]]);
    const B = bn >= spec.bonus.minCount ? wheel : new Map([[0, 1]]);
    for (const [s, ps] of S) for (const [b, pb] of B) put(x + s + b, (w / total) * ps * pb);
  }
  let m1 = 0;
  let m2 = 0;
  for (const [v, p] of dist) { m1 += p * v; m2 += p * v * v; }
  return { mean: m1, variance: m2 - m1 * m1, p: [...dist.values()].reduce((a, b) => a + b, 0) };
}

for (const mode of ['line', 'ways']) {
  test(`${mode}: mean and variance with free spins, retrigger and a wheel equal the full distribution`, () => {
    const spec = tinySpec({
      mode, lines: mode === 'line' ? [[0, 0, 0], [1, 1, 1], [0, 1, 0]] : undefined,
      bonus: { symbol: 'BONUS', minCount: 2, wheel: [{ weight: 4, credits: 30 }, { weight: 3, credits: 70 }, { weight: 1, credits: 200 }] },
      progressives: [],
      freeSpins: { multiplier: 2, retrigger: true, cap: 6 },
    });
    const want = independent(spec);
    assert.ok(Math.abs(want.p - 1) < 1e-9, 'the independent distribution sums to one');
    const a = analyze(spec);
    assert.ok(Math.abs(a.rtp * spec.betCredits - want.mean) < 1e-9, `mean ${a.rtp * spec.betCredits} vs ${want.mean}`);
    assert.ok(Math.abs(a.sigma ** 2 * spec.betCredits ** 2 - want.variance) < 1e-6, `variance ${a.sigma ** 2 * spec.betCredits ** 2} vs ${want.variance}`);
  });
}

test('no retrigger: the same equality holds, and the cap does not matter', () => {
  const spec = tinySpec({
    bonus: { symbol: 'BONUS', minCount: 2, wheel: [{ weight: 2, credits: 40 }, { weight: 2, credits: 10 }] },
    progressives: [],
    freeSpins: { multiplier: 3, retrigger: false, cap: 6 },
  });
  const want = independent(spec);
  const a = analyze(spec);
  assert.ok(Math.abs(a.rtp * spec.betCredits - want.mean) < 1e-9);
  assert.ok(Math.abs(a.sigma ** 2 * spec.betCredits ** 2 - want.variance) < 1e-6);
});
