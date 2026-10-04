// Turn a hand-written game spec into the validated, indexed form every other
// module reads. Nothing downstream re-checks the spec: if it gets past here it
// is internally consistent (power-of-two stops, strips that add up, pays that
// name real symbols).
import { isPow2, hashOf, mulberry32 } from './util.mjs';

export const MODES = ['line', 'ways', 'cluster'];
const KINDS = ['regular', 'wild', 'scatter', 'bonus'];

function fail(spec, message) {
  throw new Error(`spec ${spec?.id ?? '?'}: ${message}`);
}

/**
 * Lay a reel's symbol counts out as a strip of `stops` stops: each symbol's
 * stops are spread evenly round the reel (so a rows>1 window rarely shows
 * the same symbol twice), ties broken by a seeded shuffle, and any adjacent
 * pair that still matches is separated by a swap where one exists. Pure and
 * deterministic: the same counts and seed always give the same strip.
 */
export function arrange(countsBySymbol, order, stops, seed) {
  const rand = mulberry32(seed);
  const entries = [];
  for (const id of order) {
    const c = countsBySymbol[id] ?? 0;
    const offset = rand();
    for (let i = 0; i < c; i += 1) entries.push({ id, at: (i + offset) / c, tie: rand() });
  }
  entries.sort((a, b) => a.at - b.at || a.tie - b.tie);
  const strip = entries.map((e) => e.id);
  if (strip.length !== stops) throw new Error(`counts add to ${strip.length}, not ${stops}`);
  for (let i = 0; i < stops; i += 1) {
    const next = (i + 1) % stops;
    if (strip[i] !== strip[next]) continue;
    for (let j = i + 2; j < stops + i - 1; j += 1) {
      const k = j % stops;
      const prev = (k + stops - 1) % stops;
      const after = (k + 1) % stops;
      if (strip[k] !== strip[i] && strip[prev] !== strip[next] && strip[after] !== strip[next]) {
        [strip[next], strip[k]] = [strip[k], strip[next]];
        break;
      }
    }
  }
  return strip;
}

