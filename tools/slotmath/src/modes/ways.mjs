// "Ways to win": a symbol pays on its longest run of adjacent reels from reel 1
// that each show it (or a wild) anywhere in the window, and the pay is
// multiplied by the number of ways - the product of how many matching cells
// each reel in the run shows. A wild with its own pays counts only wilds.
//
// Reels are independent, so the mean pay of one symbol is a product of per-reel
// expectations (expectedPay); the joint distribution comes from a pruned
// enumeration (enumerate), as in line.mjs.

export function context(spec) {
  const paying = [];
  for (const s of spec.symbols) {
    if ((s.kind === 'regular' || s.kind === 'wild') && spec.paysByIndex[s.index]) paying.push(s.index);
  }
  const pay = paying.map((idx) => {
    const row = new Int32Array(spec.reels + 2);
    for (const [n, credits] of Object.entries(spec.paysByIndex[idx])) row[Number(n)] = credits;
    return row;
  });
  return { paying, pay, wild: spec.wildIndex, reels: spec.reels };
}

/** How many cells of `cells` count toward paying symbol `p`. */
function matching(ctx, cells, p) {
  let c = 0;
  for (const cell of cells) if (cell === p || (p !== ctx.wild && cell === ctx.wild)) c += 1;
  return c;
}

export function expectedPay(spec) {
  const ctx = context(spec);
  const { reels, rows, stops } = spec;
  let total = 0;
  ctx.paying.forEach((p, pi) => {
    // Per reel: E[c] and P(c = 0), with c the number of matching cells in the window.
    const mean = [];
    const zero = [];
    for (let i = 0; i < reels; i += 1) {
      let sum = 0;
      let zeros = 0;
      for (let t = 0; t < stops; t += 1) {
        const cells = [];
        for (let k = 0; k < rows; k += 1) cells.push(spec.strips[i][(t + k) % stops]);
        const c = matching(ctx, cells, p);
        sum += c;
        if (c === 0) zeros += 1;
      }
      mean.push(sum / stops);
      zero.push(zeros / stops);
    }
    // P(run is exactly n) weighted by the ways: prod_{i<n} E[c_i] * P(c_n = 0), or all reels.
    let runMean = 1;
    for (let n = 1; n <= reels; n += 1) {
      runMean *= mean[n - 1];
      const stop = n < reels ? zero[n] : 1;
      // E[ways * 1{run = n}] = prod_{i<n} E[c_i] * P(c_n = 0) - but E[c_i * 1{c_i>0}] = E[c_i].
      total += ctx.pay[pi][n] * runMean * stop * stops ** reels;
    }
  });
  return total;
}

export function enumerate(spec, windows, suffix, sink) {
  const ctx = context(spec);
  const { reels } = spec;
  const P = ctx.paying.length;
  // Per window, the matching-cell count for each paying symbol.
  const counts = windows.map((reel) => reel.map((w) => ctx.paying.map((p) => matching(ctx, w.cells, p))));
  // State per symbol: [alive, n, ways]
  const bufs = Array.from({ length: reels + 1 }, () => new Int32Array(P * 3));
  for (let p = 0; p < P; p += 1) bufs[0][p * 3] = 1;

  function dfs(depth, win, sc, bn, weight) {
    const cur = bufs[depth];
    if (depth === reels) {
      let w = win;
      for (let p = 0; p < P; p += 1) if (cur[p * 3]) w += ctx.pay[p][cur[p * 3 + 1]] * cur[p * 3 + 2];
      sink(w, sc, bn, weight);
      return;
    }
    const nxt = bufs[depth + 1];
    windows[depth].forEach((w, wi) => {
      nxt.set(cur);
      let winHere = win;
      let alive = 0;
      for (let p = 0; p < P; p += 1) {
        const o = p * 3;
        if (!nxt[o]) continue;
        const c = counts[depth][wi][p];
        if (c > 0) {
          nxt[o + 1] += 1;
          nxt[o + 2] = (nxt[o + 2] || 1) * c;
          alive += 1;
        } else {
          winHere += ctx.pay[p][nxt[o + 1]] * nxt[o + 2];
          nxt[o] = 0;
        }
      }
      const wt = weight * w.count;
      if (alive === 0) {
        for (const [key, count] of suffix[depth + 1]) {
          sink(winHere, sc + w.sc + Math.floor(key / 64), bn + w.bn + (key % 64), wt * count);
        }
      } else dfs(depth + 1, winHere, sc + w.sc, bn + w.bn, wt);
    });
  }
  dfs(0, 0, 0, 0, 1);
}
