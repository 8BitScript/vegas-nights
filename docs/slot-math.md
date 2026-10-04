# Slot math

`tools/slotmath` designs slot machines and **verifies their odds exactly**, then emits the
result as `export const` tables that an 8BitScript program indexes at run time. The 6502 does
no probability: it draws random bytes, looks things up and adds credits.

It is an offline tool (Node 26, no dependencies). Nothing here runs on a target machine.

```
node tools/slotmath/bin/slotmath.mjs list
node tools/slotmath/bin/slotmath.mjs report grid5x5          # the PAR sheet, as markdown
node tools/slotmath/bin/slotmath.mjs report grid5x5 --json
node tools/slotmath/bin/slotmath.mjs tune grid5x5            # the tuner's record
node tools/slotmath/bin/slotmath.mjs generate                # write src/generated/*.8bs and docs/par/*.md
node tools/slotmath/bin/slotmath.mjs check                   # exit 1 if a committed output is stale
node --test tools/slotmath/test/                             # the tests
```

## What this is not

Be clear about this before relying on any number here.

- **Not a regulated-lab certification.** Real slot odds are certified by accredited test labs
  against a jurisdiction's rules. Nothing here is, or claims to be, that. This is entertainment
  simulation: the point is that *the numbers the game shows and pays are the numbers the maths
  says*, not that any regulator has approved them.
- **Not a real-money system.** There is no wallet, no account, no payout. Credits are points.
- **Not a proof of fairness of the random generator.** The tool makes every draw *unbiased*
  (see below) but the quality of the bytes themselves is the program's PRNG's business.
- **Standalone jackpots only.** A progressive here is one machine's own meter. It is not linked
  to other machines or players.
- **A normal approximation, where it says so.** The "bankroll needed" table uses a normal
  approximation of the spin-by-spin result. Slot wins are heavy-tailed, so it understates tail
  risk. It is labelled as such in every PAR sheet.

## The model

A game has `reels` reels. Each reel has a strip of `stops` symbols (**`stops` is a power of two
up to 256**) and shows `rows` consecutive symbols, wrapping, starting at its stop. A spin picks
one stop per reel uniformly and independently, so there are `stops^reels` equally likely outcomes
(33,554,432 for 5 reels of 32).

**Unbiased draws.** One random byte per reel, masked with `stops - 1`, lands on every stop exactly
`256 / stops` times, so the stop is exactly uniform. The tool *refuses* a `stops` that is not a
power of two. This matters: the language's `random.range(n)` is `next() % n` over a byte, which is
biased for any `n` that does not divide 256. For 37 roulette pockets, 34 pockets come up 7 times in
256 and 3 pockets only 6 times. (`test/spec.test.mjs` demonstrates both.) Every table below is
designed so no modulo is ever needed.

All pays are **integer credits at the base bet** (`betCredits`). A higher bet multiplies every pay
by the bet multiple, so RTP does not change with bet - except where a jackpot only opens at a higher
bet (below).

### Pay modes

| Mode | A win is | Exact? |
|---|---|---|
| `line` | The longest run of one symbol from reel 1 along a fixed payline (a row index per reel). Wilds substitute for regular symbols. A line also competes with a pay for its leading wilds, and pays the larger. | exact |
| `ways` | A symbol on each of the first *n* reels (anywhere in the window); the pay is `PAYS[symbol][n]` x the number of ways = the product of the matching cells on each of those reels. | exact |
| `cluster` | A group of >= `cluster.min` connected cells (up/down/left/right) of one symbol, wilds joining any group they touch (a wild between two groups merges them). Pays by the largest listed size not above the group's. | Monte Carlo, or exact brute force on small copies |

Scatter and bonus symbols never substitute and never sit on a payline run.

### Features

- **Scatter pays and free spins.** `n` scatters anywhere pay `scatter.pays[n]` (credits at the base
  bet) and award `scatter.freeSpins[n]` free spins.
- **Free spins.** Each free spin uses the same reels, multiplies every win (including scatter pays)
  by `freeSpins.multiplier`, and - if `retrigger` - scatters inside it award more, until `cap` spins
  have been granted in all.
- **Bonus wheel.** `bonus.minCount` bonus symbols open a wheel: one byte, masked with
  `wheelTotal - 1`, picks a segment that pays credits or a jackpot.
- **Progressive jackpots** (`MINI`/`MINOR`/`MAJOR`/`GRAND`, any names), fed by the wheel
  (`via: 'wheel'`) or by a draw on every base spin (`via: 'spin'`, probability `num / den`, `den` a
  power of two). A **fixed-odds** jackpot has no meter. Each level has an `eligibleFromBet`.

