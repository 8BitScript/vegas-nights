// Exact analysis of a spec: the joint distribution of one base spin, then the
// feature layers folded in as moments. Everything a PAR sheet reports comes
// out of `compose`, so exact and Monte Carlo runs share every formula and
// differ only in how the joint distribution of (line win, scatters, bonus
// symbols) was obtained: by enumeration or by sampling.
import * as line from './modes/line.mjs';
import * as ways from './modes/ways.mjs';
import * as cluster from './modes/cluster.mjs';
import { reelWindows, suffixFeatures, scatterDistribution, bonusTriggerProbability } from './windows.mjs';
import {
  scatterPay, freeAward, bonusTriggered, sessionMoments, expectedSpins,
  jackpotMoments, wheelMoments, wheelSegmentProbability,
} from './features.mjs';
import { mulberry32 } from './util.mjs';

const MODE = { line, ways, cluster };

/** Per-spin progressives whose draws share one value (same denominator): disjoint ranges of it. */
export function sharedDraw(spec) {
  const spin = spec.progressives.filter((l) => l.via === 'spin');
  return spin.length > 1 && spin.every((l) => l.prob.den === spin[0].prob.den);
}

/** Largest stops**reels the brute-force enumerator is allowed to walk without being asked. */
export const BRUTE_FORCE_LIMIT = 4_000_000;

function jointKey(win, sc, bn) { return `${win}|${sc}|${bn}`; }

/** The distribution of one base spin: Map("win|sc|bn" -> weight), plus its total weight. */
export function buildJoint(spec, ctx, { method, samples, seed }) {
  const joint = new Map();
  const add = (win, sc, bn, w) => {
    const k = jointKey(win, sc, bn);
    joint.set(k, (joint.get(k) ?? 0) + w);
  };
  const mode = MODE[spec.mode];
  if (method === 'exact') {
    if (spec.mode === 'cluster' && spec.stops ** spec.reels > BRUTE_FORCE_LIMIT) {
      throw new Error(`${spec.id}: ${spec.stops ** spec.reels} outcomes is too many to enumerate; use method 'mc'`);
    }
    mode.enumerate(spec, ctx.windows, ctx.suffix, add);
    return { joint, total: spec.stops ** spec.reels };
  }
  if (spec.mode !== 'cluster') {
    // Sampling exists only for the mode with no exact route; the others are always exact.
    throw new Error(`${spec.id}: method 'mc' is only for cluster mode`);
  }
  cluster.sample(spec, ctx.windows, samples, mulberry32(seed), add);
  return { joint, total: samples };
}

function eligibleSet(spec, bet) {
  return new Set(spec.progressives.filter((p) => p.eligibleFromBet <= bet).map((p) => p.id));
}

/** Free-spin session moments for a base joint distribution. */
function sessionsFor(spec, joint, total) {
  if (!spec.freeSpins) return null;
  const merged = new Map();
  for (const [key, w] of joint) {
    const [win, sc] = key.split('|').map(Number);
    const x = spec.freeSpins.multiplier * (win + scatterPay(spec, sc));
    const a = spec.freeSpins.retrigger ? freeAward(spec, sc) : 0;
    const k = `${x}|${a}`;
    merged.set(k, (merged.get(k) ?? 0) + w / total);
  }
  const items = [...merged].map(([k, p]) => {
    const [x, a] = k.split('|').map(Number);
    return { x, a, p };
  });
  return sessionMoments(items, spec.freeSpins.cap);
}

