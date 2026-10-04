// The Monte Carlo estimator, validated where the answer is known: an 8-stop copy of the
// cluster game, small enough to enumerate exactly. The estimate must land on the exact value
// inside its own reported interval, be reproducible from its seed, and move with the seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.mjs';
import { normalize } from '../src/spec.mjs';
import { loadRaw } from '../src/index.mjs';

async function small() {
  const raw = await loadRaw('cluster5x5');
  // every fourth stop of every strip -> 8 stops, 32,768 outcomes
  const probe = normalize(raw);
  return normalize({
    ...raw, id: 'cluster8', stops: 8, counts: undefined,
    strips: probe.strips.map((strip) => strip.filter((_, i) => i % 4 === 0).map((c) => probe.symbols[c].id)),
  });
}

test('the estimate agrees with exact enumeration inside its own 95% interval', async () => {
  const spec = await small();
  const exact = analyze(spec, { method: 'exact' });
  const mc = analyze(spec, { method: 'mc', samples: 1_600_000, seed: 7, batches: 20 });
  assert.equal(exact.outcomes, 32768);
  assert.ok(Math.abs(mc.rtp - exact.rtp) <= 1.5 * mc.ci.half, `${mc.rtp} vs exact ${exact.rtp} +/- ${mc.ci.half}`);
  // A second, independent seed must also cover the truth: one lucky run is not validation.
  const again = analyze(spec, { method: 'mc', samples: 1_600_000, seed: 99, batches: 20 });
  assert.ok(Math.abs(again.rtp - exact.rtp) <= 1.5 * again.ci.half, `${again.rtp} vs exact ${exact.rtp} +/- ${again.ci.half}`);
  // This 8-stop copy is far more volatile than the shipped game (same big pays, fewer stops).
  assert.ok(mc.ci.half > 0 && mc.ci.half < 0.1, `interval ${mc.ci.half}`);
  assert.ok(Math.abs(mc.hitFrequency - exact.hitFrequency) < 0.01);
  assert.ok(Math.abs(mc.sigma - exact.sigma) / exact.sigma < 0.08, `sigma ${mc.sigma} vs ${exact.sigma}`);
  assert.equal(mc.method, 'mc');
  assert.equal(exact.method, 'exact');
});

test('a fixed seed reproduces the estimate exactly; another seed does not', async () => {
  const spec = await small();
  const a = analyze(spec, { method: 'mc', samples: 200_000, seed: 1, batches: 10 });
  const b = analyze(spec, { method: 'mc', samples: 200_000, seed: 1, batches: 10 });
  const c = analyze(spec, { method: 'mc', samples: 200_000, seed: 2, batches: 10 });
  assert.equal(a.rtp, b.rtp);
  assert.equal(a.ci.half, b.ci.half);
  assert.notEqual(a.rtp, c.rtp);
});

test('more samples shrink the interval, roughly with the square root', async () => {
  const spec = await small();
  const few = analyze(spec, { method: 'mc', samples: 100_000, seed: 3, batches: 20 });
  const many = analyze(spec, { method: 'mc', samples: 1_600_000, seed: 3, batches: 20 });
  assert.ok(many.ci.half < few.ci.half * 0.5, `${many.ci.half} vs ${few.ci.half}`);
});

test('enumeration is refused on a game too big to walk, and sampling on a mode with an exact route', async () => {
  const big = normalize(await loadRaw('cluster5x5'));
  assert.throws(() => analyze(big, { method: 'exact' }), /too many to enumerate/);
  const ways = normalize(await loadRaw('grid5x5'));
  assert.throws(() => analyze(ways, { method: 'mc', samples: 1000 }), /only for cluster mode/);
});
