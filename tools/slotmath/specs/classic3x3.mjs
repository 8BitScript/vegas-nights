// classic3x3: the baseline machine. A 3x3 grid of symbols with exactly three paylines -
// the middle row and the two diagonals - sevens and bars and cherries, and a small
// fixed-odds jackpot. 64 stops a reel, so one random byte per reel (masked with 63)
// picks a stop with no bias at all.
//
// A reel shows three symbols (its stop and the two below it); a line pays on its
// longest run of one symbol from reel 1, and a cherry run pays from a single cherry.
// Pays are credits at the base bet of 100 credits; 100 credits is "1x".
export default {
  id: 'classic3x3',
  title: 'Classic 3x3',
  mode: 'line',
  reels: 3,
  rows: 3,
  stops: 64,
  betCredits: 100,
  bets: [1, 2, 3, 5],
  arrangeSeed: 3,
  // middle row, then the diagonal down and the diagonal up
  lines: [[1, 1, 1], [0, 1, 2], [2, 1, 0]],
  symbols: [
    { id: 'SEVEN', kind: 'regular' },
    { id: 'BAR3', kind: 'regular' },
    { id: 'BAR2', kind: 'regular' },
    { id: 'BAR1', kind: 'regular' },
    { id: 'CHERRY', kind: 'regular' },
    { id: 'BLANK', kind: 'regular' },
  ],
  counts: [
    { SEVEN: 2, BAR3: 3, BAR2: 5, BAR1: 7, CHERRY: 6, BLANK: 41 },
    { SEVEN: 2, BAR3: 3, BAR2: 5, BAR1: 7, CHERRY: 6, BLANK: 41 },
    { SEVEN: 2, BAR3: 3, BAR2: 5, BAR1: 7, CHERRY: 6, BLANK: 41 },
  ],
  pays: {
    SEVEN: { 3: 40000 },
    BAR3: { 3: 16000 },
    BAR2: { 3: 8000 },
    BAR1: { 3: 4000 },
    CHERRY: { 1: 200, 2: 1000, 3: 2000 },
  },
  // A small fixed-odds jackpot: a flat 50x on a one-in-512 draw, independent of the reels.
  progressives: [
    { id: 'JACKPOT', seed: 5000, fixed: true, via: 'spin', prob: { num: 1, den: 512 } },
  ],
  tune: {
    target: 0.94,
    tolerance: 0.0005,
    levers: [
      { pay: ['CHERRY', 1], step: 10 },
      { pay: ['CHERRY', 1], step: 1 },
      { pay: ['CHERRY', 2], step: 10 },
      { pay: ['CHERRY', 3], step: 10 },
      { pay: ['BAR1', 3], step: 100 },
      { pay: ['BAR2', 3], step: 100 },
      { pay: ['BAR3', 3], step: 100 },
      { pay: ['SEVEN', 3], step: 1000 },
      { swap: { reel: 0, from: 'BLANK', to: 'BAR1' } },
      { swap: { reel: 1, from: 'BLANK', to: 'BAR1' } },
      { swap: { reel: 2, from: 'BLANK', to: 'BAR1' } },
    ],
  },
};
