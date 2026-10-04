// A deliberately naive second implementation of the three pay modes, written from the
// definitions with none of the engine's structure (no DP, no pruning, no distinct-window
// compression, no shared state). The tests brute-force tiny games through this and demand
// the engine agree exactly. If both were wrong in the same way, it would have to be by
// coincidence rather than by a shared helper.
import { normalize } from '../src/spec.mjs';

export const cellsOf = (spec, stops) => stops.map((t, reel) => Array.from({ length: spec.rows }, (_, row) => spec.strips[reel][(t + row) % spec.stops]));

const kindOf = (spec, idx) => spec.symbols[idx].kind;
const payOf = (spec, idx, n) => spec.paysByIndex[idx]?.[n] ?? 0;

/** One payline, read straight off the definition. */
export function naiveLine(spec, symbols) {
  // wild-only prefix
  let lead = 0;
  while (lead < symbols.length && kindOf(spec, symbols[lead]) === 'wild') lead += 1;
  let best = spec.wildIndex >= 0 ? payOf(spec, spec.wildIndex, lead) : 0;
  if (lead === symbols.length) return best;
  const first = symbols[lead];
  if (kindOf(spec, first) !== 'regular') return best;
  let run = lead;
  while (run < symbols.length && (symbols[run] === first || kindOf(spec, symbols[run]) === 'wild')) run += 1;
  const asSymbol = payOf(spec, first, run);
  const asWild = spec.wildIndex >= 0 && lead > 0 ? payOf(spec, spec.wildIndex, lead) : 0;
  return Math.max(best, asSymbol, asWild);
}

export function naiveWays(spec, cells) {
  let total = 0;
  for (const s of spec.symbols) {
    if (s.kind !== 'regular' && s.kind !== 'wild') continue;
    if (!spec.paysByIndex[s.index]) continue;
    let run = 0;
    let ways = 1;
    for (let reel = 0; reel < spec.reels; reel += 1) {
      const c = cells[reel].filter((x) => x === s.index || (s.kind !== 'wild' && x === spec.wildIndex)).length;
      if (c === 0) break;
      run += 1;
      ways *= c;
    }
    if (run > 0) total += payOf(spec, s.index, run) * ways;
  }
  return total;
}

