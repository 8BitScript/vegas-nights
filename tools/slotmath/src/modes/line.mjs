// Fixed paylines, left to right. A line pays on its longest run of one symbol
// from reel 1 (wilds substituting; scatter and bonus symbols never do), and a
// run of wilds that has its own pay competes with the symbol run behind it:
// the line pays the larger.
//
// Two exact routes, which must agree (the tests hold them to it):
//   expectedPay - linearity of expectation, one DP per line. Fast; gives only
//                 the mean, which is all the tuner needs.
//   enumerate   - every outcome, pruned where no line can still pay, giving
//                 the full joint distribution (hit frequency, variance).

const PHASE_WILD = 0;   // only wilds so far
const PHASE_SYMBOL = 1; // a paying symbol has been fixed
const PHASE_DEAD = 2;   // the line has already been paid

export function context(spec) {
  const kind = spec.symbols.map((s) => s.kind);
  const pay = spec.symbols.map((s) => {
    const row = new Int32Array(spec.reels + 2);
    for (const [n, credits] of Object.entries(spec.paysByIndex[s.index] ?? {})) row[Number(n)] = credits;
    return row;
  });
  return { kind, pay, wild: spec.wildIndex, reels: spec.reels };
}

function terminalPay(ctx, phase, s, lw, n) {
  if (phase === PHASE_WILD) return ctx.wild >= 0 ? ctx.pay[ctx.wild][n] : 0;
  const run = ctx.pay[s][n];
  const wildRun = ctx.wild >= 0 && lw > 0 ? ctx.pay[ctx.wild][lw] : 0;
  return run > wildRun ? run : wildRun;
}

/** Advance one line by one cell; returns the pay if the line ends here. st = [phase, s, lw, n] at offset o. */
function step(ctx, st, o, cell) {
  const phase = st[o];
  if (phase === PHASE_DEAD) return 0;
  const k = ctx.kind[cell];
  if (phase === PHASE_WILD) {
    if (k === 'wild') { st[o + 3] += 1; return 0; }
    if (k === 'regular') { st[o] = PHASE_SYMBOL; st[o + 1] = cell; st[o + 2] = st[o + 3]; st[o + 3] += 1; return 0; }
    const p = terminalPay(ctx, PHASE_WILD, -1, 0, st[o + 3]);
    st[o] = PHASE_DEAD;
    return p;
  }
  if (cell === st[o + 1] || k === 'wild') { st[o + 3] += 1; return 0; }
  const p = terminalPay(ctx, PHASE_SYMBOL, st[o + 1], st[o + 2], st[o + 3]);
  st[o] = PHASE_DEAD;
  return p;
}

/** Sum, over every outcome, of the regular payline pay. Divide by stops**reels for the mean. */
export function expectedPay(spec) {
  const ctx = context(spec);
  const { reels, rows, stops } = spec;
  // rowCounts[reel][row] = Map(symbol -> stops showing it on that row)
  const rowCounts = spec.strips.map((strip) => {
    const perRow = [];
    for (let row = 0; row < rows; row += 1) {
      const m = new Map();
      for (let t = 0; t < stops; t += 1) {
        const c = strip[(t + row) % stops];
        m.set(c, (m.get(c) ?? 0) + 1);
      }
      perRow.push(m);
    }
    return perRow;
  });
  let total = 0;
  const st = new Int32Array(4);
  for (const line of spec.lines) {
    let dist = new Map([['0,-1,0,0', 1]]);
    for (let i = 0; i < reels; i += 1) {
      const next = new Map();
      const rest = stops ** (reels - 1 - i);
      for (const [key, count] of dist) {
        const base = key.split(',').map(Number);
        for (const [cell, m] of rowCounts[i][line[i]]) {
          st[0] = base[0]; st[1] = base[1]; st[2] = base[2]; st[3] = base[3];
          const p = step(ctx, st, 0, cell);
          if (p > 0) total += count * m * p * rest;
          if (st[0] !== PHASE_DEAD) {
            const k = `${st[0]},${st[1]},${st[2]},${st[3]}`;
            next.set(k, (next.get(k) ?? 0) + count * m);
          }
        }
      }
      dist = next;
    }
    for (const [key, count] of dist) {
      const [phase, s, lw, n] = key.split(',').map(Number);
      total += count * terminalPay(ctx, phase, s, lw, n);
    }
  }
  return total;
}

/**
 * Every outcome as sink(lineWin, scatterCount, bonusCount, weight): lineWin is the sum of
 * all line pays, weight the number of stop combinations. Once no line can pay any more, the
 * remaining reels only matter for their scatter/bonus counts, which `suffix` already holds.
 */
export function enumerate(spec, windows, suffix, sink) {
  const ctx = context(spec);
  const { reels } = spec;
  const L = spec.lines.length;
  const bufs = Array.from({ length: reels + 1 }, () => new Int32Array(L * 4));
  for (let l = 0; l < L; l += 1) { bufs[0][l * 4] = PHASE_WILD; bufs[0][l * 4 + 1] = -1; }
  const lines = spec.lines;

  function dfs(depth, win, sc, bn, weight) {
    const cur = bufs[depth];
    if (depth === reels) {
      let w = win;
      for (let l = 0; l < L; l += 1) {
        const o = l * 4;
        if (cur[o] !== PHASE_DEAD) w += terminalPay(ctx, cur[o], cur[o + 1], cur[o + 2], cur[o + 3]);
      }
      sink(w, sc, bn, weight);
      return;
    }
    const nxt = bufs[depth + 1];
    for (const w of windows[depth]) {
      nxt.set(cur);
      let winHere = win;
      let alive = 0;
      for (let l = 0; l < L; l += 1) {
        const o = l * 4;
        if (nxt[o] === PHASE_DEAD) continue;
        winHere += step(ctx, nxt, o, w.cells[lines[l][depth]]);
        if (nxt[o] !== PHASE_DEAD) alive += 1;
      }
      const wt = weight * w.count;
      if (alive === 0) {
        for (const [key, count] of suffix[depth + 1]) {
          sink(winHere, sc + w.sc + Math.floor(key / 64), bn + w.bn + (key % 64), wt * count);
        }
      } else dfs(depth + 1, winHere, sc + w.sc, bn + w.bn, wt);
    }
  }
  dfs(0, 0, 0, 0, 1);
}
