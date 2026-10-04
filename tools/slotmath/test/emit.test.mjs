// The emitter: committed outputs are never stale, the tables mean what the spec says, the
// random-byte budget is right, and the emitted modules really compile and build with 8BitScript.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { build, listSpecs, REPO_ROOT } from '../src/index.mjs';
import { drawPlan } from '../src/emit.mjs';
import { tinySpec } from './naive.mjs';

const built = new Map();
async function get(id) {
  if (!built.has(id)) built.set(id, await build(id));
  return built.get(id);
}

/** Pull `export const NAME: type = value;` and `export const NAME: array<type, n> = [..];` out of emitted text. */
function parseModule(text) {
  const consts = {};
  const arrays = {};
  for (const m of text.matchAll(/export const (\w+): (\w+) = (\d+);/g)) consts[m[1]] = Number(m[3]);
  for (const m of text.matchAll(/export const (\w+): array<(\w+), (\d+)> = \[([^\]]*)\];/g)) {
    arrays[m[1]] = { type: m[2], length: Number(m[3]), values: m[4].split(',').map((v) => Number(v.trim())) };
  }
  return { consts, arrays };
}

test('committed outputs are fresh: regenerating every game reproduces the files byte for byte', async () => {
  for (const id of listSpecs()) {
    const r = await get(id);
    const table = join(REPO_ROOT, 'src', 'generated', `${id}.8bs`);
    const par = join(REPO_ROOT, 'docs', 'par', `${id}.md`);
    assert.ok(existsSync(table), `${table} is committed`);
    assert.equal(readFileSync(table, 'utf8'), r.emitted.text, `${id}.8bs is stale - run "node tools/slotmath/bin/slotmath.mjs generate"`);
    assert.equal(readFileSync(par, 'utf8'), r.markdown, `${id}.md is stale`);
  }
});

test('the emitted tables mean what the spec says', async () => {
  for (const id of listSpecs()) {
    const { spec, emitted } = await get(id);
    const { consts, arrays } = parseModule(emitted.text);
    assert.equal(consts.STOPS, spec.stops);
    assert.equal(consts.STOP_MASK, spec.stops - 1);
    assert.equal(consts.STOPS & consts.STOP_MASK, 0, 'STOPS is a power of two');
    assert.equal(arrays.STRIPS.length, spec.reels * spec.stops);
    assert.deepEqual(arrays.STRIPS.values, spec.strips.flat());
    assert.ok(arrays.STRIPS.values.every((v) => v >= 0 && v < spec.symbols.length));
    // PAYS[symbol * PAY_WIDTH + n] is the spec's pay
    for (const [idx, table] of Object.entries(spec.paysByIndex)) {
      for (const [n, credits] of Object.entries(table)) {
        const got = arrays.PAYS.values[Number(idx) * consts.PAY_WIDTH + (spec.mode === 'cluster' ? Number(n) : Number(n))];
        assert.equal(got, credits, `${id}: pay ${spec.symbols[idx].id} x${n}`);
      }
    }
    assert.equal(arrays.PAYS.length, spec.payingCount * consts.PAY_WIDTH);
    for (const s of spec.symbols) assert.equal(consts[`SYM_${s.id}`], s.index);
    if (spec.mode === 'line') {
      assert.equal(arrays.LINES.length, spec.lines.length * spec.reels);
      assert.equal(consts.LINE_COUNT, spec.lines.length);
    }
    // Every symbol count on a reel survives the round trip.
    for (let r = 0; r < spec.reels; r += 1) {
      for (const s of spec.symbols) {
        const want = spec.strips[r].filter((c) => c === s.index).length;
        const got = arrays.STRIPS.values.slice(r * spec.stops, (r + 1) * spec.stops).filter((c) => c === s.index).length;
        assert.equal(got, want);
      }
    }
  }
});

test('video5x3 emits its wheel, jackpots and free-spin tables consistently', async () => {
  const { spec, emitted } = await get('video5x3');
  const { consts, arrays } = parseModule(emitted.text);
  assert.equal(arrays.WHEEL_CREDITS.length, 128);
  assert.equal(consts.WHEEL_MASK, 127);
  assert.equal(arrays.WHEEL_JACKPOT.values.filter((v) => v === 1).length, 8, 'MINI is 8 of 128 segments');
  assert.equal(arrays.WHEEL_JACKPOT.values.filter((v) => v === 2).length, 2, 'MINOR is 2 of 128');
  assert.equal(arrays.WHEEL_CREDITS.values.filter((v) => v === 0).length, 10, 'jackpot segments carry no credits');
  assert.deepEqual(arrays.JACKPOT_SEED.values, [2000, 10000, 50000, 65000]);
  assert.deepEqual(arrays.JACKPOT_MIN_BET.values, [1, 2, 3, 5]);
  assert.deepEqual(arrays.JACKPOT_RANGE_FROM.values, [0, 0, 0, 3], 'GRAND takes the draw values after MAJOR\'s');
  assert.deepEqual(arrays.JACKPOT_RANGE_TO.values, [0, 0, 3, 4]);
  assert.equal(consts.JACKPOT_DRAW_BYTES, 2);
  assert.equal(consts.JACKPOT_DRAW_MASK, 65535);
  // meters are 8.8 fixed point credits per base-bet spin: 0.4% of 100 credits = 0.4 -> 102/256
  assert.equal(arrays.JACKPOT_CONTRIB_Q8.values[0], Math.round(0.4 * 256));
  assert.deepEqual(arrays.FREE_SPIN_AWARD.values.slice(0, 6), [0, 0, 0, 10, 15, 25]);
  assert.equal(spec.freeSpins.cap, consts.FREE_SPIN_CAP);
});

