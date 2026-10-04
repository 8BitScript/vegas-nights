// Per-reel views of a spec: every distinct window a reel can show, how many
// stops show it, and the scatter/bonus counts in it. Reels spin independently,
// so an outcome is one window per reel and its probability is the product of
// (stops showing that window) / (stops). Everything exact below is a sum over
// these windows.

export function reelWindows(spec) {
  const { reels, rows, stops } = spec;
  const out = [];
  for (let r = 0; r < reels; r += 1) {
    const strip = spec.strips[r];
    const seen = new Map();
    for (let t = 0; t < stops; t += 1) {
      const cells = [];
      for (let k = 0; k < rows; k += 1) cells.push(strip[(t + k) % stops]);
      const key = cells.join(',');
      let w = seen.get(key);
      if (!w) {
        w = {
          cells,
          count: 0,
          sc: cells.filter((c) => c === spec.scatterIndex).length,
          bn: cells.filter((c) => c === spec.bonusIndex).length,
        };
        seen.set(key, w);
      }
      w.count += 1;
    }
    out.push([...seen.values()]);
  }
  return out;
}

export const featureKey = (sc, bn) => sc * 64 + bn;
export const unKey = (key) => [Math.floor(key / 64), key % 64];

/**
 * suffix[i] = the joint distribution of (scatter count, bonus count) over
 * reels i..end, as Map(featureKey -> number of outcomes). suffix[reels] is
 * the single empty outcome. The sum of a map is stops^(reels - i).
 */
export function suffixFeatures(windows) {
  const n = windows.length;
  const suffix = new Array(n + 1);
  suffix[n] = new Map([[featureKey(0, 0), 1]]);
  for (let i = n - 1; i >= 0; i -= 1) {
    const next = suffix[i + 1];
    const here = new Map();
    for (const w of windows[i]) {
      for (const [key, count] of next) {
        const [sc, bn] = unKey(key);
        const k = featureKey(sc + w.sc, bn + w.bn);
        here.set(k, (here.get(k) ?? 0) + count * w.count);
      }
    }
    suffix[i] = here;
  }
  return suffix;
}

/** Marginal distribution of the scatter count over all reels: Map(sc -> probability). */
export function scatterDistribution(spec, suffix) {
  const total = spec.stops ** spec.reels;
  const dist = new Map();
  for (const [key, count] of suffix[0]) {
    const [sc] = unKey(key);
    dist.set(sc, (dist.get(sc) ?? 0) + count / total);
  }
  return dist;
}

export function bonusTriggerProbability(spec, suffix) {
  if (!spec.bonus) return 0;
  const total = spec.stops ** spec.reels;
  let p = 0;
  for (const [key, count] of suffix[0]) {
    const [, bn] = unKey(key);
    if (bn >= spec.bonus.minCount) p += count / total;
  }
  return p;
}
