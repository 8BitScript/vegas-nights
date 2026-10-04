// The odds are the engine's; the game must play them. These tests recompute
// the return of the committed table from first principles — every one of the
// 64^3 reel outcomes through this repo's own payline evaluator, the same
// rules the 6502 code implements — and hold it to the number tools/slotmath
// printed in the table's header. They need no emulator, so CI runs them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTable, ROOT } from './support/table.mjs';
import { enumerate, play, windowAt, lcg, SEED } from './support/reference.mjs';

const table = loadTable();
const c = table.consts;
const a = table.arrays;

test('the table is well formed: power-of-two strips, symbols and lines in range', () => {
  assert.equal(c.STOPS & (c.STOPS - 1), 0, 'STOPS is a power of two, so one random byte maps to a stop with no bias');
  assert.equal(c.STOP_MASK, c.STOPS - 1);
  assert.equal(a.STRIPS.length, c.REELS * c.STOPS);
  assert.ok(a.STRIPS.every((s) => s < c.SYMBOL_COUNT));
  assert.equal(a.LINES.length, c.LINE_COUNT * c.REELS);
  assert.ok(a.LINES.every((row) => row < c.ROWS));
  assert.equal(a.PAYS.length, c.PAY_SYMBOLS * c.PAY_WIDTH);
  assert.ok(c.PAY_WIDTH > c.REELS);
  assert.equal(c.ROWS, 3);
  assert.equal(c.REELS, 3);
});

test('the three paylines are the middle row and both diagonals', () => {
  assert.deepEqual(a.LINES, [1, 1, 1, 0, 1, 2, 2, 1, 0]);
});

test('every symbol the strips use has a glyph in the game', () => {
  const game = readFileSync(join(ROOT, 'src', 'labs', 'slot3x3', 'game.8bs'), 'utf8');
  for (const name of ['GLYPH_LEFT', 'GLYPH_MID', 'GLYPH_RIGHT']) {
    const m = new RegExp(`const ${name}: array<utinyint, (\\d+)>`).exec(game);
    assert.ok(m, `${name} exists in game.8bs`);
    assert.equal(Number(m[1]), c.SYMBOL_COUNT, `${name} has one entry per symbol`);
  }
});

test('enumerating every outcome reproduces the engine\'s exact return', () => {
  const r = enumerate(table);
  assert.ok(table.headerRtp !== null, 'the generated header states an exact RTP');
  assert.ok(Math.abs(r.rtp - table.headerRtp) < 5e-5,
    `recomputed ${(r.rtp * 100).toFixed(4)}% vs header ${(table.headerRtp * 100).toFixed(4)}%`);
  assert.ok(r.rtp > 0.9 && r.rtp < 1, 'a house edge of a few percent');
});

test('the hit frequency matches the engine\'s', () => {
  const r = enumerate(table);
  // The header's figure may or may not count a jackpot-only win; accept either.
  const withJackpot = r.hitFrequency + r.jackpotOdds * (1 - r.hitFrequency);
  const near = (x) => Math.abs(x - table.headerHit) < 1e-4;
  assert.ok(near(r.hitFrequency) || near(withJackpot),
    `base ${(r.hitFrequency * 100).toFixed(3)}% / with jackpot ${(withJackpot * 100).toFixed(3)}% vs header ${(table.headerHit * 100).toFixed(3)}%`);
});

test('a reel window is three consecutive strip symbols, wrapping at the end', () => {
  const w = windowAt(table, [63, 0, 62]);
  assert.equal(w[0][0], a.STRIPS[63]);
  assert.equal(w[1][0], a.STRIPS[0]);
  assert.equal(w[2][0], a.STRIPS[1]);
  assert.equal(w[0][2], a.STRIPS[2 * c.STOPS + 62]);
  assert.equal(w[2][2], a.STRIPS[2 * c.STOPS + 0]);
});

test('the oracle spins deterministically from the seed and keeps its books', () => {
  const first = play(table, 3);
  const again = play(table, 3);
  assert.deepEqual(first, again);
  let credits = 2000;
  for (const spin of first) {
    credits = credits - c.BET_CREDITS + spin.win;
    assert.equal(spin.credits, credits);
  }
  // The first draw is the seed's first LCG byte, masked.
  assert.equal(first[0].stops[0], lcg(SEED).byte & c.STOP_MASK);
});

test('masked stops are exactly uniform over the generator\'s whole period', () => {
  // The high byte of the 16-bit LCG visits every value exactly 256 times per
  // period, so `byte & STOP_MASK` hits each of the STOPS stops equally often:
  // the draw adds no bias of its own to the engine's exact odds.
  const counts = new Array(c.STOPS).fill(0);
  let state = SEED;
  for (let i = 0; i < 65536; i += 1) {
    const x = lcg(state);
    state = x.state;
    counts[x.byte & c.STOP_MASK] += 1;
  }
  assert.ok(counts.every((n) => n === 65536 / c.STOPS), 'every stop is drawn equally often');
});