/** Fold the feature layers into the base joint distribution. Pure arithmetic on the joint. */
export function compose(spec, ctx, joint, total, eligible) {
  const bet = spec.betCredits;
  // --- free-spin sessions: independent of which jackpots a bet has opened, so computed once per joint
  const sess = ctx.sessions ?? (ctx.sessions = sessionsFor(spec, joint, total));

  // --- trigger probability, jackpots, wheel
  let pTrig = 0;
  const jointRows = [];
  for (const [key, w] of joint) {
    const [win, sc, bn] = key.split('|').map(Number);
    const p = w / total;
    const trig = bonusTriggered(spec, bn);
    if (trig) pTrig += p;
    jointRows.push({ win, sc, bn, p, trig });
  }
  const jackpots = {};
  const hitProb = {};
  for (const level of spec.progressives) {
    hitProb[level.id] = level.via === 'spin' ? level.prob.num / level.prob.den : pTrig * wheelSegmentProbability(spec, level.id);
    jackpots[level.id] = jackpotMoments(level, hitProb[level.id], bet);
  }
  const wheel = spec.bonus ? wheelMoments(spec, jackpots, eligible) : { m1: 0, m2: 0, parts: { credits: 0, jackpot: {} } };

  // --- the per-spin sums
  const comp = { lines: 0, scatter: 0, freeSpins: 0, wheelCredits: 0, wheelJackpots: {}, spinJackpots: {} };
  let e1 = 0;
  let e2 = 0;
  let pWin = 0;
  let pFree = 0;
  let maxImmediate = 0;
  const immediate = [];
  for (const r of jointRows) {
    const x = r.win + scatterPay(spec, r.sc);
    const n = freeAward(spec, r.sc);
    const s1 = sess && n > 0 ? sess.m1[n] : 0;
    const s2 = sess && n > 0 ? sess.m2[n] : 0;
    const b1 = r.trig ? wheel.m1 : 0;
    const b2 = r.trig ? wheel.m2 : 0;
    comp.lines += r.p * r.win;
    comp.scatter += r.p * scatterPay(spec, r.sc);
    comp.freeSpins += r.p * s1;
    if (r.trig) {
      comp.wheelCredits += r.p * wheel.parts.credits;
      for (const [id, v] of Object.entries(wheel.parts.jackpot)) comp.wheelJackpots[id] = (comp.wheelJackpots[id] ?? 0) + r.p * v;
    }
    e1 += r.p * (x + s1 + b1);
    e2 += r.p * (x * x + s2 + b2 + 2 * x * s1 + 2 * x * b1 + 2 * s1 * b1);
    if (x > 0) pWin += r.p;
    if (n > 0) pFree += r.p;
    if (x > maxImmediate) maxImmediate = x;
    immediate.push([x, r.p]);
  }
  // Progressives drawn independently of the reels (a per-spin chance).
  const spin = spec.progressives.filter((l) => l.via === 'spin' && eligible.has(l.id));
  const spinMeans = spin.map((l) => hitProb[l.id] * jackpots[l.id].m1);
  const spinSum = spinMeans.reduce((a, b) => a + b, 0);
  let spinE2 = 0;
  spin.forEach((l, i) => { spinE2 += hitProb[l.id] * jackpots[l.id].m2; comp.spinJackpots[l.id] = spinMeans[i]; });
  // Levels that share one draw are mutually exclusive (disjoint ranges of the same value),
  // so they never pay together; levels with their own draws are independent.
  if (!sharedDraw(spec)) {
    for (let i = 0; i < spin.length; i += 1) for (let j = 0; j < spin.length; j += 1) if (i !== j) spinE2 += spinMeans[i] * spinMeans[j];
  }
  const mean = e1 + spinSum;
  const second = e2 + 2 * e1 * spinSum + spinE2;
  return {
    components: comp,
    meanCredits: mean,
    variance: Math.max(0, second - mean * mean),
    pWin, pFree, pTrig, maxImmediate, immediate, hitProb, jackpots, wheel,
  };
}

const HIST_EDGES = [0, 1, 2, 5, 10, 25, 50, 100, Infinity];

function histogram(spec, immediate) {
  const bet = spec.betCredits;
  const rows = [{ label: 'no win', lo: 0, hi: 0, p: 0 }];
  for (let i = 0; i < HIST_EDGES.length - 1; i += 1) {
    const lo = HIST_EDGES[i];
    const hi = HIST_EDGES[i + 1];
    rows.push({ label: hi === Infinity ? `${lo}x+` : `${lo === 0 ? '>0' : lo}x to <${hi}x`, lo, hi, p: 0 });
  }
  for (const [x, p] of immediate) {
    if (x === 0) { rows[0].p += p; continue; }
    const m = x / bet;
    const row = rows.slice(1).find((r) => m >= r.lo && m < r.hi) ?? rows.at(-1);
    row.p += p;
  }
  return rows;
}

const Z = { 95: 1.645, 99: 2.326 };

