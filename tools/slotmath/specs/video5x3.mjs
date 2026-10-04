// video5x3: the modern video slot. Five reels, three rows, twenty fixed
// paylines, a wild, a scatter that awards free spins (with retrigger), a bonus
// symbol that opens a wheel, and four progressives - MINI, MINOR, MAJOR,
// GRAND - fed by the wheel and by the bet. 32 stops a reel: one byte per reel,
// masked with 31, picks a stop with no bias.
//
// Pays are credits at the base bet of 100 credits (5 credits a line).
// Higher bets scale every pay; the bigger progressives only open at higher bets
// (eligibleFromBet), so RTP per bet level differs - see the PAR sheet.
const LINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2], [1, 0, 1, 2, 1], [1, 2, 1, 0, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 2, 0, 0], [2, 2, 0, 2, 2], [0, 2, 0, 2, 0],
];

const edge = { GEM: 2, CROWN: 3, BELL: 3, CLOVER: 4, ACE: 4, KING: 4, QUEEN: 4, JACK: 6, SCAT: 1, BONUS: 1 };
const mid = { GEM: 2, CROWN: 3, BELL: 3, CLOVER: 4, ACE: 4, KING: 4, QUEEN: 3, JACK: 4, WILD: 3, SCAT: 1, BONUS: 1 };

export default {
  id: 'video5x3',
  title: 'Video 5x3',
  mode: 'line',
  reels: 5,
  rows: 3,
  stops: 32,
  betCredits: 100,
  bets: [1, 2, 3, 5, 10],
  arrangeSeed: 11,
  lines: LINES,
  symbols: [
    { id: 'GEM', kind: 'regular' },
    { id: 'CROWN', kind: 'regular' },
    { id: 'BELL', kind: 'regular' },
    { id: 'CLOVER', kind: 'regular' },
    { id: 'ACE', kind: 'regular' },
    { id: 'KING', kind: 'regular' },
    { id: 'QUEEN', kind: 'regular' },
    { id: 'JACK', kind: 'regular' },
    { id: 'WILD', kind: 'wild' },
    { id: 'SCAT', kind: 'scatter' },
    { id: 'BONUS', kind: 'bonus' },
  ],
  counts: [edge, mid, mid, mid, edge],
  pays: {
    GEM: { 3: 250, 4: 1000, 5: 5000 },
    CROWN: { 3: 150, 4: 500, 5: 2000 },
    BELL: { 3: 100, 4: 300, 5: 1000 },
    CLOVER: { 3: 60, 4: 200, 5: 600 },
    ACE: { 3: 30, 4: 100, 5: 300 },
    KING: { 3: 25, 4: 80, 5: 250 },
    QUEEN: { 3: 20, 4: 60, 5: 200 },
    JACK: { 3: 20, 4: 50, 5: 150 },
    WILD: { 3: 400, 4: 2000, 5: 10000 },
  },
  scatter: {
    symbol: 'SCAT',
    pays: { 3: 200, 4: 1000, 5: 5000 },
    freeSpins: { 3: 10, 4: 15, 5: 25 },
  },
  freeSpins: { multiplier: 2, retrigger: true, cap: 60 },
  bonus: {
    symbol: 'BONUS',
    minCount: 3,
    // A 128-segment wheel: one random byte, masked with 127. MINI and MINOR are on the
    // wheel; a jackpot segment pays its fallback in credits when the bet has not opened it.
    wheel: [
      { weight: 56, credits: 500 },
      { weight: 40, credits: 1000 },
      { weight: 22, credits: 2500 },
      { weight: 8, jackpot: 'MINI', fallback: 1000 },
      { weight: 2, jackpot: 'MINOR', fallback: 2500 },
    ],
  },
  // MINI and MINOR come off the wheel. MAJOR and GRAND are "mystery" jackpots: a
  // 16-bit draw on every spin, split into disjoint ranges, independent of the reels.
  progressives: [
    { id: 'MINI', seed: 2000, contribution: { num: 4, den: 1000 }, via: 'wheel', eligibleFromBet: 1 },
    { id: 'MINOR', seed: 10000, contribution: { num: 3, den: 1000 }, via: 'wheel', eligibleFromBet: 2 },
    { id: 'MAJOR', seed: 50000, contribution: { num: 2, den: 1000 }, via: 'spin', prob: { num: 3, den: 65536 }, eligibleFromBet: 3 },
    { id: 'GRAND', seed: 65000, contribution: { num: 1, den: 1000 }, via: 'spin', prob: { num: 1, den: 65536 }, eligibleFromBet: 5 },
  ],
  tune: {
    target: 0.95,
    tolerance: 0.0005,
    levers: [
      { pay: ['JACK', 3], step: 5 },
      { pay: ['QUEEN', 3], step: 5 },
      { pay: ['KING', 3], step: 5 },
      { pay: ['ACE', 3], step: 5 },
      { pay: ['CLOVER', 3], step: 5 },
      { pay: ['JACK', 3], step: 1 },
      { pay: ['ACE', 4], step: 5 },
      { pay: ['BELL', 4], step: 10 },
      { pay: ['GEM', 5], step: 100 },
      { pay: ['CROWN', 5], step: 50 },
      { pay: ['BELL', 5], step: 50 },
      { pay: ['CLOVER', 5], step: 20 },
    ],
  },
};