## How the numbers are computed

### The joint distribution of a base spin

Everything about a base spin reduces to the joint distribution of three integers:
`(line win, scatter count, bonus-symbol count)`. Reels are independent, so it is built by walking
every combination of **distinct windows** per reel (a reel with `stops` stops has at most that many
distinct windows, each with a multiplicity). The walk is a depth-first search with **pruning**: once
no payline (or no way) can still pay, the remaining reels matter only for their scatter and
bonus counts, whose distribution is precomputed per suffix of reels. That is why a 5-reel 32-stop game
(33.5M outcomes) analyses in about half a second. The result is exact: weights are integers.

### Mean by linearity of expectation (the fast route)

For `line` and `ways`, the **mean** needs no joint distribution at all. By linearity, the expected line
pay is the sum over paylines of one small DP over reels (`line`), or a product of per-reel expectations
(`ways`: `E[prod c_i] = prod E[c_i]` by independence). The tuner uses this, so each step costs
milliseconds. The tests hold the two routes equal to 1e-12 on every shipped game.

### RTP, hit frequency, variance

With the joint distribution in hand, for every base outcome with probability `p`, immediate win `x`
(line pays + scatter pay), free-spin start `n`, and wheel trigger `t`:

```
W = x + S(n) + t * B                    one paid spin's total payout
E[W]   = sum p * (x + E S(n) + t E B)
E[W^2] = sum p * (x^2 + E S^2 + t E B^2 + 2x E S + 2x t E B + 2 E S * t E B)
```

(`S` and `B` are independent of each other and of `x` given the outcome class.) Progressives drawn on
every base spin are independent of the reels and added the same way; levels that **share one draw**
(disjoint ranges of the same value) are mutually exclusive, so their cross term is zero.

- **RTP** = `E[W] / betCredits`.
- **Hit frequency** = the probability that `x > 0` (a win on the spin, before free spins and jackpots).
- **Volatility** = `sqrt(E[W^2] - E[W]^2) / betCredits`, in bets per spin.
- **Win distribution** = the exact histogram of `x / betCredits` in bands.
- **Bankroll for N spins** at 95%/99% = `z * sigma * sqrt(N) + N * (1 - RTP)` with `z` = 1.645 / 2.326
  (normal approximation, floored at 0).

### Free-spin sessions (retrigger and the cap) - exact

A session starts with `n` spins. Play is a recursion over `(spins left, spins granted so far)`; each
spin has a joint outcome `(x, a)` = (win, spins it awards), `a = 0` if retrigger is off, and the
award is clipped so the total never exceeds `cap`. Writing `M1`, `M2` for the mean and second moment
of the session total:

```
M1(left, g) = sum_{(x,a)} p * (x + M1(left - 1 + e, g + e))       with e = min(a, cap - g)
M2(left, g) = sum_{(x,a)} p * (x^2 + 2x M1(...) + M2(...))
```

The table is filled from `g = cap` downward, so each cell uses only finished cells. With no
retrigger it collapses to `n` independent spins (`M1 = n E[x]`); with a high cap and award ratio `r < 1`
the expected length approaches the geometric `n / (1 - r)`. If scatters are so common that retriggering
is supercritical, the cap decides the session - the tests pin that case (`expectedSpins` returns
`cap`). Design rule: keep the expected extra spins per spin well under one.

### Progressive jackpots - closed form

A meter starts at `seed`, gains `c` credits on every bet spin, and resets to `seed` when it is won. If a
bet spin wins it with probability `p`, the number of spins `G` since the last win is geometric with
mean `1/p` and `E[G^2] = (2 - p)/p^2`, and the payout is `J = seed + c * G`:

```
E[J]   = seed + c / p
E[J^2] = seed^2 + 2 seed c / p + c^2 (2 - p) / p^2
RTP    = p * E[J] / bet = c / bet   (bet-funded)   +   p * seed / bet   (house-funded seed)
```

So a meter returns *exactly its contribution* to the players, plus the seed the house puts up each
time it resets. The PAR sheet splits the two. A fixed-odds jackpot pays `seed` with no meter. A jackpot
a bet has not opened is simply not paid (a wheel segment pays its `fallback` credits instead), so RTP rises
with the bet level, and the PAR sheet has a per-bet table. The meter's *size* at a win is random; its
variance is included in the volatility.

## Exact versus estimated