export function analyze(spec, opts = {}) {
  const method = opts.method ?? (spec.mode === 'cluster' && spec.stops ** spec.reels > BRUTE_FORCE_LIMIT ? 'mc' : 'exact');
  const samples = opts.samples ?? 2_000_000;
  const seed = opts.seed ?? 20261003;
  const batches = opts.batches ?? 20;
  const windows = reelWindows(spec);
  const suffix = suffixFeatures(windows);
  const ctx = { windows, suffix };
  const bet = spec.betCredits;
  const allEligible = eligibleSet(spec, Math.max(...spec.bets));

  let joint;
  let total;
  let ci = null;
  if (method === 'exact') {
    ({ joint, total } = buildJoint(spec, ctx, { method, samples, seed }));
  } else {
    // Batch means: B independent runs, each fully composed, so the interval includes
    // the noise in the free-spin and feature inputs, not just in the headline mean.
    joint = new Map();
    total = 0;
    const per = Math.floor(samples / batches);
    const rtps = [];
    for (let b = 0; b < batches; b += 1) {
      const part = buildJoint(spec, ctx, { method, samples: per, seed: seed + b * 104729 });
      for (const [k, w] of part.joint) joint.set(k, (joint.get(k) ?? 0) + w);
      total += part.total;
      rtps.push(compose(spec, { ...ctx, sessions: undefined }, part.joint, part.total, allEligible).meanCredits / bet);
    }
    const mean = rtps.reduce((a, b) => a + b, 0) / batches;
    const sd = Math.sqrt(rtps.reduce((a, b) => a + (b - mean) ** 2, 0) / (batches - 1));
    const t = 2.093; // Student t, df = 19, 95% two-sided
    ci = { level: 0.95, half: (t * sd) / Math.sqrt(batches), batches, samples: per * batches };
  }

  const full = compose(spec, ctx, joint, total, allEligible);
  const rtp = full.meanCredits / bet;
  const sigma = Math.sqrt(full.variance) / bet;

  // RTP at each bet level: progressives pay only from their eligibility bet up.
  const sets = new Map();
  const perBet = spec.bets.map((b) => {
    const el = eligibleSet(spec, b);
    const key = [...el].sort().join(',');
    if (!sets.has(key)) sets.set(key, compose(spec, ctx, joint, total, el));
    const c = sets.get(key);
    return { bet: b, rtp: c.meanCredits / bet, sigma: Math.sqrt(c.variance) / bet, eligible: [...el] };
  });

  const scat = scatterDistribution(spec, suffix);
  const jackpots = spec.progressives.map((l) => {
    const p = full.hitProb[l.id];
    const j = full.jackpots[l.id];
    const bonusFunded = l.fixed ? 0 : j.meterPerSpin / bet;
    return {
      id: l.id, via: l.via, fixed: Boolean(l.fixed), p, oneIn: p > 0 ? 1 / p : Infinity,
      seed: l.seed, meanPayout: j.m1, meanPayoutBets: j.m1 / bet,
      rtp: (p * j.m1) / bet, betFunded: bonusFunded, houseFunded: (p * l.seed) / bet,
      eligibleFromBet: l.eligibleFromBet,
    };
  });

  const exactBase = method === 'exact' && spec.mode !== 'cluster'
    ? exactFraction(spec, joint, total)
    : null;

  return {
    id: spec.id, title: spec.title, hash: spec.hash, mode: spec.mode, method,
    reels: spec.reels, rows: spec.rows, stops: spec.stops, betCredits: bet,
    outcomes: spec.stops ** spec.reels,
    rtp,
    ci,
    components: {
      lines: full.components.lines / bet,
      scatter: full.components.scatter / bet,
      freeSpins: full.components.freeSpins / bet,
      wheelCredits: full.components.wheelCredits / bet,
      wheelJackpots: Object.fromEntries(Object.entries(full.components.wheelJackpots).map(([k, v]) => [k, v / bet])),
      spinJackpots: Object.fromEntries(Object.entries(full.components.spinJackpots).map(([k, v]) => [k, v / bet])),
    },
    exactBase,
    // Where the return is earned: the reels (line/ways/cluster + scatter pays), the bonus round
    // (free spins + wheel credits), and the jackpots (wheel- and draw-fed, meter contribution
    // and house-funded seed together).
    split: splitOf(full.components, bet),
    hitFrequency: full.pWin,
    freeSpinTrigger: full.pFree,
    bonusTrigger: full.pTrig,
    scatterDistribution: Object.fromEntries([...scat].sort((a, b) => a[0] - b[0])),
    sigma,
    varianceBets: sigma ** 2,
    confidence: [100, 1000, 10000].map((n) => ({
      spins: n,
      bankroll95: Math.max(0, Z[95] * sigma * Math.sqrt(n) + n * (1 - rtp)),
      bankroll99: Math.max(0, Z[99] * sigma * Math.sqrt(n) + n * (1 - rtp)),
    })),
    maxImmediate: full.maxImmediate / bet,
    maxFreeSessionBound: spec.freeSpins ? (spec.freeSpins.cap * spec.freeSpins.multiplier * full.maxImmediate) / bet : 0,
    histogram: histogram(spec, full.immediate),
    jackpots,
    perBet,
  };
}