export function normalize(input) {
  const spec = structuredClone(input);
  const id = spec.id;
  if (!id || !/^[a-z][a-z0-9]*$/.test(id)) fail(spec, 'id must be lower-case letters and digits');
  if (!MODES.includes(spec.mode)) fail(spec, `mode must be one of ${MODES.join(', ')}`);
  if (!Number.isInteger(spec.reels) || spec.reels < 1) fail(spec, 'reels must be a positive integer');
  if (!Number.isInteger(spec.rows) || spec.rows < 1) fail(spec, 'rows must be a positive integer');
  if (!isPow2(spec.stops) || spec.stops > 256) {
    fail(spec, `stops must be a power of two up to 256 (one random byte per reel, masked), got ${spec.stops}`);
  }
  if (!Number.isInteger(spec.betCredits) || spec.betCredits < 1) fail(spec, 'betCredits must be a positive integer');
  spec.bets = spec.bets ?? [1];

  // ---- symbols: indexed in order; paying kinds first, then scatter, then bonus.
  const symbols = spec.symbols.map((s, index) => ({ ...s, index }));
  const byId = new Map();
  for (const s of symbols) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(s.id)) fail(spec, `symbol id ${s.id} must be UPPER_SNAKE`);
    if (!KINDS.includes(s.kind)) fail(spec, `symbol ${s.id}: kind must be one of ${KINDS.join(', ')}`);
    if (byId.has(s.id)) fail(spec, `duplicate symbol ${s.id}`);
    byId.set(s.id, s);
  }
  let seenSpecial = false;
  for (const s of symbols) {
    const special = s.kind === 'scatter' || s.kind === 'bonus';
    if (special) seenSpecial = true;
    else if (seenSpecial) fail(spec, `symbol ${s.id}: regular and wild symbols must come before scatter and bonus`);
  }
  const wild = symbols.filter((s) => s.kind === 'wild');
  if (wild.length > 1) fail(spec, 'at most one wild symbol');
  spec.symbolIndex = Object.fromEntries(symbols.map((s) => [s.id, s.index]));
  spec.symbols = symbols;
  spec.wildIndex = wild.length ? wild[0].index : -1;
  spec.payingCount = symbols.filter((s) => s.kind === 'regular' || s.kind === 'wild').length;
  const need = (symId, kind, what) => {
    const s = byId.get(symId);
    if (!s || s.kind !== kind) fail(spec, `${what}: ${symId} must be a ${kind} symbol`);
    return s.index;
  };

  // ---- strips: from counts (arranged deterministically) or given outright.
  if (spec.counts) {
    if (spec.counts.length !== spec.reels) fail(spec, `counts needs one entry per reel (${spec.reels})`);
    const order = symbols.map((s) => s.id);
    spec.strips = spec.counts.map((counts, reel) => {
      for (const k of Object.keys(counts)) if (!byId.has(k)) fail(spec, `reel ${reel + 1}: unknown symbol ${k}`);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      if (total !== spec.stops) fail(spec, `reel ${reel + 1}: counts add to ${total}, not ${spec.stops}`);
      return arrange(counts, order, spec.stops, (spec.arrangeSeed ?? 1) * 7919 + reel).map((k) => spec.symbolIndex[k]);
    });
  } else if (spec.strips) {
    if (spec.strips.length !== spec.reels) fail(spec, 'strips needs one entry per reel');
    spec.strips = spec.strips.map((strip, reel) => {
      if (strip.length !== spec.stops) fail(spec, `reel ${reel + 1}: strip has ${strip.length} stops, not ${spec.stops}`);
      return strip.map((k) => {
        if (!byId.has(k)) fail(spec, `reel ${reel + 1}: unknown symbol ${k}`);
        return spec.symbolIndex[k];
      });
    });
  } else {
    fail(spec, 'give either counts or strips');
  }

  // ---- pays: symbol -> { count: credits }, all integers.
  spec.paysByIndex = {};
  for (const [k, table] of Object.entries(spec.pays ?? {})) {
    const s = byId.get(k);
    if (!s || (s.kind !== 'regular' && s.kind !== 'wild')) fail(spec, `pays: ${k} must be a regular or wild symbol`);
    spec.paysByIndex[s.index] = {};
    for (const [n, credits] of Object.entries(table)) {
      if (!Number.isInteger(credits) || credits < 0 || credits > 65535) fail(spec, `pays.${k}[${n}] must be an integer 0..65535`);
      spec.paysByIndex[s.index][Number(n)] = credits;
    }
  }
  spec.payWidth = (spec.mode === 'cluster' ? spec.reels * spec.rows : spec.reels) + 1;

  if (spec.mode === 'line') {
    if (!spec.lines?.length) fail(spec, 'line mode needs lines');
    for (const line of spec.lines) {
      if (line.length !== spec.reels || line.some((r) => !Number.isInteger(r) || r < 0 || r >= spec.rows)) {
        fail(spec, `bad payline ${JSON.stringify(line)}`);
      }
    }
  }
  if (spec.mode === 'cluster') spec.cluster = { min: 5, ...(spec.cluster ?? {}) };

  // ---- scatter / free spins / bonus / progressives.
  const cells = spec.reels * spec.rows;
  if (spec.scatter) {
    spec.scatterIndex = need(spec.scatter.symbol, 'scatter', 'scatter');
    spec.scatter.pays = spec.scatter.pays ?? {};
    spec.scatter.freeSpins = spec.scatter.freeSpins ?? {};
    for (const n of [...Object.keys(spec.scatter.pays), ...Object.keys(spec.scatter.freeSpins)]) {
      if (!(Number(n) >= 1 && Number(n) <= cells)) fail(spec, `scatter count ${n} out of range`);
    }
  } else spec.scatterIndex = -1;
  if (spec.freeSpins) {
    if (!spec.scatter) fail(spec, 'freeSpins needs a scatter');
    spec.freeSpins = { multiplier: 1, retrigger: false, cap: 50, ...spec.freeSpins };
    if (spec.freeSpins.cap > 250) fail(spec, 'freeSpins.cap must fit a byte');
    const maxAward = Math.max(0, ...Object.values(spec.scatter.freeSpins));
    if (maxAward > spec.freeSpins.cap) fail(spec, 'a free-spin award exceeds the cap');
  }
  if (spec.bonus) {
    spec.bonusIndex = need(spec.bonus.symbol, 'bonus', 'bonus');
    const wheel = spec.bonus.wheel ?? [];
    const total = wheel.reduce((a, w) => a + w.weight, 0);
    if (!isPow2(total) || total > 256) fail(spec, `bonus wheel weights add to ${total}; need a power of two up to 256`);
    spec.bonus.wheelTotal = total;
  } else spec.bonusIndex = -1;
  spec.progressives = (spec.progressives ?? []).map((p, i) => {
    const level = { eligibleFromBet: 1, via: 'wheel', ...p, index: i };
    if (!Number.isInteger(level.seed) || level.seed < 0 || level.seed > 4294967295) fail(spec, `progressive ${p.id}: seed must be an integer 0..4294967295`);
    if (level.via === 'spin') {
      if (!level.prob || !isPow2(level.prob.den) || level.prob.den > 65536 || !(level.prob.num >= 1)) {
        fail(spec, `progressive ${p.id}: prob needs a power-of-two den up to 65536`);
      }
    } else if (level.via !== 'wheel') fail(spec, `progressive ${p.id}: via must be wheel or spin`);
    if (level.fixed && level.via === 'wheel') fail(spec, `progressive ${p.id}: a fixed-odds jackpot needs via: 'spin'`);
    return level;
  });
  const wheelJackpots = (spec.bonus?.wheel ?? []).filter((w) => w.jackpot);
  for (const w of wheelJackpots) {
    if (!spec.progressives.some((p) => p.id === w.jackpot && p.via === 'wheel')) {
      fail(spec, `wheel segment names jackpot ${w.jackpot}, which is not a wheel-fed progressive`);
    }
  }
  const spinLevels = spec.progressives.filter((p) => p.via === 'spin');
  if (spinLevels.length > 1 && spinLevels.every((p) => p.prob.den === spinLevels[0].prob.den)) {
    const sum = spinLevels.reduce((a, p) => a + p.prob.num, 0);
    if (sum > spinLevels[0].prob.den) fail(spec, 'per-spin jackpot ranges overlap: their numerators exceed the shared denominator');
  }
  spec.hash = hashOf(input);
  return spec;
}