export function naiveCluster(spec, cells) {
  const R = spec.reels;
  const K = spec.rows;
  let total = 0;
  for (const s of spec.symbols) {
    if (s.kind !== 'regular' || !spec.paysByIndex[s.index]) continue;
    const parent = Array.from({ length: R * K }, (_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const member = (r, k) => cells[r][k] === s.index || (spec.wildIndex >= 0 && cells[r][k] === spec.wildIndex);
    for (let r = 0; r < R; r += 1) {
      for (let k = 0; k < K; k += 1) {
        if (!member(r, k)) continue;
        if (r + 1 < R && member(r + 1, k)) parent[find(r * K + k)] = find((r + 1) * K + k);
        if (k + 1 < K && member(r, k + 1)) parent[find(r * K + k)] = find(r * K + k + 1);
      }
    }
    // Union-find merges THROUGH wilds, like the engine's flood fill; a group needs a real symbol.
    const groups = new Map();
    for (let r = 0; r < R; r += 1) for (let k = 0; k < K; k += 1) {
      if (!member(r, k)) continue;
      const g = find(r * K + k);
      const e = groups.get(g) ?? { size: 0, real: false };
      e.size += 1;
      if (cells[r][k] === s.index) e.real = true;
      groups.set(g, e);
    }
    for (const { size, real } of groups.values()) {
      if (!real || size < spec.cluster.min) continue;
      // pay is for the largest listed size not above `size`
      const keys = Object.keys(spec.paysByIndex[s.index]).map(Number).filter((n) => n <= size).sort((a, b) => a - b);
      total += keys.length ? spec.paysByIndex[s.index][keys.at(-1)] : 0;
    }
  }
  return total;
}

/** Every combination of stops, as {win, sc, bn}; for games small enough to walk. */
export function bruteForce(spec) {
  const out = { count: 0, sumWin: 0, sumWin2: 0, hits: 0, joint: new Map(), maxWin: 0 };
  const idx = new Array(spec.reels).fill(0);
  const total = spec.stops ** spec.reels;
  for (let n = 0; n < total; n += 1) {
    let rest = n;
    for (let r = 0; r < spec.reels; r += 1) { idx[r] = rest % spec.stops; rest = Math.floor(rest / spec.stops); }
    const cells = cellsOf(spec, idx);
    let win = 0;
    if (spec.mode === 'line') {
      for (const line of spec.lines) win += naiveLine(spec, line.map((row, reel) => cells[reel][row]));
    } else if (spec.mode === 'ways') win = naiveWays(spec, cells);
    else win = naiveCluster(spec, cells);
    const flat = cells.flat();
    const sc = flat.filter((x) => x === spec.scatterIndex).length;
    const bn = flat.filter((x) => x === spec.bonusIndex).length;
    const key = `${win}|${sc}|${bn}`;
    out.joint.set(key, (out.joint.get(key) ?? 0) + 1);
    out.count += 1;
    out.sumWin += win;
    out.sumWin2 += win * win;
    if (win > 0) out.hits += 1;
    if (win > out.maxWin) out.maxWin = win;
  }
  return out;
}

/** A small deterministic family of specs that exercise wilds, scatters, bonus and every mode. */
export function tinySpec(over = {}) {
  const base = {
    id: 'tiny', title: 'Tiny', mode: 'line', reels: 3, rows: 2, stops: 8, betCredits: 10, bets: [1, 2],
    arrangeSeed: 1,
    symbols: [
      { id: 'AAA', kind: 'regular' }, { id: 'BBB', kind: 'regular' }, { id: 'CCC', kind: 'regular' },
      { id: 'WILD', kind: 'wild' }, { id: 'SCAT', kind: 'scatter' }, { id: 'BONUS', kind: 'bonus' },
    ],
    counts: [
      { AAA: 2, BBB: 2, CCC: 2, SCAT: 1, BONUS: 1 },
      { AAA: 2, BBB: 1, CCC: 2, WILD: 2, SCAT: 1 },
      { AAA: 1, BBB: 2, CCC: 2, WILD: 1, SCAT: 1, BONUS: 1 },
    ],
    lines: [[0, 0, 0], [1, 1, 1], [0, 1, 0]],
    pays: { AAA: { 2: 5, 3: 40 }, BBB: { 2: 3, 3: 25 }, CCC: { 3: 10 }, WILD: { 2: 8, 3: 90 } },
    scatter: { symbol: 'SCAT', pays: { 2: 10, 3: 60 }, freeSpins: { 2: 2, 3: 4 } },
    freeSpins: { multiplier: 2, retrigger: true, cap: 8 },
    bonus: { symbol: 'BONUS', minCount: 2, wheel: [{ weight: 4, credits: 30 }, { weight: 3, credits: 70 }, { weight: 1, jackpot: 'TOP', fallback: 50 }] },
    progressives: [{ id: 'TOP', seed: 500, contribution: { num: 1, den: 100 }, via: 'wheel', eligibleFromBet: 2 }],
  };
  return normalize({ ...base, ...over });
}

/** The whole distribution of a session's total, by walking every branch. Independent of the DP. */
export function sessionTree(items, cap, left, granted, memo = new Map()) {
  if (left === 0) return new Map([[0, 1]]);
  const key = `${left}|${granted}`;
  if (memo.has(key)) return memo.get(key);
  const out = new Map();
  for (const { x, a, p } of items) {
    const extra = Math.min(a, cap - granted);
    for (const [v, q] of sessionTree(items, cap, left - 1 + extra, granted + extra, memo)) {
      out.set(x + v, (out.get(x + v) ?? 0) + p * q);
    }
  }
  memo.set(key, out);
  return out;
}