| Figure | Method |
|---|---|
| Line / ways pays, scatter pays, hit frequency, win histogram | **Exact** (integer enumeration) |
| Mean for line / ways | **Exact** (two independent routes, held equal) |
| Free-spin and retrigger value and variance | **Exact** (recursion on the exact joint distribution) |
| Wheel, jackpot meters, shared-draw ranges | **Exact** (closed form) |
| Cluster pays | **Monte Carlo** (`mulberry32`, fixed seed, 4,000,000 spins, 20 batches); the 95% interval is Student-t over batch means and **includes** the noise in the feature inputs |
| Bankroll for N spins | Normal approximation |
| Jackpot behaviour over time | Standalone meters, long-run averages (no finite-time simulation) |

The Monte Carlo estimator is validated against exact enumeration on an 8-stop copy of the cluster game
(`test/montecarlo.test.mjs`): two independent seeds both land inside 1.5x their own interval of the
exact value. The same seed always reproduces the same figure.

## The tuner

A spec's `tune` block names a target RTP, a tolerance, and **levers**: integer pay changes
(`{ pay: ['CHERRY', 1], step: 10 }`) or moving one stop between symbols
(`{ swap: { reel: 0, from: 'BLANK', to: 'BAR1' } }`). The search is a deterministic greedy
descent on `|RTP - target|` using the exact mean: try every lever in both directions, take the one that
lands closest to the target without overshooting past it, repeat until inside the tolerance. It stops at
once when inside, **fails loudly** if it cannot get there, and it **never breaks the paytable's order**
(a longer run never pays less; at the same run length a higher-ranked symbol never pays less).
The record - every move, run-length-compressed - is in each PAR sheet and the generated file header.
Cluster games have no closed-form mean, so they carry no tuner: their pays are set by hand against the
Monte Carlo estimate.

## What is emitted

`src/generated/<game>.8bs` is `export const` data - program image, **never RAM**. The header carries the
spec hash, the exact RTP and the table size. The tables:

| Name | Meaning |
|---|---|
| `REELS`, `ROWS`, `STOPS`, `STOP_MASK`, `BET_CREDITS` | geometry; `byte & STOP_MASK` is an unbiased stop |
| `SYM_<NAME>`, `SYMBOL_COUNT`, `WILD_SYMBOL`, `SCATTER_SYMBOL`, `BONUS_SYMBOL` | symbol ids |
| `STRIPS[reel * STOPS + stop]` | the symbol on each stop; a reel shows `ROWS` symbols from its stop, wrapping |
| `LINE_COUNT`, `LINES[line * REELS + reel]` | (line mode) the row each payline crosses |
| `PAY_WIDTH`, `PAY_SYMBOLS`, `PAYS[symbol * PAY_WIDTH + n]` | credits for a run (line), per way (ways) or a cluster of that size (expanded to every size) |
| `SCATTER_PAYS[n]`, `FREE_SPIN_AWARD[n]` | by scatter count |
| `FREE_SPIN_MULTIPLIER`, `FREE_SPIN_CAP`, `FREE_SPIN_RETRIGGER` | the round's rules |
| `BONUS_MIN_COUNT`, `WHEEL_SIZE`, `WHEEL_MASK`, `WHEEL_CREDITS`, `WHEEL_JACKPOT`, `WHEEL_FALLBACK` | the wheel, expanded to one entry per segment weight so a masked byte indexes it directly |
| `JACKPOT_COUNT`, `JACKPOT_SEED` (`uint` if any seed exceeds 65535), `JACKPOT_CONTRIB_Q8`, `JACKPOT_MIN_BET` | meters: seed, credits added per base-bet spin x256 (8.8 fixed point), smallest bet that opens it |
| `JACKPOT_DRAW_BYTES`, `JACKPOT_DRAW_MASK`, `JACKPOT_RANGE_FROM[]`, `JACKPOT_RANGE_TO[]` | the per-spin draw and each level's disjoint range of it |
| `DRAW_BYTES_PER_SPIN`, `DRAW_BYTES_PER_FREE_SPIN` | the random-byte budget |

### The draw plan

Per base spin the program draws, in this order: **one byte per reel** (`stop = byte & STOP_MASK`),
then **the jackpot draw** if any level is drawn per spin (`JACKPOT_DRAW_BYTES` little-endian bytes,
masked with `JACKPOT_DRAW_MASK`; level `i` wins if `JACKPOT_RANGE_FROM[i] <= value < JACKPOT_RANGE_TO[i]`),
then - **only if the bonus symbols landed** - **one byte for the wheel** (`index = byte & WHEEL_MASK`).
A free spin draws only the reels. Each PAR sheet ends with the plan for its game.
Emit supports one per-spin jackpot draw, or several that share a denominator (they become disjoint ranges
of one draw); other combinations are refused rather than silently merged.

