// The three pay modes against the naive evaluator, exhaustively on tiny games. Every
// figure the engine reports about the base spin - the mean, the variance, the hit count,
// the whole joint distribution of (win, scatters, bonus symbols) - must equal the brute-force
// answer exactly, for line, ways and cluster pays, with and without wilds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, fastRtp } from '../src/analyze.mjs';
import { reelWindows, suffixFeatures } from '../src/windows.mjs';
import * as line from '../src/modes/line.mjs';
import * as ways from '../src/modes/ways.mjs';
import * as cluster from '../src/modes/cluster.mjs';
import { bruteForce, tinySpec } from './naive.mjs';

function jointOf(mode, spec) {
  const windows = reelWindows(spec);
  const suffix = suffixFeatures(windows);
  const joint = new Map();
  mode.enumerate(spec, windows, suffix, (win, sc, bn, w) => {
    const k = `${win}|${sc}|${bn}`;
    joint.set(k, (joint.get(k) ?? 0) + w);
  });
  return joint;
}

function sameJoint(a, b) {
  assert.deepEqual([...a].sort(), [...b].sort());
}

test('line mode: the engine joint distribution equals brute force, wilds and all', () => {
  const spec = tinySpec();
  const brute = bruteForce(spec);
  assert.equal(brute.count, 8 ** 3);
  sameJoint(jointOf(line, spec), brute.joint);
});

test('line mode: the closed-form mean equals brute force exactly', () => {
  const spec = tinySpec();
  const brute = bruteForce(spec);
  let regular = 0;
  for (const [k, w] of brute.joint) regular += Number(k.split('|')[0]) * w;
  assert.equal(line.expectedPay(spec), regular);
});

test('line mode without a wild, and a wild-only line pays its own table', () => {
  const noWild = tinySpec({
    symbols: tinySpec().symbols.filter((s) => s.kind !== 'wild').map(({ id, kind }) => ({ id, kind })),
    counts: tinySpec().counts.map(({ WILD, ...rest }) => ({ ...rest, AAA: (rest.AAA ?? 0) + (WILD ?? 0) })),
    pays: { AAA: { 2: 5, 3: 40 }, BBB: { 2: 3, 3: 25 }, CCC: { 3: 10 } },
  });
  sameJoint(jointOf(line, noWild), bruteForce(noWild).joint);
  const wildHeavy = tinySpec({
    counts: [
      { AAA: 2, BBB: 1, CCC: 1, WILD: 3, SCAT: 1 },
      { AAA: 1, BBB: 2, CCC: 1, WILD: 3, BONUS: 1 },
      { AAA: 2, BBB: 1, CCC: 1, WILD: 3, SCAT: 1 },
    ],
  });
  sameJoint(jointOf(line, wildHeavy), bruteForce(wildHeavy).joint);
});

test('ways mode: joint distribution and closed-form mean equal brute force', () => {
  for (const rows of [1, 2, 3]) {
    const spec = tinySpec({ mode: 'ways', rows, lines: undefined });
    const brute = bruteForce(spec);
    sameJoint(jointOf(ways, spec), brute.joint);
    let regular = 0;
    for (const [k, w] of brute.joint) regular += Number(k.split('|')[0]) * w;
    assert.equal(ways.expectedPay(spec), regular, `rows=${rows}`);
  }
});

test('cluster mode: enumeration equals the union-find reference, wilds joining groups', () => {
  const spec = tinySpec({
    mode: 'cluster', rows: 3, stops: 8, cluster: { min: 3 },
    pays: { AAA: { 3: 5, 5: 30 }, BBB: { 3: 4, 5: 20 }, CCC: { 3: 3, 4: 9 } },
  });
  sameJoint(jointOf(cluster, spec), bruteForce(spec).joint);
});