function splitOf(c, bet) {
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const baseGame = (c.lines + c.scatter) / bet;
  const bonusRound = (c.freeSpins + c.wheelCredits) / bet;
  const progressives = (sum(c.wheelJackpots) + sum(c.spinJackpots)) / bet;
  return { baseGame, bonusRound, progressives, total: baseGame + bonusRound + progressives };
}

/** Lines + scatter pay as an exact rational: sum(weight * credits) / (outcomes * betCredits). */
function exactFraction(spec, joint, total) {
  let num = 0n;
  for (const [key, w] of joint) {
    const [win, sc] = key.split('|').map(Number);
    num += BigInt(w) * BigInt(win + scatterPay(spec, sc));
  }
  return { numerator: num, denominator: BigInt(total) * BigInt(spec.betCredits) };
}

/** Mean-only, no enumeration: linearity of expectation. Used by the tuner; equals analyze() for line/ways. */
export function fastRtp(spec) {
  const bet = spec.betCredits;
  const mode = MODE[spec.mode];
  if (!mode.expectedPay) throw new Error(`${spec.id}: ${spec.mode} mode has no closed-form mean`);
  const windows = reelWindows(spec);
  const suffix = suffixFeatures(windows);
  const outcomes = spec.stops ** spec.reels;
  const lines = mode.expectedPay(spec) / outcomes;
  const scat = scatterDistribution(spec, suffix);
  let scatter = 0;
  const awardDist = new Map();
  for (const [sc, p] of scat) {
    scatter += p * scatterPay(spec, sc);
    const a = spec.freeSpins?.retrigger ? freeAward(spec, sc) : 0;
    awardDist.set(a, (awardDist.get(a) ?? 0) + p);
  }
  let freeSpins = 0;
  if (spec.freeSpins) {
    const EN = expectedSpins(awardDist, spec.freeSpins.cap);
    const perFree = spec.freeSpins.multiplier * (lines + scatter);
    for (const [sc, p] of scat) {
      const n = freeAward(spec, sc);
      if (n > 0) freeSpins += p * perFree * EN[n];
    }
  }
  const pTrig = bonusTriggerProbability(spec, suffix);
  const jackpots = {};
  for (const l of spec.progressives) {
    const p = l.via === 'spin' ? l.prob.num / l.prob.den : pTrig * wheelSegmentProbability(spec, l.id);
    jackpots[l.id] = jackpotMoments(l, p, bet);
  }
  const eligible = eligibleSet(spec, Math.max(...spec.bets));
  let wheelPart = 0;
  if (spec.bonus) wheelPart = pTrig * wheelMoments(spec, jackpots, eligible).m1;
  let spinPart = 0;
  for (const l of spec.progressives) {
    if (l.via === 'spin' && eligible.has(l.id)) spinPart += (l.prob.num / l.prob.den) * jackpots[l.id].m1;
  }
  const credits = lines + scatter + freeSpins + wheelPart + spinPart;
  return {
    rtp: credits / bet,
    parts: {
      lines: lines / bet, scatter: scatter / bet, freeSpins: freeSpins / bet, wheel: wheelPart / bet, spin: spinPart / bet,
    },
  };
}
