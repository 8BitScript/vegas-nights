// Cluster pays on a reels x rows grid: a connected group (up/down/left/right)
// of one symbol, wilds joining any group they touch, pays by its size once it
// reaches cluster.min. A wild between two groups counts toward both.
//
// There is no product form here - what pays depends on how the whole grid
// lines up - so the mean needs either brute-force enumeration (fine while
// stops**reels is small: the restricted validation variants) or sampling.

export function context(spec) {
  const kind = spec.symbols.map((s) => s.kind);
  const regular = spec.symbols.filter((s) => s.kind === 'regular' && spec.paysByIndex[s.index]).map((s) => s.index);
  const sizes = new Map(regular.map((s) => [s, Object.keys(spec.paysByIndex[s]).map(Number).sort((a, b) => a - b)]));
  return { kind, regular, sizes, wild: spec.wildIndex, reels: spec.reels, rows: spec.rows, min: spec.cluster.min };
}

function payForSize(ctx, spec, sym, size) {
  if (size < ctx.min) return 0;
  let best = 0;
  for (const n of ctx.sizes.get(sym)) if (n <= size) best = spec.paysByIndex[sym][n];
  return best;
}

/** Total pay of one grid; grid[reel][row] = symbol index. */
export function gridPay(spec, ctx, grid, scratch = new Uint8Array(spec.reels * spec.rows)) {
  const { reels, rows } = ctx;
  let total = 0;
  const stack = [];
  for (const sym of ctx.regular) {
    scratch.fill(0);
    for (let r0 = 0; r0 < reels; r0 += 1) {
      for (let k0 = 0; k0 < rows; k0 += 1) {
        const at = r0 * rows + k0;
        const c0 = grid[r0][k0];
        if (scratch[at] || c0 !== sym) continue; // a group is seeded by a real symbol, not a wild
        let size = 0;
        stack.length = 0;
        stack.push(at);
        scratch[at] = 1;
        const wilds = [];
        while (stack.length) {
          const cell = stack.pop();
          size += 1;
          const r = Math.floor(cell / rows);
          const k = cell % rows;
          for (const [dr, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const rr = r + dr;
            const kk = k + dk;
            if (rr < 0 || rr >= reels || kk < 0 || kk >= rows) continue;
            const nb = rr * rows + kk;
            const c = grid[rr][kk];
            if (c === sym && !scratch[nb]) { scratch[nb] = 1; stack.push(nb); }
            else if (c === ctx.wild && ctx.wild >= 0 && !scratch[nb]) { scratch[nb] = 2; wilds.push(nb); stack.push(nb); }
          }
        }
        total += payForSize(ctx, spec, sym, size);
        // Wilds join every group they touch, so release them for the next group of this symbol.
        for (const w of wilds) scratch[w] = 0;
      }
    }
  }
  return total;
}

export const expectedPay = null; // no closed form: enumerate (small) or sample

/** Brute force: every combination of distinct windows. Use only when stops**reels is small. */
export function enumerate(spec, windows, suffix, sink) {
  const ctx = context(spec);
  const { reels } = spec;
  const grid = new Array(reels);
  const scratch = new Uint8Array(spec.reels * spec.rows);
  function dfs(depth, sc, bn, weight) {
    if (depth === reels) { sink(gridPay(spec, ctx, grid, scratch), sc, bn, weight); return; }
    for (const w of windows[depth]) {
      grid[depth] = w.cells;
      dfs(depth + 1, sc + w.sc, bn + w.bn, weight * w.count);
    }
  }
  dfs(0, 0, 0, 1);
}

/** Monte Carlo: draw `n` spins with `rand` and report each through sink(lineWin, sc, bn, 1). */
export function sample(spec, windows, n, rand, sink) {
  const ctx = context(spec);
  const { reels, stops } = spec;
  const grid = new Array(reels);
  const scratch = new Uint8Array(spec.reels * spec.rows);
  // Map each stop to its window so a draw is one array read.
  const byStop = spec.strips.map((strip, i) => {
    const lookup = new Map(windows[i].map((w) => [w.cells.join(','), w]));
    return Array.from({ length: stops }, (_, t) => {
      const cells = [];
      for (let k = 0; k < spec.rows; k += 1) cells.push(strip[(t + k) % stops]);
      return lookup.get(cells.join(','));
    });
  });
  for (let s = 0; s < n; s += 1) {
    let sc = 0;
    let bn = 0;
    for (let i = 0; i < reels; i += 1) {
      const w = byStop[i][Math.floor(rand() * stops)];
      grid[i] = w.cells;
      sc += w.sc;
      bn += w.bn;
    }
    sink(gridPay(spec, ctx, grid, scratch), sc, bn, 1);
  }
}
