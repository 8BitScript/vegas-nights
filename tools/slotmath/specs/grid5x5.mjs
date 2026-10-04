// grid5x5: a 5x5 grid paid by ways (left to right, any row on each reel): 3125
// ways on a full grid, with a real bonus round and four progressive jackpot tiers.
//
//   Base game   - ways pays, 3+ of a kind from reel 1 (low symbols from 4), wilds substitute.
//   Bonus round - FREE SPINS: three or more scatters anywhere award 8/12/20 free spins at
//                 triple wins; scatters inside free spins award more (retrigger), up to a cap
//                 of 50 spins a round. Scatters sit on reels 1-4, one stop each, which makes
//                 the round open about once in 75 spins and keeps retriggering well sub-critical.
//   Jackpots    - MINI, MINOR, MAJOR, GRAND, "mystery" tiers: one 16-bit draw on every base spin,
//                 split into disjoint ranges, independent of the reels. Each is a meter that
//                 grows with every bet and resets to its seed when it hits.
//
// 32 stops a reel, so one byte per reel (masked with 31) picks a stop with no bias at all.
// This is the "5x5 reels" test case for the 8-bit machines: the maths is the cheap part
// (a symbol count per reel window), the drawing is the hard part - five rows of five symbols
// is 25 cells before a single raster trick.
const reel1 = { STAR: 2, MOON: 2, SUN: 3, COMET: 3, ORB: 4, RING: 5, BLANK: 12, SCAT: 1 };
const reel5 = { STAR: 2, MOON: 2, SUN: 3, COMET: 3, ORB: 4, RING: 5, BLANK: 13 };
const mid = { STAR: 2, MOON: 2, SUN: 2, COMET: 3, ORB: 4, RING: 5, BLANK: 11, WILD: 2, SCAT: 1 };

export default {
  id: 'grid5x5',
  title: 'Grid 5x5 Ways',
  mode: 'ways',
  reels: 5,
  rows: 5,
  stops: 32,
  betCredits: 1000,
  bets: [1, 2, 3, 5],
  arrangeSeed: 5,
  symbols: [
    { id: 'STAR', kind: 'regular' },
    { id: 'MOON', kind: 'regular' },
    { id: 'SUN', kind: 'regular' },
    { id: 'COMET', kind: 'regular' },
    { id: 'ORB', kind: 'regular' },
    { id: 'RING', kind: 'regular' },
    { id: 'BLANK', kind: 'regular' },
    { id: 'WILD', kind: 'wild' },
    { id: 'SCAT', kind: 'scatter' },
  ],
  counts: [reel1, mid, mid, mid, reel5],
  // Credits per way at the base bet of 1000 credits (so 1 credit is a thousandth of the bet).
  // On a 5-row reel a run of three is nearly certain, so the low symbols start paying at four.
  pays: {
    STAR: { 3: 120, 4: 560, 5: 2800 },
    MOON: { 3: 68, 4: 330, 5: 1650 },
    SUN: { 3: 42, 4: 200, 5: 990 },
    COMET: { 4: 120, 5: 560 },
    ORB: { 4: 68, 5: 330 },
    RING: { 4: 42, 5: 230 },
  },
  // Mystery jackpots: 3/65536 + 1/65536 + 16/65536 + 64/65536 of the draw's range. Seeds are credits
  // at the base bet of 1000, so MINI starts at 10x and GRAND at 1000x.
  progressives: [
    { id: 'MINI', seed: 10000, contribution: { num: 4, den: 1000 }, via: 'spin', prob: { num: 64, den: 65536 }, eligibleFromBet: 1 },
    { id: 'MINOR', seed: 50000, contribution: { num: 3, den: 1000 }, via: 'spin', prob: { num: 16, den: 65536 }, eligibleFromBet: 2 },
    { id: 'MAJOR', seed: 250000, contribution: { num: 2, den: 1000 }, via: 'spin', prob: { num: 3, den: 65536 }, eligibleFromBet: 3 },
    { id: 'GRAND', seed: 1000000, contribution: { num: 1, den: 1000 }, via: 'spin', prob: { num: 1, den: 65536 }, eligibleFromBet: 5 },
  ],
  scatter: {
    symbol: 'SCAT',
    pays: { 3: 2000, 4: 10000, 5: 50000 },
    freeSpins: { 3: 8, 4: 12, 5: 20 },
  },
  freeSpins: { multiplier: 3, retrigger: true, cap: 50 },
  tune: {
    target: 0.94,
    tolerance: 0.0005,
    levers: [
      { pay: ['RING', 4], step: 5 },
      { pay: ['ORB', 4], step: 5 },
      { pay: ['COMET', 4], step: 5 },
      { pay: ['SUN', 3], step: 5 },
      { pay: ['RING', 4], step: 1 },
      { pay: ['ORB', 4], step: 1 },
      { pay: ['COMET', 4], step: 1 },
      { pay: ['SUN', 3], step: 1 },
      { pay: ['MOON', 3], step: 1 },
      { pay: ['STAR', 3], step: 1 },
      { pay: ['RING', 5], step: 5 },
      { pay: ['STAR', 5], step: 50 },
      { pay: ['RING', 5], step: 1 },
      { pay: ['MOON', 5], step: 25 },
      { pay: ['SUN', 4], step: 5 },
      { pay: ['SUN', 4], step: 20 },
      { pay: ['MOON', 4], step: 20 },
      { pay: ['STAR', 4], step: 20 },
      { pay: ['COMET', 4], step: 10 },
      { pay: ['SUN', 3], step: 10 },
    ],
  },
};