test('analyze() reports the brute-force mean, variance, hit count and maximum', () => {
  for (const mode of ['line', 'ways']) {
    const spec = tinySpec({ mode, lines: mode === 'line' ? [[0, 0, 0], [1, 1, 1], [0, 1, 0]] : undefined, scatter: undefined, freeSpins: undefined, bonus: undefined, progressives: [] });
    const brute = bruteForce(spec);
    const a = analyze(spec);
    const mean = brute.sumWin / brute.count;
    assert.ok(Math.abs(a.rtp * spec.betCredits - mean) < 1e-12, `${mode} mean`);
    const variance = brute.sumWin2 / brute.count - mean * mean;
    assert.ok(Math.abs(a.sigma ** 2 * spec.betCredits ** 2 - variance) < 1e-9, `${mode} variance`);
    assert.equal(a.hitFrequency, brute.hits / brute.count);
    assert.equal(a.maxImmediate * spec.betCredits, brute.maxWin);
    // The exact fraction is lines + scatter credits over (outcomes x bet): scatter pays are 0 here.
    assert.equal(a.exactBase.numerator, BigInt(brute.sumWin));
    assert.equal(a.exactBase.denominator, BigInt(brute.count) * BigInt(spec.betCredits));
  }
});

test('fastRtp (closed form) equals analyze (enumeration) with every feature on', () => {
  for (const mode of ['line', 'ways']) {
    const spec = tinySpec({ mode, lines: mode === 'line' ? [[0, 0, 0], [1, 1, 1], [0, 1, 0]] : undefined });
    const a = analyze(spec);
    const f = fastRtp(spec);
    assert.ok(Math.abs(a.rtp - f.rtp) < 1e-12, `${mode}: ${a.rtp} vs ${f.rtp}`);
  }
});

test('mutation: one more credit on a pay moves the mean by exactly that pay\'s hit frequency', () => {
  const base = tinySpec();
  const bumped = tinySpec({ pays: { AAA: { 2: 5, 3: 41 }, BBB: { 2: 3, 3: 25 }, CCC: { 3: 10 }, WILD: { 2: 8, 3: 90 } } });
  const expected = (bruteForce(bumped).sumWin - bruteForce(base).sumWin) / 512;
  assert.ok(expected > 0);
  const got = (analyze(bumped).components.lines - analyze(base).components.lines) * base.betCredits;
  assert.ok(Math.abs(got - expected) < 1e-12, `${got} vs ${expected}`);
});

// ---- cases the mutation run showed the first tests could not tell apart -------------------

test('a wild line that pays more than the symbol run behind it is paid as the wild line', () => {
  // WILD WILD AAA: the symbol run is 3 long and pays 5; two wilds pay 100 on their own. The
  // line pays the larger. (With the usual tables the symbol run always wins, hiding this.)
  const spec = tinySpec({
    pays: { AAA: { 2: 1, 3: 5 }, BBB: { 3: 4 }, CCC: { 3: 3 }, WILD: { 2: 100, 3: 700 } },
    counts: [
      { AAA: 1, BBB: 1, CCC: 1, WILD: 4, SCAT: 1 },
      { AAA: 1, BBB: 1, CCC: 1, WILD: 4, BONUS: 1 },
      { AAA: 3, BBB: 1, CCC: 1, WILD: 1, SCAT: 1, BONUS: 1 },
    ],
  });
  sameJoint(jointOf(line, spec), bruteForce(spec).joint);
  const brute = bruteForce(spec);
  let regular = 0;
  for (const [k, w] of brute.joint) regular += Number(k.split('|')[0]) * w;
  assert.equal(line.expectedPay(spec), regular);
  assert.ok(regular > 0);
});

test('two scatters stacked in one reel window both count', () => {
  const stacked = tinySpec({
    mode: 'ways', rows: 2, lines: undefined,
    counts: undefined,
    strips: [
      ['SCAT', 'SCAT', 'AAA', 'BBB', 'CCC', 'AAA', 'BBB', 'CCC'],
      ['AAA', 'SCAT', 'SCAT', 'BBB', 'CCC', 'AAA', 'WILD', 'CCC'],
      ['AAA', 'BBB', 'CCC', 'SCAT', 'SCAT', 'BONUS', 'WILD', 'BBB'],
    ],
  });
  sameJoint(jointOf(ways, stacked), bruteForce(stacked).joint);
  const windows = reelWindows(stacked);
  assert.ok(windows.some((reel) => reel.some((w) => w.sc === 2)), 'a window shows two scatters');
});
