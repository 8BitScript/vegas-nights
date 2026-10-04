// Spec validation and strip arrangement: bad games are refused with a reason, and a
// strip is always exactly the counts the spec asked for, laid out the same way every time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, normalize } from '../src/spec.mjs';
import classic3 from '../specs/classic3x3.mjs';

const clone = () => structuredClone(classic3);

test('stops must be a power of two up to 256, so one masked byte is unbiased', () => {
  for (const bad of [0, 3, 12, 63, 100, 512]) {
    assert.throws(() => normalize({ ...clone(), stops: bad }), /power of two/, `stops ${bad}`);
  }
  for (const good of [2, 8, 64, 128, 256]) {
    const c = clone();
    c.stops = good;
    c.counts = c.counts.map(() => ({ SEVEN: 1, BLANK: good - 1 }));
    c.pays = { SEVEN: { 3: 100 } };
    c.progressives = [];
    assert.doesNotThrow(() => normalize(c), `stops ${good}`);
  }
});

test('counts must add up to the stops on every reel, and name real symbols', () => {
  const short = clone();
  short.counts[1] = { SEVEN: 2, BLANK: 61 };
  assert.throws(() => normalize(short), /reel 2: counts add to 63, not 64/);
  const unknown = clone();
  unknown.counts[0] = { ...unknown.counts[0], NOPE: 0 };
  assert.throws(() => normalize(unknown), /unknown symbol NOPE/);
});

test('scatter and bonus symbols must follow the paying symbols', () => {
  const raw = {
    id: 'bad', mode: 'line', reels: 1, rows: 1, stops: 2, betCredits: 1, lines: [[0]],
    symbols: [{ id: 'SCAT', kind: 'scatter' }, { id: 'AAA', kind: 'regular' }], counts: [{ SCAT: 1, AAA: 1 }], pays: {},
  };
  assert.throws(() => normalize(raw), /must come before scatter and bonus/);
});

test('pays must be integers in range and name paying symbols', () => {
  const c = clone();
  c.pays.SEVEN[3] = 1.5;
  assert.throws(() => normalize(c), /integer 0\.\.65535/);
  const d = clone();
  d.pays.SEVEN[3] = 70000;
  assert.throws(() => normalize(d), /integer 0\.\.65535/);
  const e = clone();
  e.pays.GHOST = { 3: 1 };
  assert.throws(() => normalize(e), /GHOST must be a regular or wild symbol/);
});

test('wheel weights must be a power of two; jackpot names must exist', () => {
  const bad = {
    id: 'w', mode: 'line', reels: 1, rows: 1, stops: 2, betCredits: 1, lines: [[0]],
    symbols: [{ id: 'AAA', kind: 'regular' }, { id: 'BONUS', kind: 'bonus' }], counts: [{ AAA: 1, BONUS: 1 }], pays: {},
    bonus: { symbol: 'BONUS', minCount: 1, wheel: [{ weight: 3, credits: 5 }] },
  };
  assert.throws(() => normalize(bad), /wheel weights add to 3/);
  const ghost = structuredClone(bad);
  ghost.bonus.wheel = [{ weight: 2, jackpot: 'NOPE' }];
  assert.throws(() => normalize(ghost), /names jackpot NOPE/);
});

test('per-spin jackpots that share a draw may not overlap', () => {
  const raw = {
    id: 'j', mode: 'line', reels: 1, rows: 1, stops: 2, betCredits: 1, lines: [[0]],
    symbols: [{ id: 'AAA', kind: 'regular' }], counts: [{ AAA: 2 }], pays: {},
    progressives: [
      { id: 'A', seed: 1, fixed: true, via: 'spin', prob: { num: 40000, den: 65536 } },
      { id: 'B', seed: 1, fixed: true, via: 'spin', prob: { num: 40000, den: 65536 } },
    ],
  };
  assert.throws(() => normalize(raw), /ranges overlap/);
});

test('arrange: exactly the requested counts, deterministic, and no needless neighbours', () => {
  const counts = { A: 5, B: 9, C: 2, D: 16 };
  const a = arrange(counts, ['A', 'B', 'C', 'D'], 32, 7);
  const b = arrange(counts, ['A', 'B', 'C', 'D'], 32, 7);
  assert.deepEqual(a, b, 'same inputs, same strip');
  for (const [k, n] of Object.entries(counts)) assert.equal(a.filter((x) => x === k).length, n);
  assert.notDeepEqual(a, arrange(counts, ['A', 'B', 'C', 'D'], 32, 8), 'the seed changes the order');
  let adjacent = 0;
  for (let i = 0; i < 32; i += 1) if (a[i] === a[(i + 1) % 32]) adjacent += 1;
  assert.ok(adjacent <= 4, `${adjacent} equal neighbours`);
  assert.throws(() => arrange({ A: 3 }, ['A'], 8, 1), /counts add to 3, not 8/);
});

test('an unbiased draw: a masked byte lands on every stop exactly 256/stops times', () => {
  for (const stops of [32, 64, 128]) {
    const hist = new Array(stops).fill(0);
    for (let b = 0; b < 256; b += 1) hist[b & (stops - 1)] += 1;
    assert.ok(hist.every((n) => n === 256 / stops), `stops ${stops}`);
  }
  // ...and the modulo the language's random.range uses is not, for 37 roulette pockets.
  const hist = new Array(37).fill(0);
  for (let b = 0; b < 256; b += 1) hist[b % 37] += 1;
  assert.deepEqual([...new Set(hist)].sort(), [6, 7], '34 pockets come up 7 times in 256, 3 pockets only 6');
});