## Adding a game

1. Copy a spec in `tools/slotmath/specs/` (`export default { ... }`). Give it a lower-case `id`.
2. List `symbols` (regular and wild first, then scatter, then bonus), `counts` per reel (each adding to `stops`),
   `pays`, and for `line` the `lines`.
3. Start the pays near the target - the tuner is for the last few percent, and the pay-ordering rule limits how far
   it can walk. If it fails, it says where it stopped.
4. `node tools/slotmath/bin/slotmath.mjs generate <id>`, read `docs/par/<id>.md`, and commit the spec **and** the two
   generated files together: `test/emit.test.mjs` fails if a committed output is stale.

## The shipped games

The full PAR sheets are `docs/par/<game>.md` (regenerated, byte-checked). Summary:

| | `classic3x3` | `grid5x5` | `video5x3` | `cluster5x5` |
|---|---|---|---|---|
| Layout | 3 reels x 3 rows, 3 lines (middle row + both diagonals) | 5 x 5, 3,125 ways | 5 x 3, 20 lines | 5 x 5 clusters (min 4) |
| Stops per reel | 64 | 32 | 32 | 32 |
| RTP | **93.982%** exact | **94.049%** exact | **94.961%** exact | **94.45% +/- 0.18%** Monte Carlo |
| Hit frequency | 1 in 3.50 | 1 in 1.23 | 1 in 2.02 | 1 in 2.38 |
| Volatility (bets/spin) | 6.77 | 5.55 | 5.67 | 1.87 (est.) |
| Base game / bonus round / jackpots | 84.2% / - / 9.8% | 64.3% / 23.9% / 5.9% | 70.7% / 18.0% / 6.3% | 88.8% / 5.6% / - |
| Bonus round | none | free spins x3, retrigger, cap 50, 1 in 74 | free spins x2 + wheel, 1 in 140 | free spins x2, 1 in 260 |
| Jackpots | one fixed 50x at 1 in 512 | MINI 1 in 1,024 / MINOR 1 in 4,096 / MAJOR 1 in 21,845 / GRAND 1 in 65,536 | MINI / MINOR on the wheel, MAJOR / GRAND mystery (1 in 2,246 / 8,983 / 21,845 / 65,536) | none |
| Table data | 262 bytes | 382 bytes | 1,097 bytes | 502 bytes |
| Random bytes per base spin | 5 | 7 | 7 (+1 if the wheel opens) | 5 |
| Random bytes per free spin | - | 5 | 5 | 5 |

`classic3x3` and `grid5x5` are the two first-priority games; `video5x3` and `cluster5x5` are the
heavier-feature and Monte Carlo demonstrations. Table data and the random-byte budget are what an 8-bit
program pays; a program that indexes `classic3x3`'s tables builds at 601 bytes of program on the VIC-20 and 895
on the C64 (`test/fixtures/probe-classic3x3.8bs`, `8bs build --size`).

## How it is verified

- **A second, naive implementation** (`test/naive.mjs`) of all three pay modes, written from the definitions with no
  DP, pruning or window compression. Tiny games are brute-forced through it and the engine's whole joint distribution must
  match, for line, ways and cluster pays, with and without wilds.
- **An independent full distribution** (`test/variance.test.mjs`): for a discrete game the distribution of one paid
  spin is built outcome by outcome (base win + a free-spin session tree + a wheel prize) and its mean and variance taken
  directly. The engine's moment algebra must agree.
- **Brute force of a shipped game** - `classic3x3`'s 262,144 outcomes - against the engine's RTP, hit frequency and variance.
- **Shrunken copies** of the larger shipped games (every fourth stop) against the naive evaluator.
- **Mutation checks**: the suite was run against deliberately broken copies of the engine (wild pays ignored, ways added
  instead of multiplied, a wrong geometric moment, a dropped variance cross term, a biased mask, a missing cap, a wrong
  bankroll sign, ...); every one is caught. Three early survivors drove tests for them.
- **The real compiler**: every emitted module passes `8bs check`, and a program that indexes the tables builds for
  `pet`, `vic20`, `c64`, `cx16` and `web` (needs an 8BitScript CLI: `$EIGHTBS_CLI`, or a sibling `../8bitscript` checkout).
- **Freshness**: regenerating every game must reproduce the committed `.8bs` and PAR sheet byte for byte.
