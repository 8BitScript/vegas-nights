// The feature layers on top of a base spin: scatter pays, free spins (with
// retrigger and a cap), the bonus wheel, and progressive jackpots. Each is
// reduced to its first and second moments, exactly, so the analysis can
// combine them into a mean and a variance without simulating anything.

export const scatterPay = (spec, sc) => spec.scatter?.pays?.[sc] ?? 0;
export const freeAward = (spec, sc) => (spec.freeSpins ? spec.scatter.freeSpins[sc] ?? 0 : 0);
export const bonusTriggered = (spec, bn) => Boolean(spec.bonus) && bn >= spec.bonus.minCount;

/**
 * Free-spin sessions. `items` is the per-free-spin joint distribution of
 * (win x, spins awarded a) as [{x, a, p}]. A session starts with n spins and
 * plays them one at a time; each spin's award extends the session until `cap`
 * spins in all have been granted. Returns {m1[n], m2[n]}: the mean and second
 * moment of the session's total win for every start n = 0..cap.
 *
 * The recursion is over (spins left, spins granted so far); granting spins
 * moves "granted" up, playing one moves "left" down, so filling the table
 * from granted = cap downward and left = 0 upward touches only finished cells.
 */
export function sessionMoments(items, cap) {
  const m1 = Array.from({ length: cap + 1 }, () => new Float64Array(cap + 1));
  const m2 = Array.from({ length: cap + 1 }, () => new Float64Array(cap + 1));
  // The spin's own win does not depend on the state, so its contribution is hoisted out of the
  // recursion: only items with a distinct award reach a different state, and items with the same
  // award share one (the next-state moments), weighted by their total probability and win moments.
  const byAward = new Map();
  for (const { x, a, p } of items) {
    const g = byAward.get(a) ?? { a, p: 0, px: 0, px2: 0 };
    g.p += p;
    g.px += p * x;
    g.px2 += p * x * x;
    byAward.set(a, g);
  }
  const groups = [...byAward.values()];
  const own1 = groups.reduce((s, g) => s + g.px, 0);
  const own2 = groups.reduce((s, g) => s + g.px2, 0);
  // m1[granted][left]
  for (let granted = cap; granted >= 0; granted -= 1) {
    for (let left = 1; left <= cap; left += 1) {
      let e1 = own1;
      let e2 = own2;
      for (const g of groups) {
        const extra = Math.min(g.a, cap - granted);
        const l2 = left - 1 + extra;
        const n1 = l2 <= cap ? m1[granted + extra][l2] : 0;
        const n2 = l2 <= cap ? m2[granted + extra][l2] : 0;
        e1 += g.p * n1;
        e2 += 2 * g.px * n1 + g.p * n2;
      }
      m1[granted][left] = e1;
      m2[granted][left] = e2;
    }
  }
  // A session starts with n spins granted and n left.
  return {
    m1: Array.from({ length: cap + 1 }, (_, n) => m1[n][n]),
    m2: Array.from({ length: cap + 1 }, (_, n) => m2[n][n]),
  };
}

/** Expected number of spins played in a session started with n spins: the mean-only case (award marginal). */
export function expectedSpins(awardDist, cap) {
  const EN = Array.from({ length: cap + 1 }, () => new Float64Array(cap + 1));
  for (let granted = cap; granted >= 0; granted -= 1) {
    for (let left = 1; left <= cap; left += 1) {
      let e = 0;
      for (const [a, p] of awardDist) {
        const extra = Math.min(a, cap - granted);
        const l2 = left - 1 + extra;
        e += p * (1 + (l2 <= cap ? EN[granted + extra][l2] : 0));
      }
      EN[granted][left] = e;
    }
  }
  return Array.from({ length: cap + 1 }, (_, n) => EN[n][n]);
}

/**
 * A progressive jackpot's payout when it hits, given the probability `p`
 * that a bet spin hits it. The meter starts at `seed`, gains `perSpin` credits
 * on every bet spin, and is paid out and reset on a hit, so its size at the hit
 * is seed + perSpin * G with G the number of spins since the last hit - a
 * geometric variable with mean 1/p and E[G^2] = (2 - p) / p^2.
 *
 * A fixed-odds jackpot has no meter: it always pays `seed`.
 */
export function jackpotMoments(level, p, betCredits) {
  if (level.fixed || p <= 0) return { m1: level.seed, m2: level.seed ** 2, meterPerSpin: 0 };
  const perSpin = (level.contribution.num / level.contribution.den) * betCredits;
  const m1 = level.seed + perSpin / p;
  const m2 = level.seed ** 2 + (2 * level.seed * perSpin) / p + (perSpin ** 2 * (2 - p)) / p ** 2;
  return { m1, m2, meterPerSpin: perSpin };
}

/**
 * The bonus wheel's prize moments. `eligible` is the set of progressive ids
 * whose jackpot a segment may actually pay; an ineligible segment pays its
 * `fallback` credits (default 0). `jackpots` maps id -> {m1, m2}.
 */
export function wheelMoments(spec, jackpots, eligible) {
  let m1 = 0;
  let m2 = 0;
  let credits1 = 0;
  const parts = { credits: 0, jackpot: {} };
  for (const seg of spec.bonus.wheel) {
    const p = seg.weight / spec.bonus.wheelTotal;
    if (seg.jackpot) {
      if (eligible.has(seg.jackpot)) {
        const j = jackpots[seg.jackpot];
        m1 += p * j.m1;
        m2 += p * j.m2;
        parts.jackpot[seg.jackpot] = (parts.jackpot[seg.jackpot] ?? 0) + p * j.m1;
      } else {
        const f = seg.fallback ?? 0;
        m1 += p * f;
        m2 += p * f * f;
        credits1 += p * f;
      }
    } else {
      m1 += p * seg.credits;
      m2 += p * seg.credits ** 2;
      credits1 += p * seg.credits;
    }
  }
  parts.credits = credits1;
  return { m1, m2, parts };
}

export const wheelSegmentProbability = (spec, id) => {
  if (!spec.bonus) return 0;
  let w = 0;
  for (const seg of spec.bonus.wheel) if (seg.jackpot === id) w += seg.weight;
  return w / spec.bonus.wheelTotal;
};
