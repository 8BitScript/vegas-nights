// cluster5x5: the same 5x5 grid paid by connected clusters instead of ways.
// A cluster has no product form - what pays depends on how the whole grid lines
// up - so this game's numbers are MONTE CARLO estimates with a reported
// confidence interval, not exact. (The estimator is validated against exact
// brute-force enumeration on a restricted 8-stop variant of this very spec:
// see test/montecarlo.test.mjs.) 32 stops a reel, one byte per reel.
export default {
  id: 'cluster5x5',
  title: 'Cluster 5x5',
  mode: 'cluster',
  reels: 5,
  rows: 5,
  stops: 32,
  betCredits: 500,
  bets: [1, 2, 3, 5],
  arrangeSeed: 9,
  cluster: { min: 4 },
  symbols: [
    { id: 'RUBY', kind: 'regular' },
    { id: 'TOPAZ', kind: 'regular' },
    { id: 'JADE', kind: 'regular' },
    { id: 'PEARL', kind: 'regular' },
    { id: 'WILD', kind: 'wild' },
    { id: 'SCAT', kind: 'scatter' },
  ],
  // Four symbols and a wild: with this many matching cells a five-cell cluster is a
  // routine event, not a rarity. Scatters sit on the middle reels only.
  counts: [
    { RUBY: 8, TOPAZ: 8, JADE: 8, PEARL: 8 },
    { RUBY: 7, TOPAZ: 7, JADE: 7, PEARL: 8, WILD: 2, SCAT: 1 },
    { RUBY: 7, TOPAZ: 7, JADE: 7, PEARL: 8, WILD: 2, SCAT: 1 },
    { RUBY: 7, TOPAZ: 7, JADE: 7, PEARL: 8, WILD: 2, SCAT: 1 },
    { RUBY: 8, TOPAZ: 8, JADE: 8, PEARL: 8 },
  ],
  // Credits at the base bet of 500 for a cluster of exactly this size, or of the largest
  // listed size not above it. Hand-set against the Monte Carlo estimate (there is no tuner for
  // cluster pays: no closed form to descend on).
  pays: {
    RUBY: { 4: 1050, 6: 3150, 9: 10500, 13: 42000, 18: 65535 },
    TOPAZ: { 4: 785, 6: 2350, 9: 7850, 13: 31500, 18: 60000 },
    JADE: { 4: 525, 6: 1575, 9: 5250, 13: 21000, 18: 55000 },
    PEARL: { 4: 365, 6: 1095, 9: 3650, 13: 14600, 18: 50000 },
  },
  scatter: {
    symbol: 'SCAT',
    pays: { 3: 1000, 4: 5000, 5: 25000 },
    freeSpins: { 3: 8, 4: 12, 5: 20 },
  },
  freeSpins: { multiplier: 2, retrigger: true, cap: 40 },
};
