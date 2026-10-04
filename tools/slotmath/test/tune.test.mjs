// The tuner: it converges, deterministically, by integer moves only, never breaks the
// paytable's ordering, and says so plainly when a target is out of reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, tune, ordered } from '../src/tune.mjs';
import { fastRtp, analyze } from '../src/analyze.mjs';
import { loadRaw, listSpecs } from '../src/index.mjs';

test('every shipped game with a tune block lands inside its tolerance', async () => {
  for (const id of listSpecs()) {
    const raw = await loadRaw(id);
    if (!raw.tune) continue;
    const spec = resolve(raw);
    assert.ok(Math.abs(spec.tuning.rtp - raw.tune.target) <= raw.tune.tolerance, id);
    assert.ok(Math.abs(fastRtp(spec).rtp - spec.tuning.rtp) < 1e-12, `${id}: the recorded RTP is the exact one`);
  }
});

test('the search is deterministic, and its record replays to the same paytable', async () => {
  const raw = await loadRaw('classic3x3');
  const a = tune(raw);
  const b = tune(raw);
  assert.deepEqual(a.steps, b.steps);
  assert.deepEqual(a.raw.pays, b.raw.pays);
  // Replaying the recorded moves from the start reproduces the result: the record is the search.
  const replay = structuredClone(raw);
  for (const s of a.steps) {
    const m = /^pay (\w+)x(\d+) ([+-])(\d+)$/.exec(s.move);
    if (!m) continue;
    replay.pays[m[1]][Number(m[2])] += (m[3] === '+' ? 1 : -1) * Number(m[4]);
  }
  assert.deepEqual(replay.pays, a.raw.pays);
});

test('only integer moves, within range, and never past a pay that outranks it', async () => {
  for (const id of ['classic3x3', 'video5x3', 'grid5x5']) {
    const raw = await loadRaw(id);
    const r = tune(raw);
    for (const table of Object.values(r.raw.pays)) {
      for (const v of Object.values(table)) assert.ok(Number.isInteger(v) && v >= 0 && v <= 65535, id);
    }
    assert.ok(ordered(r.raw), `${id}: ordering holds`);
    for (const s of r.steps) assert.ok(s.after !== s.before);
  }
});

test('ordered() rejects a longer run paying less, and a lower symbol outpaying a higher one', () => {
  const sym = [{ id: 'HI', kind: 'regular' }, { id: 'LO', kind: 'regular' }];
  assert.equal(ordered({ symbols: sym, pays: { HI: { 3: 10, 4: 40 }, LO: { 3: 5 } } }), true);
  assert.equal(ordered({ symbols: sym, pays: { HI: { 3: 10, 4: 5 }, LO: { 3: 5 } } }), false, 'a longer run paid less');
  assert.equal(ordered({ symbols: sym, pays: { HI: { 3: 10 }, LO: { 3: 11 } } }), false, 'low outpays high');
  assert.equal(ordered({ symbols: sym, pays: { HI: { 4: 10 }, LO: { 3: 99 } } }), true, 'different run lengths are not compared');
});

test('a target out of reach fails loudly instead of shipping a wrong game', async () => {
  const raw = await loadRaw('classic3x3');
  raw.tune = { ...raw.tune, levers: [], target: 0.5 }; // nothing allowed to move
  assert.throws(() => resolve(raw), /tuner stopped at RTP [\d.]+%.*target 50\.00%.*after 0 steps/);
  const zero = await loadRaw('classic3x3');
  zero.tune = { ...zero.tune, tolerance: 1e-12, target: 0.94 + 1e-6 };
  assert.throws(() => resolve(zero), /tuner stopped/);
});

test('a game already inside tolerance takes no moves', async () => {
  const spec = resolve(await loadRaw('classic3x3'));
  const raw = await loadRaw('classic3x3');
  const tuned = tune(raw);
  const again = structuredClone(raw);
  again.pays = tuned.raw.pays;
  again.counts = tuned.raw.counts;
  assert.equal(tune(again).steps.length, 0);
  assert.ok(analyze(spec).rtp > 0.9395);
});
