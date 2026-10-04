// The 5x5, again, in JavaScript — the oracle the 6502 side is held to. It mirrors
// src/labs/slot5x5/game.8bs line for line: the same LCG as @8bitscript/random, the
// same draw order (one byte & STOP_MASK per reel, then two jackpot bytes
// little-endian on a base spin; the reels only on a free spin), the same ways, scatter,
// free-spin, retrigger and jackpot rules, the same exact credits.
import { lcg } from './reference.mjs';

export const SEED = 2026;
export const START_CREDITS = 100_000; // 100 base bets of 1,000

/** The symbol a reel shows on `row` when its top row is stop `position`. */
export const symbolAt = (table, reel, position, row) => {
  const { STOPS, STOP_MASK } = table.consts;
  return table.arrays.STRIPS[reel * STOPS + ((position + row) & STOP_MASK)];
};

/** grid[reel][row] for a set of reel positions. */
export function gridAt(table, positions) {
  const { REELS, ROWS } = table.consts;
  return Array.from({ length: REELS }, (_, reel) => Array.from({ length: ROWS }, (__, row) => symbolAt(table, reel, positions[reel], row)));
}

/**
 * The base win (credits at the base bet), the scatters, and which rows of each reel took part in
 * a win — exactly what the game's evaluate() does.
 */
export function evaluate(table, positions) {
  const { REELS, ROWS, PAY_WIDTH, PAY_SYMBOLS, WILD_SYMBOL, SCATTER_SYMBOL } = table.consts;
  const { PAYS, SCATTER_PAYS } = table.arrays;
  const grid = gridAt(table, positions);
  const rowMask = new Array(REELS).fill(0);
  let win = 0;
  for (let p = 0; p < PAY_SYMBOLS; p += 1) {
    let ways = 1;
    let run = 0;
    for (let reel = 0; reel < REELS; reel += 1) {
      let count = 0;
      for (let row = 0; row < ROWS; row += 1) if (grid[reel][row] === p || grid[reel][row] === WILD_SYMBOL) count += 1;
      if (count === 0) break;
      ways *= count;
      run += 1;
    }
    const pay = PAYS[p * PAY_WIDTH + run];
    if (pay !== 0) {
      win += pay * ways;
      for (let reel = 0; reel < run; reel += 1) {
        for (let row = 0; row < ROWS; row += 1) if (grid[reel][row] === p || grid[reel][row] === WILD_SYMBOL) rowMask[reel] |= 1 << row;
      }
    }
  }
  let scatters = 0;
  for (const column of grid) for (const s of column) if (s === SCATTER_SYMBOL) scatters += 1;
  win += SCATTER_PAYS[scatters];
  if (table.arrays.FREE_SPIN_AWARD[scatters] !== 0) {
    for (let reel = 0; reel < REELS; reel += 1) for (let row = 0; row < ROWS; row += 1) if (grid[reel][row] === SCATTER_SYMBOL) rowMask[reel] |= 1 << row;
  }
  return { win, scatters, rowMask, grid };
}

/** What `spins` base spins from `seed` do, at bet level `betIndex`; free spins play themselves. */
export function play(table, spins, { betIndex = 0, seed = SEED, rng = null } = {}) {
  const c = table.consts;
  const a = table.arrays;
  const multiplier = a.BET_LEVELS[betIndex];
  let state = seed;
  const draw = rng ?? (() => { const r = lcg(state); state = r.state; return r.byte; });
  let credits = START_CREDITS;
  const meters = a.JACKPOT_SEED.slice();
  const results = [];
  for (let spin = 0; spin < spins; spin += 1) {
    credits -= c.BET_CREDITS * multiplier;
    for (let j = 0; j < c.JACKPOT_COUNT; j += 1) meters[j] += (a.JACKPOT_CONTRIB_Q8[j] >> 8) * multiplier;
    const stops = [];
    for (let reel = 0; reel < c.REELS; reel += 1) stops.push(draw() & c.STOP_MASK);
    const low = draw();
    const high = draw();
    const value = ((high << 8) | low) & c.JACKPOT_DRAW_MASK;
    let jackpot = -1;
    for (let j = 0; j < c.JACKPOT_COUNT; j += 1) {
      if (value >= a.JACKPOT_RANGE_FROM[j] && value < a.JACKPOT_RANGE_TO[j] && multiplier >= a.JACKPOT_MIN_BET[j]) jackpot = j;
    }
    const e = evaluate(table, stops);
    let win = e.win * multiplier;
    let jackpotPaid = 0;
    if (jackpot >= 0) { jackpotPaid = meters[jackpot]; win += jackpotPaid; meters[jackpot] = a.JACKPOT_SEED[jackpot]; }
    credits += win;
    const record = { stops, grid: e.grid, rowMask: e.rowMask, scatters: e.scatters, win, jackpot, jackpotPaid, credits, free: [], meters: meters.slice(), session: 0 };
    // the bonus round
    let award = a.FREE_SPIN_AWARD[e.scatters];
    if (award !== 0) {
      let left = award;
      let granted = award;
      let session = 0;
      while (left > 0) {
        left -= 1;
        const fstops = [];
        for (let reel = 0; reel < c.REELS; reel += 1) fstops.push(draw() & c.STOP_MASK);
        const fe = evaluate(table, fstops);
        const fwin = fe.win * multiplier * c.FREE_SPIN_MULTIPLIER;
        credits += fwin;
        session += fwin;
        const more = a.FREE_SPIN_AWARD[fe.scatters];
        if (more !== 0 && c.FREE_SPIN_RETRIGGER !== 0) {
          const extra = Math.min(more, c.FREE_SPIN_CAP - granted);
          left += extra;
          granted += extra;
        }
        record.free.push({ stops: fstops, grid: fe.grid, rowMask: fe.rowMask, scatters: fe.scatters, win: fwin });
      }
      record.session = session;
      record.granted = granted;
      record.credits = credits;
    }
    results.push(record);
  }
  return results;
}

/** Seeds (from 1) whose first base spin satisfies `want(record)`. */
export function findSeeds(table, want, { limit = 5, max = 65535, betIndex = 0 } = {}) {
  const out = [];
  for (let seed = 1; seed <= max && out.length < limit; seed += 1) {
    const [record] = play(table, 1, { seed, betIndex });
    if (want(record)) out.push(seed);
  }
  return out;
}