test('the draw plan: reels first, then the jackpot draw, then the wheel only when it opens', async () => {
  const classic = drawPlan((await get('classic3x3')).spec);
  assert.equal(classic.perBaseSpin, 3 + 2, '3 reel bytes + a 2-byte 1-in-512 jackpot draw');
  assert.equal(classic.perFreeSpin, 3);
  assert.deepEqual(classic.items.map((i) => i.name), ['reel 1', 'reel 2', 'reel 3', 'JACKPOT draw']);
  const video = drawPlan((await get('video5x3')).spec);
  assert.equal(video.perBaseSpin, 5 + 2, '5 reels + one shared 16-bit mystery draw');
  assert.equal(video.maxPerBaseSpin, 8, '+1 for the wheel');
  assert.equal(video.conditional[0].when, 'bonus symbols >= 3');
  const grid = drawPlan((await get('grid5x5')).spec);
  assert.equal(grid.perBaseSpin, 5 + 2, '5 reels + one shared 16-bit mystery draw for the four tiers');
  assert.equal(grid.maxPerBaseSpin, 7, 'no wheel: free spins are the bonus');
  assert.deepEqual(grid.items.at(-1).ranges.map((r) => [r.id, r.from, r.to]), [['MINI', 0, 64], ['MINOR', 64, 80], ['MAJOR', 80, 83], ['GRAND', 83, 84]]);
  // every reel byte is masked to the stop count, so the stop is unbiased
  assert.ok(classic.items[0].use.includes('& 63'));
  assert.ok(video.items[0].use.includes('& 31'));
});

test('unrelated per-spin jackpots with different draws are refused, not silently merged', () => {
  const spec = tinySpec({
    bonus: undefined, scatter: undefined, freeSpins: undefined,
    progressives: [
      { id: 'A', seed: 1, fixed: true, via: 'spin', prob: { num: 1, den: 256 } },
      { id: 'B', seed: 1, fixed: true, via: 'spin', prob: { num: 1, den: 1024 } },
    ],
  });
  assert.throws(() => drawPlan(spec), /one per-spin jackpot draw/);
});

// ---- the real compiler -------------------------------------------------------------------
// The emitted modules must compile with 8BitScript itself. These run when a CLI is reachable:
// $EIGHTBS_CLI, or a sibling checkout at ../8bitscript, or `8bs` on the PATH.
function findCli() {
  const candidates = [process.env.EIGHTBS_CLI, join(REPO_ROOT, '..', '8bitscript', 'packages', 'cli', 'bin', '8bs.mjs')].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return { cmd: process.execPath, args: [c], checkout: join(c, '..', '..', '..', '..') };
  const which = spawnSync('8bs', ['--version'], { encoding: 'utf8' });
  if (which.status === 0) return { cmd: '8bs', args: [], checkout: null };
  return null;
}
const cli = findCli();

test('every emitted module passes `8bs check`', { skip: cli ? false : 'no 8BitScript CLI found (set EIGHTBS_CLI)' }, () => {
  for (const id of listSpecs()) {
    const file = join(REPO_ROOT, 'src', 'generated', `${id}.8bs`);
    const r = spawnSync(cli.cmd, [...cli.args, 'check', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${id}: ${r.stdout}${r.stderr}`);
  }
});

test('a program indexing the tables builds for pet, vic20, c64, cx16 and web', { skip: cli ? false : 'no 8BitScript CLI found (set EIGHTBS_CLI)' }, () => {
  const probe = join(REPO_ROOT, 'tools', 'slotmath', 'test', 'fixtures', 'probe-classic3x3.8bs');
  const out = mkdtempSync(join(tmpdir(), 'slotmath-'));
  try {
    for (const target of ['pet', 'vic20', 'c64', 'cx16', 'web']) {
      const args = [...cli.args, 'build', '--target', target, ...(cli.checkout ? ['--checkout', cli.checkout] : []), probe];
      const r = spawnSync(cli.cmd, args, { encoding: 'utf8', cwd: out });
      assert.equal(r.status, 0, `${target}: ${r.stdout}${r.stderr}`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
