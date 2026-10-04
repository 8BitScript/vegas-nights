// The tuner. A spec's `tune` block names a target RTP, a tolerance, and a list
// of levers - integer changes that are allowed (a pay up or down by a step, or
// one stop moved from one symbol to another on a reel). The search is a
// deterministic greedy descent on |RTP - target|, evaluated with the exact
// closed-form mean (fastRtp), so every step is exact arithmetic and the whole
// search costs milliseconds. It stops the moment the error is inside the
// tolerance, and records every move it made.
import { normalize } from './spec.mjs';
import { fastRtp } from './analyze.mjs';

function evaluate(raw) {
  return fastRtp(normalize(raw)).rtp;
}

/**
 * A paytable must still make sense after a move: a longer run never pays less than a shorter
 * one, and at the same run length a higher-ranked symbol (earlier in `symbols`) never pays less
 * than a lower-ranked one. Wilds sit outside the ranking.
 */
export function ordered(raw) {
  const ranked = raw.symbols.filter((s) => s.kind === 'regular').map((s) => s.id);
  for (const id of ranked) {
    const counts = Object.keys(raw.pays[id] ?? {}).map(Number).sort((a, b) => a - b);
    for (let i = 1; i < counts.length; i += 1) if (raw.pays[id][counts[i]] < raw.pays[id][counts[i - 1]]) return false;
  }
  for (let i = 1; i < ranked.length; i += 1) {
    for (const [n, v] of Object.entries(raw.pays[ranked[i]] ?? {})) {
      const above = raw.pays[ranked[i - 1]]?.[n];
      if (above !== undefined && v > above) return false;
    }
  }
  return true;
}

function applyLever(raw, lever, dir) {
  const next = structuredClone(raw);
  if (lever.pay) {
    const [sym, count] = lever.pay;
    const table = (next.pays[sym] ??= {});
    const v = (table[count] ?? 0) + dir * (lever.step ?? 1);
    if (v < 0 || v > 65535) return null;
    table[count] = v;
    return ordered(next) ? next : null;
  }
  if (lever.swap) {
    const { reel, from, to } = lever.swap;
    const reels = reel === 'all' ? next.counts.map((_, i) => i) : [reel];
    for (const r of reels) {
      const [a, b] = dir > 0 ? [from, to] : [to, from];
      if ((next.counts[r][a] ?? 0) < 1) return null;
      next.counts[r][a] -= 1;
      next.counts[r][b] = (next.counts[r][b] ?? 0) + 1;
    }
    return next;
  }
  throw new Error(`unknown lever ${JSON.stringify(lever)}`);
}

const describe = (lever, dir) => {
  if (lever.pay) return `pay ${lever.pay[0]}x${lever.pay[1]} ${dir > 0 ? '+' : '-'}${lever.step ?? 1}`;
  return `swap reel ${lever.swap.reel}: ${dir > 0 ? lever.swap.from : lever.swap.to} -> ${dir > 0 ? lever.swap.to : lever.swap.from}`;
};

/** Run the search on a raw spec. Returns {raw, steps, rtp, target, converged}. */
export function tune(rawIn) {
  const t = rawIn.tune;
  let raw = structuredClone(rawIn);
  const steps = [];
  let rtp = evaluate(raw);
  let err = Math.abs(rtp - t.target);
  const limit = t.maxSteps ?? 1000;
  while (err > t.tolerance && steps.length < limit) {
    let best = null;
    for (const lever of t.levers) {
      for (const dir of [1, -1]) {
        const cand = applyLever(raw, lever, dir);
        if (!cand) continue;
        let r;
        try { r = evaluate(cand); } catch { continue; }
        const e = Math.abs(r - t.target);
        if (e < err - 1e-15 && (!best || e < best.err - 1e-15)) best = { cand, r, e, lever, dir };
      }
    }
    if (!best) break;
    steps.push({ move: describe(best.lever, best.dir), before: rtp, after: best.r });
    raw = best.cand;
    rtp = best.r;
    err = best.e;
  }
  return { raw, steps, rtp, target: t.target, tolerance: t.tolerance, converged: err <= t.tolerance };
}

/** The one entry point for loading a game: tune if asked to, then normalize. */
export function resolve(rawIn) {
  if (!rawIn.tune) return Object.assign(normalize(rawIn), { tuning: null });
  const result = tune(rawIn);
  if (!result.converged) {
    throw new Error(`${rawIn.id}: tuner stopped at RTP ${(result.rtp * 100).toFixed(4)}% (target ${(result.target * 100).toFixed(2)}% +/- ${(result.tolerance * 100).toFixed(3)}%) after ${result.steps.length} steps`);
  }
  const spec = normalize({ ...result.raw, tune: undefined });
  // Hash the source as written, so the header ties the output to the spec file.
  spec.hash = normalize(rawIn).hash;
  // Run-length encode repeated moves so a long walk reads as "pay X +5 (x38)".
  const runs = [];
  for (const s of result.steps) {
    const last = runs.at(-1);
    if (last && last.move === s.move) { last.times += 1; last.after = s.after; } else runs.push({ ...s, times: 1 });
  }
  spec.tuning = { target: result.target, tolerance: result.tolerance, steps: runs, moves: result.steps.length, rtp: result.rtp };
  return spec;
}
