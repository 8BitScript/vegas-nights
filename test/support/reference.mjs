// The game, again, in JavaScript — the oracle the 6502 side is held to. It
// mirrors src/labs/slot3x3/game.8bs line for line: the same LCG as
// @8bitscript/random, the same draw order (one byte & STOP_MASK per reel, then
// two jackpot bytes little-endian), the same window, run and payout rules, the
// same 16-bit saturation.

export const SEED = 2026;
export const START_CREDITS = 2000;

export function lcg(state) {
  const next = (state * 25173 + 13849) & 0xffff;
  return { state: next, byte: next >> 8 };
}

/** The stop shown on `row` of a reel whose top row is stop `position`. */
export function symbolAt(table, reel, position, row) {
  const { STOPS, STOP_MASK } = table.consts;
  return table.arrays.STRIPS[reel * STOPS + ((position + row) & STOP_MASK)];
}

export function windowAt(table, positions) {
  const { REELS, ROWS } = table.consts;
  const rows = [];
  for (let row = 0; row < ROWS; row += 1) {
    const cells = [];
    for (let reel = 0; reel < REELS; reel += 1) cells.push(symbolAt(table, reel, positions[reel], row));
    rows.push(cells);
  }
  return rows; // rows[row][reel]
}

/** Credits at the base bet that payline `line` pays for these reel positions. */
export function linePay(table, positions, line) {
  const { REELS, PAY_WIDTH } = table.consts;
  const first = symbolAt(table, 0, positions[0], table.arrays.LINES[line * REELS]);
  const second = symbolAt(table, 1, positions[1], table.arrays.LINES[line * REELS + 1]);
  const third = symbolAt(table, 2, positions[2], table.arrays.LINES[line * REELS + 2]);
  let run = 1;
  if (second === first) {
    run = 2;
    if (third === first) run = 3;
  }
  return table.arrays.PAYS[first * PAY_WIDTH + run];
}

const sat = (a, b) => Math.min(a + b, 65535);
const scaled = (amount, times) => {
  let total = 0;
  for (let i = 0; i < times; i += 1) total = sat(total, amount);
  return total;
};

/** What `spins` automatic spins from SEED do, at bet level `betIndex`. */
export function play(table, spins, { betIndex = 0, seed = SEED } = {}) {
  const c = table.consts;
  const a = table.arrays;
  const multiplier = a.BET_LEVELS[betIndex];
  let state = seed;
  let credits = START_CREDITS;
  const results = [];
  const draw = () => { const r = lcg(state); state = r.state; return r.byte; };
  for (let spin = 0; spin < spins; spin += 1) {
    credits -= c.BET_CREDITS * multiplier;
    const stops = [];
    for (let reel = 0; reel < c.REELS; reel += 1) stops.push(draw() & c.STOP_MASK);
    const low = draw();
    const high = draw();
    const jackpotDraw = ((high << 8) | low) & c.JACKPOT_DRAW_MASK;
    const jackpot = jackpotDraw >= a.JACKPOT_RANGE_FROM[0] && jackpotDraw < a.JACKPOT_RANGE_TO[0] && multiplier >= a.JACKPOT_MIN_BET[0];
    let base = 0;
    const lines = [];
    for (let line = 0; line < c.LINE_COUNT; line += 1) {
      const pay = linePay(table, stops, line);
      lines.push(pay);
      if (pay !== 0) base = sat(base, pay);
    }
    let win = scaled(base, multiplier);
    if (jackpot) win = sat(win, scaled(a.JACKPOT_SEED[0], multiplier));
    credits = sat(credits, win);
    results.push({ stops, window: windowAt(table, stops), jackpot, lines, win, credits });
  }
  return results;
}

/** Exact return and hit frequency of the table, by enumerating every outcome. */
export function enumerate(table) {
  const c = table.consts;
  const a = table.arrays;
  let paid = 0;
  let hits = 0;
  const total = c.STOPS ** c.REELS;
  const stops = new Array(c.REELS).fill(0);
  for (let n = 0; n < total; n += 1) {
    let rest = n;
    for (let reel = 0; reel < c.REELS; reel += 1) { stops[reel] = rest % c.STOPS; rest = Math.floor(rest / c.STOPS); }
    let base = 0;
    for (let line = 0; line < c.LINE_COUNT; line += 1) base += linePay(table, stops, line);
    paid += base;
    if (base > 0) hits += 1;
  }
  const jackpotOdds = (a.JACKPOT_RANGE_TO[0] - a.JACKPOT_RANGE_FROM[0]) / (c.JACKPOT_DRAW_MASK + 1);
  const lineRtp = paid / total / c.BET_CREDITS;
  const jackpotRtp = (jackpotOdds * a.JACKPOT_SEED[0]) / c.BET_CREDITS;
  return { lineRtp, jackpotRtp, rtp: lineRtp + jackpotRtp, hitFrequency: hits / total, jackpotOdds };
}
