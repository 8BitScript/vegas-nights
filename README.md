# Vegas Nights

A lab for **modern-style slot machines with real odds**, written in
[8BitScript](https://github.com/8BitScript/8bitscript) and built from one
source tree for the **PET, VIC-20, C64, Commander X16 and the web**.

The ambition is a casino simulation/RPG with several editions (Vegas, Monte
Carlo, Macau, Tokyo, Manila …). The first job is the slot machine: start with a
crude three-reel game, then find out what experience each machine can honestly
give — a bonus round, mini/minor/major/grand jackpots and a progressive meter,
five-reel and 5×5 layouts, and raster tricks inside the reels where the
hardware allows. The odds are computed, not guessed (see
[Generated tables](#generated-tables)).

**What exists today:** the odds engine (`tools/slotmath`), the symbol-art pipeline
(`tools/tiles`), and two slot machines on all five machines: [`slot3x3`](#slot3x3--a-three-by-three-slot-with-three-paylines)
and [`slot5x5`](#slot5x5--a-five-by-five-slot-with-a-bonus-round-and-four-jackpots).

| Program | What it is | Status |
| --- | --- | --- |
| `main` | The lobby: a title screen that says how to run a lab | builds and runs on all five machines |
| `hello-reels` | Three text cells that cycle symbols when you press confirm | builds and runs on all five machines |
| `slot3x3` | A graphical 3×3 slot with three paylines, scrolling reels, bet and win | all five machines; the web needs an 8BitScript newer than 0.24.0 (its glyph table, [below](#where-it-is-not-what-it-should-be)) |
| `slot5x5` | A graphical 5×5 ways slot with a free-spin bonus round and MINI/MINOR/MAJOR/GRAND meters | all five machines |

## Run it

Needs Node 26+ and pnpm 12+.

```sh
pnpm install
pnpm start                      # the lobby on the C64
pnpm start:c64                  # the lobby on a given machine (pet, vic20, c64, cx16, web)
pnpm start:hello-reels:vic20    # a lab on a given machine
pnpm run build                  # every program for all five machines -> dist/
pnpm start:slot3x3:c64          # the slot machine (or :pet :vic20 :cx16 :web)
pnpm run shot:hello-reels       # headless screenshots, all five -> shots/
```

`8bs run <machine>` opens the machine's emulator (VICE for the PET, VIC-20 and
C64, x16emu for the X16, a browser page for the web); `pnpm exec 8bs doctor`
says which emulators this computer has. `--screenshot file.png` captures a
still through the emulator's own API without opening a window; that is what
`pnpm run shot:*` does.

The PET is built as the 32K 4032 and the VIC-20 with the 8K expansion (see
`8bitscript.config.8bs`): the stock 4K PET 2001 and the unexpanded VIC-20 are
below what a lab needs.

### The C64 in the browser (wasm)

`8bs run c64 --web --program slot3x3` runs the C64 build in the editor's WASM tab
or an external browser instead of VICE, and `8bs run c64 --web --program slot5x5
--screenshot out.png` captures what that page draws, headlessly, with no emulator.
It is a model of the machine (text mode, no sprites or sound — `8bs targets --json`
lists the limits), and everything the slots use is in it: the redefined characters
the reels are composed from, the colour RAM, the border and background registers, the
portable raster list the bonus round's copper bars use, and the portable input.
Two files here exist only for it, because the C64's own are machine code the wasm
backend never lowers: `src/shared/glyphs.c64.web.8bs` composes a reel window in plain
loops (the assembly in `glyphs.c64.8bs` is ~6000 cycles of hand-written copy a wasm
build has no use for) and `src/shared/fx.c64.web.8bs` builds the bonus bars through
`@8bitscript/raster` instead of the C64's address-form list. The bars run down the side
borders and the empty rows under the panel; the machine's also run through the border
above and below the 200 picture lines, which a picture-line list cannot name.
`pnpm run test:c64web` runs the same exact-window tests the real machines get against
this build (it needs 8BitScript's `trunk` until a release has the C64 wasm port:
`EIGHTBS_CHECKOUT=/path/to/8bitscript`), and CI runs it.

## Layout

```
8bitscript.config.8bs      programs, targets, baseline, import aliases
src/lobby/                 the `main` program
src/labs/<lab>/main.8bs    one directory per lab; each is its own program
src/shared/                code the labs share (reel scroll, credits, glyph and cell layers)
src/generated/             tables emitted by tools/slotmath (committed)
src/i18n/                  message catalogs (empty so far)
scripts/shot.mjs           headless screenshots for a lab on every machine
.vscode/                   extension recommendation, icon theme, run tasks
```

Imports use two aliases from the config: `@shared/…` and `@generated/…`.

### Adding a lab

1. Make `src/labs/<name>/main.8bs` with an `export function main(): void`.
2. Add `'<name>': { entry: 'src/labs/<name>/main.8bs' }` to `programs` in
   `8bitscript.config.8bs`.
3. Add it to the `lab` list in `.vscode/tasks.json`, and the `start:<name>:*`
   and `shot:<name>` scripts to `package.json` if you want them.
4. `pnpm run build` must still build every program for every machine.

A program name is part of the output name. The PET's disk filenames are 16
characters, and the PET build appends `-pet-4032-32`, so a name of four
characters or fewer fits (`slot` → `slot-pet-4032-32`). A longer one still
builds, with a note that CBM DOS would truncate it on a real disk.

## slot3x3 — a three-by-three slot with three paylines

A real graphical slot machine, not text that looks like one: three reels of art
that scroll pixel by pixel behind a bevelled frame with payline arrows, with the
odds of [`src/generated/classic3x3.8bs`](src/generated/classic3x3.8bs) played
exactly. It runs on all five machines from one source tree.

```sh
pnpm start:slot3x3:c64      # or :pet :vic20 :cx16 :web
```

Confirm spins; up and down change the bet (1×, 2×, 3×, 5× of 100 credits). You
start with 2,000 credits and are re-staked when you run out.

**The rules.** Three reels, three rows, 64 stops a reel. Paylines: the middle
row and both diagonals. A line pays on the longest run of one symbol from the
first reel; a cherry on the first reel pays on its own. The paytable, in credits
at the base bet of 100:

| symbols on a line | pays |
| --- | ---: |
| 7 7 7 | 40,000 |
| BAR3 ×3 | 16,000 |
| BAR2 ×3 | 8,000 |
| BAR1 ×3 | 4,000 |
| cherry cherry cherry | 2,000 |
| cherry cherry | 1,000 |
| cherry (first reel) | 77 |

and a fixed-odds jackpot of 5,000 credits at the base bet on one spin in 512.
**Return to player 93.982%, a win on one spin in 3.50** (28.611%), volatility
6.77 bets a spin — all *exact*, enumerated over all 64³ = 262,144 outcomes by
`tools/slotmath`; the full PAR sheet is [`docs/par/classic3x3.md`](docs/par/classic3x3.md).
The 6502 code is held to it three ways (see [Tests](#tests)): `test/odds.test.mjs`
recomputes the return from the committed table with this repo's own payline
evaluator and must reproduce the engine's figure; and the machines' screens are
compared, pixel for pixel, with what that evaluator says a seeded spin produces.

Credits are exact at every bet. The 6502 backends do not lower 32-bit values, and
a 16-bit balance would quietly pay less than the table promises at the larger bets
(computed: 90.6% at ×5, because a 400× win is 200,400 credits). So the balance
and the win are two limbs of three decimal digits — [`src/shared/bank.8bs`](src/shared/bank.8bs) —
up to 999,999.

### How it is put together

```
src/generated/classic3x3.8bs   the odds (tools/slotmath): strips, paylines, paytable, jackpot
src/generated/tiles/           the art (tools/tiles): per-machine pixel or block tables
src/shared/
  reelscroll.8bs               where a reel is, in pixels, and the staged speed schedule
  symbolpx.*.8bs               per machine: how tall a symbol is (the speeds are cut from it)
  feel.*.8bs                   per machine: frames between redraws, pixels per redraw
  move.8bs scr.*.8bs           the 6502 block copy a reel hops with, and where a machine keeps its screen (PET, VIC-20)
  glyphs.*.8bs                 per machine: can glyphs be redefined, and how (C64, X16)
  cells.*.8bs                  per machine: write a raw screen code and ink (PET, VIC-20)
  bank.8bs                     exact six-digit credits
  layout.8bs                   where the block sits on a 22-, 40- or 80-column screen
  sound.8bs                    the game's sound hooks (tick / stop / win / big / bonus, mute) over sfx.8bs
src/labs/slot3x3/
  game.8bs                     the machine: spin, stop, evaluate, pay, flash (no pixels)
  view.8bs                     the reels where glyphs can be redefined (C64, X16), and the text fallback
  view.pet.8bs view.vic20.8bs  where the panel goes on each, and thin wrappers over quad.8bs
  view.web.8bs
  quad.8bs                     the reels from the quadrant blocks (PET, VIC-20, web): 6x6-cell symbols, table-driven
```

`game.8bs` knows reels, stops and pixels, never how to draw one. Everything it
draws goes through `view`, and everything machine-specific lives behind one small
twin file per concern, so a second machine type — the 5×5 — is a second data set
over the same files, not a second engine. A reel stop is one random byte & 63
(64 is a power of two, so the draw is exactly uniform) taken in the draw plan's
order; the reels then scroll to their stops, and the win is read off the symbols
they came to rest on.

**How a reel is drawn** depends on what the machine can do:

| machine | how | one pixel step is | measured redraw | program / RAM |
| --- | --- | --- | --- | --- |
| C64 | the reel is 48 redefined characters (4 across, 12 down) of 32×32-pixel symbols; a frame rewrites their bytes from the symbol bitmaps, in assembly | 1 pixel | ~0.8 frames a reel | 9,809 B / 119 B |
| X16 | the same, through VERA's data port | 1 pixel | ~0.25 frames | 8,285 B / 197 B |
| PET | the reel is built from the 16 quadrant blocks in the character ROM: 6×6-cell symbols (48 px), three precomputed tables, a 6502 block-copy hop | 4 pixels (half a block row) | 1.25 frames to redraw, **0.32 to hop** | 8,439 B / 121 B |
| VIC-20 | the same, with a colour for every cell (the hop moves the colour RAM too) | 4 pixels | 2.71 frames to redraw, **0.67 to hop 8 px, 0.83 for 16** | 9,452 B / 133 B |
| web | the reel is built from the host font's sixteen 2×2 block glyphs (codes 128–143) with a colour per cell, 6×6 cells a symbol; no runtime change, a reel is redrawn whole each step | 4 pixels (8 a frame while spinning) | free (the runtime) | 1,327 B const / 82 B |

On the glyph machines the screen map never moves: each cell of a reel always shows
the same character code, and a scroll step rewrites only those characters' bytes —
the window of the strip at the reel's pixel offset is copied out of the symbols'
bitmaps, a glyph's eight rows at a time. A cell takes the colour of whichever
symbol cell supplies most of its eight rows.

**How a reel moves.** A spin has five speeds, chosen by how far the reel still has
to go: the machine's *far* hop while more than a few symbols remain, then 12, 8, 4
and finally 2 pixels a redraw, each distance a multiple of the step before, so the
last step lands exactly on the drawn stop with the reel at rest — the picture never
decides the outcome. How often a reel is redrawn and how far it hops far out are
per-machine settings ([`feel.*.8bs`](src/shared)), set from the measured redraw
cost: the C64 hops a whole symbol (32 pixels) a redraw until four symbols from its stop and then 8, the X16 8 pixels and the web 8 pixels
every frame, the PET hops 8 pixels (one block row) every frame, the VIC-20 hops 16 (two
block rows) about every third frame, and every machine eases in to 2-pixel (the PET,
VIC-20 and web: 4-pixel) steps at the end.

### The C64's bigger machine

The C64 draws its reels from **32×32-pixel symbols (four cells square)**, where the X16 uses 24×24 (three).
The block is 16 cells across and 14 down — 22% of the 40×25 text grid, up from 14% — with the credit,
bet and win rows three rows lower. Symbols are drawn for the C64 at their own size
(`assets/themes/classic/art.mjs`, `variants.c64`; the theme says `"cells": {"c64": [4, 4]}`), not
squeezed from the 24×24 master: the extra eight pixels a side buy bevelled bars, a glint on every
symbol and a real word on BAR (`docs/tiles/classic.c64.png`).

![the C64's 3x3 before (24×24 symbols, 14% of the screen) and after (32×32, 22%): the same winning spin](docs/slot3x3/c64-before-after.png)

The same winning spin, before (left) and after: three BARs on the middle line.

A spin in motion on the new machine, eight consecutive frames each. Far from the stop a reel hops a
whole symbol at a time (frames 300–307, a blur); in the last stretch it eases through 8, 4 and 2 pixels
(frames 434–441). Frames 301 and 306, and the second reel in 434 and 437, show the tearing described below.

![eight consecutive frames of a C64 spin, far from the stop](docs/slot3x3/c64-spin-blur.png)

![eight consecutive frames of a C64 spin easing in to the stop](docs/slot3x3/c64-spin-ease-in.png)

**The glyph arithmetic**, which is the limit on a symbol's size (`test/glyph-budget.test.mjs` recomputes it):

| | 3×3-cell symbols (X16) | 4×4-cell symbols (C64) |
| --- | --- | --- |
| a reel window is 3 symbols tall | 9 cell rows × 3 = **27** glyphs | 12 cell rows × 4 = **48** glyphs |
| three reels | 81 | 144 |
| the frame (bevel, dividers, arrows, panel) | 14 | 14 |
| **in all** | **95** | **158** |
| codes the machine has | 127 (128–254) | **164** (91–254) |

The C64's character set has 256 codes, and 127 of them (128–254) are the reverse-video copies a program
that never prints reverse text may take — enough for 95, 31 short for 158. The 31 came from the codes
**below** them: screen codes 91–127 are PETSCII graphics in the mixed-case set, and the portable text
(letters, digits, a few marks) never draws any code above 90. That is 37 more, 164 in all, with six to
spare (`glyphs.EXTRA`). Nothing was squeezed: no de-duplication of blank cells, no fewer visible rows.
One catch: `text.putChar` reads its argument as ASCII and translates it, so codes 91–127 come out as the
letters a–z — the first capture of the new machine showed the alphabet in reel 0 — so the reels' cell map
is written raw (`glyphs.put`), and the glyph layer selects the mixed-case set itself (`begin()`), which
`text` used to do as a side effect of its first write.

### What a redraw costs, and what a hop saves

`scripts/measure-redraw.mjs` redraws one reel N times under each machine's own
emulator and finds when the program finishes, so the cost is a number, not a guess:
the C64's was 4.1 frames in compiled script, 2.1 with the copy in assembly, 1.0
with the row maths in assembly and **0.6 with the whole reel in one assembly call**.
Taking the redraw out of compiled code is what makes a reel hop every second frame
possible on a 1 MHz machine.

With 32×32 symbols the same call composes 384 bytes instead of 216 (48 glyphs, not 27) and costs
**0.82 frames** (0.57 before), plus about a third of a frame to colour 48 cells. The composer no longer
knows the symbol size: the symbols' addresses come from a table `glyphs.symbols()` fills, and the cell
width, height and window rows are arguments. A spin on the C64 is a little longer than before — reel 0
of the `lines` entry comes to rest at frame ~463 against ~424 — because a symbol is a third taller; a
16-pixel far hop was smoother but rested at ~565. The quadrant machines' trick below would help here too:
a reel that hops a *whole symbol* needs no recomposing in its lower eight cell rows, only a memory move
and the new symbol's four rows copied straight from the tile data — roughly half the redraw. That is
the next thing to try on the C64; it is not done.

The quadrant machines draw reels twice as big as they used to (6×6-cell symbols, 48 pixels: a reel window of
108 cells instead of 27), and recomposing every cell of a bigger
reel at every four-pixel step would have cost 3× what the old reels cost: **1.23 frames a reel on the PET
and 2.67 on the VIC-20**. So they do not recompose. A reel that moves a whole cell row (8 pixels) or two
does not change the pictures in its cells, it moves them: `quad.hop` copies the reel's rows down with a
6502 block copy (`src/shared/move.8bs`, 18 cycles a byte, the colour RAM too on the VIC-20) and composes only the
new top row or two from the tables. `scripts/measure-hops.mjs` times it the same way (frames per reel move,
boot and setup cancelling):

| frames per reel move | full redraw | hop 8 px | hop 16 px |
| --- | ---: | ---: | ---: |
| PET | 1.25 | **0.32** | 0.39 |
| VIC-20 | 2.71 | **0.67** | 0.83 |

— 3.9× and 4.0× cheaper, which is what lets the PET move all three reels 8 pixels every frame and the
VIC-20 a reel 16 pixels about every third. `test/hops.test.mjs` is the proof that it is only cheaper:
three reels walked twenty moves up their strips, once by the spin's own path and once with a full redraw
after every move, must end on the *same screen*, pixel for pixel (8 and 16 pixel moves, crossing several
symbol boundaries); breaking the 16-pixel copy makes it fail. Where the host owns the screen (the web)
there is nothing to copy and a reel is redrawn whole.

### Where it is not what it should be

- **The web and the pinned 8BitScript.** The web's 3×3 no longer needs the runtime's redefinable
  glyph table: it draws its reels from the host font's block glyphs like the PET, so it builds against
  0.24.0. (Its 5×5 and the C64-in-wasm still need an 8BitScript newer than the release.) The cost is the
  look: block graphics are blockier than the C64's and X16's pixel art, and the BAR symbols are told apart
  by how many bars they have, not by their lettering (the 12×12 grid cannot hold a word).
- **The VIC-20 has no RAM character set** here: the 8K program is linked from
  `$1201` upward over `$1C00`–`$1FFF`, the only RAM the video chip can read glyphs
  from, and there is no way yet to reserve a hole in the image. It uses the PET's
  quadrant blocks instead, with colour — recognisable, scrolling in 4-pixel steps,
  but blockier than the C64 and X16. The reels now fill the whole 22-column screen (87%).
- **Tearing.** The reel redraw is not synchronised to the raster beam, so a
  headless screenshot taken mid-spin can catch half of one frame and half of the
  next. On the quadrant machines this is a *seam*: a hop moves a reel's rows bottom-first, against
  the beam, so for the one frame in which the beam crosses the reel while the CPU is copying, the
  rows above the seam are the old picture and the rest the new (a four-pixel recompose writes
  top-first and leaves the old picture below). The motion test knows exactly this and accepts nothing
  else; it is invisible at rest and reads as motion blur while a reel spins. Making the three reels
  finish before the beam reaches the window would need each hop under 0.1 frame.
  The C64 recomposes whole windows, so a frame there can show a reel part old, part new.
  `scripts/tear-rate.mjs` counts the frames in which a reel shows no valid window of its strip: on
  the C64's old 24×24 machine **16 of 24** consecutive frames in the blur and **17 of 24** in the last stretch
  before the stop; on the 32×32 machine **4 of 24** and **12 of 24**, because it redraws less often.
  Fewer, not none: a redraw takes most of a frame and the beam crosses the reels in about a third of
  one, so the beam passes rows the composer has not reached. Ending it takes a double-buffered
  character set (two copies, flipped at the frame edge) or reels as hardware sprites; neither fits the
  glyph budget above.
- **Panels are text.** The credit, bet and win are in the machine's own font; the
  frame, dividers and payline arrows are graphics.
- **The jackpot is fixed-odds**, not a progressive meter, and there is no bonus
  round: that is the 5×5 lab.

### Tests

```sh
pnpm test                 # the odds, from the committed table; no emulator (this runs in CI)
pnpm run test:machines    # every machine, headless, under its own emulator (minutes)
MACHINES=c64,web pnpm run test:machines
```

`test/composer-offsets.test.mjs` (part of `test:machines`) holds each reel composer, in both
games, to the picture the tile data and the strip say: it draws the reels pinned at every
pixel offset a composer works at (all eight within a cell row on the pixel machines, 0 and 4
on the quadrant ones; `src/labs/slot3x3/offsets.8bs` and `src/labs/slot5x5/offsets.8bs`, which
read `--define ROW` and `STOP`) and compares every pixel. It needs `EIGHTBS_CHECKOUT`, because
`#define` is on 8BitScript's trunk and in no release yet. The sampled spin tests alone missed a
C64 composer bug that was wrong at six of the eight offsets.

`test/hops.test.mjs` (part of `test:machines`, `src/labs/slot3x3/hops.8bs`) holds a hop to the picture a
full redraw makes — see [What a redraw costs, and what a hop saves](#what-a-redraw-costs-and-what-a-hop-saves).

`test/glyph-budget.test.mjs` (in `pnpm test`, so CI runs it) is where the C64's and X16's geometry is worked
out: `src/labs/slot3x3/block.8bs` and `block.c64.8bs` state the machine's size as plain literals (the
compiler folds a literal, and a 1 MHz machine should not compute them), and this test recomputes every
one from the tile data and the engine's reels and rows, checks the reels and the frame fit the glyph
codes the machine has, that the tileset and strips fit the RAM the composer reads, and that the hop
divides a symbol. It fails when the art's size changes and a literal does not.

`test/odds.test.mjs` enumerates all 64³ outcomes through the payline evaluator and
holds the result to the engine's exact RTP and hit frequency, checks that the
strips and the art cover the same symbols, and that the generator's masked stops
are exactly uniform over its whole period.

`test/machines.test.mjs` runs on each machine whose emulator is installed. A ruler
program (two solid blocks) and a glyph sheet calibrate the screenshot to the text
grid; then:

- **exact** — four headless entries play from fixed seeds (a loss, a two-payline
  win, small wins, the jackpot) and each reel on the screen must equal, pixel for
  pixel (C64, X16) or block for block (PET, VIC-20), the picture the oracle says
  the drawn stop gives; WIN, CREDIT and BET must match digit for digit;
- **scrolling** — frame after frame while a spin runs, each reel is at a real
  position on its strip and only ever moves down it (on the quadrant machines a frame may show one
  *seam* between two adjacent positions — the beam crossing a reel while it is being rewritten — and
  nothing else);
- **easing** — in the last frames of a spin the steps are small (≤ 12 pixels);
- **the win flash** — the paying lines blink and the reels come to rest as they were.

![the slot at rest on the PET, VIC-20, C64, X16 and web](docs/slot3x3/at-rest.png)

*The same spin (seed 145: a two-line win) at rest on, left to right, the PET, VIC-20, C64, X16 and web.*

### Per machine, as measured

Numbers are from `pnpm run test:machines` and `scripts/measure-redraw.mjs` on a Mac, NTSC, CLI 0.24.0.

| machine | builds | program / RAM | reels = engine's evaluator | reel hop while spinning | eases to | what it is |
| --- | :-: | --- | :-: | --- | --- | --- |
| C64 | yes | 9,809 / 119 B | exact, pixel for pixel | 32 px (a symbol) a redraw far out, 8 within four symbols | 2 px | composed glyphs, 32×32 pixel art |
| X16 | yes | 9,517 / 198 B | exact, pixel for pixel | 8 px every frame | 2 px | composed glyphs through VERA, 24×24 pixel art |
| PET | yes (4032, 32K) | 8,439 / 121 B (was 6,689 / 108) | exact, block for block | 8 px every frame (3 reels) | 4 px | 6×6-cell quadrant blocks, no colour; 44% of the screen (was 14%) |
| VIC-20 | yes (8K) | 9,452 / 133 B (was 7,254 / 111) | exact, block for block | 16 px about every 3rd frame | 4 px | 6×6-cell quadrant blocks, coloured; 87% of the screen (was 28%) |
| web | yes | 1,327 B const / 82 B (was 798 / 78) | exact, block for block | 8 px every frame | 4 px (over the last 32) | 6×6-cell blocks of the host font, coloured; 44% of a 40×25 grid (34% of the Modern host's) |

**The reels got bigger.** The quadrant machines (PET, VIC-20, web) draw 6×6-cell symbols, 48 pixels
a side, twice what they drew before, so the 3×3 fills 44% of a 40×25 screen (it was 14%) and the whole
width of the VIC-20 (22 of 22 columns). The art is cut from tables the tile pipeline emits for any symbol
size (`tools/tiles/src/quadtables.mjs`, [docs/tiles.md](docs/tiles.md)), from symbols drawn by hand on
the 12×12 grid: at that size the master's lettering and fine detail are a smudge.

The PET, a few frames into a spin (frames 215–220 of the `lines` entry): the reels slide down by
whole block rows, with a symbol cut by the window's edge:

![the PET mid-spin](docs/slot3x3/pet-spin.png)

The web, a few frames into a spin:

![the web slot mid-spin](docs/slot3x3/web-spin.png)

## slot5x5 — a five-by-five slot with a bonus round and four jackpots

A graphical 5x5 slot on all five machines: five framed reels of art that scroll pixel by
pixel (or quadrant row by quadrant row), paid by *ways* — a symbol pays on its longest run of
adjacent reels from the first that each show it, or a wild, anywhere in the window, times the
number of ways — with a free-spin bonus round and four progressive jackpot meters, played at
the exact odds of [`src/generated/grid5x5.8bs`](src/generated/grid5x5.8bs).

```sh
pnpm start:slot5x5:c64      # or :pet :vic20 :cx16 :web
```

Confirm spins; up and down change the bet (1×, 2×, 3×, 5× of 1,000 credits). You start with
100,000 credits and are re-staked when you run out.

![the 5x5 on the PET, VIC-20, C64, X16 and web](docs/slot5x5/at-rest.png)

*The same spin (seed 33: a 6,100-credit win) at rest on, left to right, the PET, VIC-20, C64, X16 and web.*

**The rules** (the proof is [`docs/par/grid5x5.md`](docs/par/grid5x5.md)). Five reels, five rows,
32 stops a reel (so one random byte & 31 is an exactly uniform stop), 9 symbols (STAR, MOON, SUN,
COMET, ORB, RING, BLANK, WILD, SCATTER). Low symbols pay from four of a kind, the top three from
three; the wild substitutes for every symbol but the scatter. **Three or more scatters anywhere**
pay and start the **bonus round**: 8, 12 or 20 free spins at **triple wins**, with scatters inside
the round awarding more (a retrigger), up to 50 free spins in all. **MINI, MINOR, MAJOR and GRAND**
are mystery jackpots — one 16-bit draw on every base spin, split into disjoint ranges (1 in 1,024,
4,096, 21,845 and 65,536), each opening at a higher bet (1×, 2×, 3×, 5×). Each is a meter that starts at
its seed (10,000 / 50,000 / 250,000 / 1,000,000 credits at the base bet), grows with every bet, and
resets to the seed when it is won.

| | exact |
| --- | --- |
| **Return to player** | **94.049%** (base game 64.303%, bonus round 23.878%, jackpots 5.868%) |
| Hit frequency | a win on one spin in 1.23 |
| The bonus round opens | about one spin in 74 |
| Volatility | 5.549 bets a spin |

The base game's share is held to the engine *over all 33,554,432 reel positions* by
`test/odds5.test.mjs`, and the bonus round's rules (triple wins, retrigger, the cap) by
simulation with a proper generator; see [Tests](#tests-1).

**Rules this lab adds that the table does not fix.** A jackpot's meter grows by `JACKPOT_CONTRIB_Q8 / 256`
credits for every *base bet* of a spin (so a bet of ×5 feeds it five times as much) and is paid as it stands, not
multiplied by the bet; a bet below a jackpot's opening bet cannot win it. Free spins cost nothing, take no
jackpot draw, and leave the meters alone. These are this game's choices, written in `game.8bs` and
`test/support/reference5.mjs` and tested against each other; the engine's PAR sheet is for the
bet-funded meter at its opening bet.

Credits are exact to 999,999,999: [`src/shared/purse.8bs`](src/shared/purse.8bs) keeps each number as three
decimal limbs of three digits, because the 6502 backends do not lower 32-bit values and the GRAND
seed alone is 1,000,000.

### The bonus round's full-screen look (`fx`)

While the free spins run, the game calls three hooks (`fx.begin()`, `fx.frame(tick)`, `fx.end()`) that a
machine can fill in with something that happens to the whole picture rather than to the reels. The
portable file [`src/shared/fx.8bs`](src/shared/fx.8bs) does nothing and costs nothing (the four
6502 builds are byte for byte the size they were), and a machine that can do better replaces it with
its own `fx.<machine>.8bs`. Today only the web has one: copper bars in the border and in the rows
under the panel, scrolling down the screen, with the panel and reels left on black.

![the web's bonus round: bars in the border, a few frames apart](docs/fx/web-bonus-a.png)
![the same, twenty frames later](docs/fx/web-bonus-b.png)

[`docs/fx.md`](docs/fx.md) is the brief for writing the others (C64, X16, VIC-20, PET): the surface,
what the game promises, what each machine's raster layer gives, and how to prove an effect on screen.
`test/fx.test.mjs` (in CI) holds every twin to the same four members; `test/fx.machines.test.mjs`
(`pnpm run test:machines`) checks the border is plain before the round, barred and moving during it,
and plain again after.

### How the 5x5 is put together

```
src/generated/grid5x5.8bs        the odds (tools/slotmath): strips, paytable, scatter pays, free-spin awards, jackpots
src/generated/tiles/cosmic*.8bs  the art (tools/tiles): 16x16 symbols on the C64/X16/web tileset, 6x6 quadrant ones on the PET/VIC-20
src/shared/purse.8bs             exact credits, nine digits, in named registers (balance, win, session, four meters)
src/shared/glyphs.*.8bs          + the pre-composed strip buffer and the straight copies out of it
src/labs/slot5x5/
  game.8bs                       the machine: spin, stop, ways, scatters, free spins, jackpots, pay, flash (no pixels)
  spin.8bs                       how a reel moves: the 3x3's schedule with a symbol 16 or 24 pixels tall
  view.8bs                       the reels where glyphs can be redefined (C64, X16); a text fallback elsewhere
  view.pet/vic20/web.8bs         thin wrappers over quad.8bs
  quad.8bs  quadcode*.8bs  ink*.8bs   the quadrant-block composer, its block codes and its colours
```

The **language cannot pass an array to a function**, so a reel view has to name its own tables:
`view.8bs` and `quad.8bs` are per-lab copies of the 3x3's, with their geometry (five reels, a window
of five symbols, 2 or 3 cells a symbol) in constants; everything that does not name a table —
`purse`, the glyph and cell layers, `layout`, `feel`, `sound` — is shared with the 3x3.

**How a reel is drawn** depends on what the machine can do:

| machine | how | one hop is | program / RAM |
| --- | --- | --- | --- |
| C64 | each reel is **20 redefined characters** (two cells by ten) holding a window of five 16x16 symbols. At start-up every reel's two glyph columns are laid out as whole strips of bytes in RAM (512 rows a column + the first 80 again), so a window at *any pixel offset* is ten glyphs' worth of **consecutive bytes**: a redraw is two straight copies in assembly, and the colours are copied the same way | 8 pixels | 10,899 B / 105 B |
| X16 | the same, through VERA's data port, the colours written cell by cell (it is fast enough) | 8 pixels | 17,173 B / 176 B |
| PET | the reel is built from the 16 quadrant blocks in the character ROM (a symbol is 6x6 of them, a reel 15 cells by 3), no colour | 12 pixels | 9,077 B / 95 B |
| VIC-20 | the same, with a colour for every cell | 12 pixels | 9,686 B / 96 B |
| web | the same quadrant composer on the host font's 2x2 blocks (codes 128-143, in the very order the composer works out), in colour | 8 pixels | 1,160 B const / 161 B |

Why 16x16 and not the 3x3's 24x24 on the glyph machines: five reels of 24x24 symbols are 225 glyphs
against the 127 codes free on the C64 and X16; the 16x16 art (two cells a symbol) needs 100 for the reels and 14 for
the frame. The web has 80 redefinable glyphs, 20 short of that, so it takes the quadrant route instead — which
needs no glyphs at all.

**Floors.** The VIC-20 build needs the 8K expansion (9,686 B of program against an 11,775-byte ceiling;
the unexpanded machine's 3,583 and the +3K's 6,655 are short by 6,103 and 3,031 bytes); the PET needs 16K
or more (9,077 B against the 15,359 of the 16K model; the 8K model's 7,167 is 1,910 short). These are arithmetic against the catalog's
`memory.ram`; the config builds the PET as the 32K 4032 and the VIC-20 with 8K.

### Where it is not what it should be

- **The 5×5 has not been enlarged yet.** On the PET and web it could be 26 columns wide with 4×4-cell symbols and
  the panel moved to the side of the reels; the tables and the hand-drawn 8×8 art for that (`cosmic.quad*.8bs`,
  `overrides.quad4` / `quad3` in `assets/themes/cosmic/art.mjs`) are generated and tested already, and the
  hop is size-independent, but the 5×5's own composer and panel still use the old 3×3-cell symbols. The VIC-20's
  22 columns cannot hold more than they do now (5 reels × 4 cells + 1 = 21).

- **The reels move slower than the 3x3's.** Five reels redraw in the time three did, so a C64 reel
  hops 8 pixels about every third frame (about 3 pixels a frame), the PET and VIC-20 hop 12 pixels
  every few frames, and the VIC-20 is the slowest (about 1 pixel a frame). It reads as a spinning
  reel, not as a blur; redrawing the quadrant reels in assembly, as the C64's are, is the way to more.
- **The bonus round is not yet a mode of its own.** It changes the frame's colours every few frames,
  the title for a "FREE SPINS" banner where the screen has one, and shows the counter and ×3; the
  full-screen, demoscene-style presentation (raster bars, palette cycling, a different reel set) is the next step.
- **The jackpots are standalone meters**, not linked between machines, and reset when the program does.
  A jackpot win shows the message and the meter reset; there is no celebration yet.
- **No sound** beyond the empty hooks in `src/shared/sound.8bs`.
- **Tearing.** The reel redraw is not synchronised to the raster beam, so a headless screenshot taken
  mid-spin can catch half of one frame and half of the next (the tests allow for it). It is invisible at rest.
- **Panels are text**; the frame, dividers and the reels are graphics.

### Tests

```sh
pnpm test                 # the odds: both slots, from the committed tables; no emulator (this runs in CI)
pnpm run test:machines    # every machine, headless, under its own emulator (many minutes; the X16 runs in real time)
MACHINES=c64,web node --test test/slot5x5.machines.test.mjs
```

`test/odds5.test.mjs` runs the 5x5's rules, in JavaScript, over every one of the 33,554,432 reel positions and
requires the mean to equal the engine's exact ways + scatter return (61.132% + 3.171%) to within 1e-12; plays
300,000 spins of the full rules with a proper generator and requires the return including the bonus round
to be the engine's (88.18% without the jackpots) to within sampling error; holds the jackpot seeds `game.8bs` keeps
by hand (the 6502 backends cannot read the generated 32-bit ones) to the generated file's; and checks that each
headless entry's seed shows what the entry is for.

`test/slot5x5.machines.test.mjs` runs on each machine whose emulator is installed. A ruler program calibrates
the screenshot to the text grid and the 3x3's glyph sheet names the digits; then:

- **exact** — three headless entries play one spin from a fixed seed (a loss; a 6,100-credit win on several ways at once;
  the MINI jackpot) and each of the five reels on the screen must equal, pixel for pixel (C64, X16) or quadrant block for
  block (PET, VIC-20, web), the picture the oracle says the drawn stop gives; CREDIT, BET, WIN and all four jackpot meters
  must match digit for digit;
- **the bonus round** — from the entry whose first spin lands three scatters, the free-spin counter is read at five points of
  the round (counting down from 8, never above what was granted), and once the round is over the credit is exactly the
  oracle's: eight free spins at triple wins; and for the entry whose round retriggers (16 free spins), the same, which holds
  the retrigger and the cap to the oracle too;
- **scrolling** — sampled frame after frame while a spin runs, every reel is at a real position on its strip and only
  ever moves down it.

![the bonus round on the C64](docs/slot5x5/bonus-c64.png)

*The bonus round on the C64, mid-round: the banner, the free-spin counter (FS 04 X3), the frame pulsing.*

### Per machine, as measured

Numbers are from `pnpm run test:machines` on a Mac, NTSC, CLI 0.24.0.

| machine | builds | program / RAM | reels = the oracle's | bonus round (8 and 16 free spins) = the oracle's | reels move (measured) | what it is |
| --- | :-: | --- | :-: | :-: | --- | --- |
| C64 | yes | 10,899 / 105 B | exact, pixel for pixel | exact credit | 8-pixel hops, about 2.7 px a frame | composed glyphs, pixel art, colour |
| X16 | yes | 17,173 / 176 B | exact, pixel for pixel | exact credit | 8-pixel hops, about 3.5 px a frame | composed glyphs through VERA, pixel art, colour |
| PET (4032, 32K) | yes | 9,077 / 95 B | exact, block for block | exact credit | 12-pixel hops, about 3.4 px a frame | quadrant blocks, no colour |
| VIC-20 (8K) | yes | 9,686 / 96 B | exact, block for block | exact credit | 12-pixel hops, about 1 px a frame | quadrant blocks, coloured |
| web | yes | 1,160 B const / 161 B | exact, block for block | exact credit | 8-pixel hops every frame, about 8 px a frame | quadrant blocks on the host font, coloured |

Every cell above passed in one full run of `test/slot5x5.machines.test.mjs` on each machine against the code in this change
(7 tests a machine). "About N px a frame" is the mean step between screenshots taken five frames apart while a spin runs
(a frame is the machine's 50 or 60 Hz refresh; the web's is the host's), so it is a mean over hops, not a hop.

## Cursor / VS Code

Open this folder in Cursor and accept the recommended extension,
`8bitscript.8bitscript-lang` (from Open VSX in Cursor). It gives `.8bs`/`.8bx`
syntax colouring, diagnostics, hover, go-to-definition and completion through
`8bs lsp` from this project's own `node_modules`, the file icons, and the
launcher view that reads `8bitscript.config.8bs`.

The extension's Run and Build buttons do not name a program, so they run
`main` (the lobby). To run a **lab**, use **Terminal → Run Task → Run lab** and
pick the lab and the machine, or a `pnpm start:<lab>:<machine>` script.

Known problems with the toolchain this was built on (0.24.0), found while
setting this up:

- **False `8BS2001 … cannot find package '@8bitscript/c128'` errors** on every
  `import … from "@8bitscript/text"` (also `screen`, `input`) in the editor and
  from `pnpm run check`, because the resolver looked in the wrong place under
  pnpm. Fixed in 8BitScript
  [#297](https://github.com/8BitScript/8bitscript/pull/297); until a release
  carries it, expect those squiggles. Builds are not affected, so CI does not
  run `pnpm run check` yet.
- **`random.range(n)` does not build** on the 6502 machines in 0.24.0 (fixed on
  8BitScript trunk, #298). The slot draws a reel stop from `random.next() & 63`:
  64 stops is a power of two, so that is exactly uniform.

## Generated tables

Slot odds are computed offline and committed as `.8bs` data. `tools/slotmath/`
(arriving in its own change) enumerates every reel-stop combination of a
machine's definition, proves its return-to-player and hit frequency exactly,
and writes the reel strips and paytables to `src/generated/`. A lab imports
those tables as `const` arrays, so they live in the program image, not RAM.
Nothing is hand-tuned in a lab, and changing a paytable means regenerating and
re-reading the proof.

## Sound

`src/shared/sfx.8bs` is the slot machines' sounds — a reel tick, a reel stop,
a small win, a big win and the bonus fanfare — through `@8bitscript/audio`'s
`audio.tone`. Call `sfx.update()` once a frame instead of `audio.update()`, and
`sfx.tick()`, `sfx.stop()`, `sfx.win()`, `sfx.big()`, `sfx.bonus()` when
something happens. A jingle is a run of (note, frames) steps in two const arrays,
so it is data in the program image; a new effect cuts the one sounding off. All
notes are inside C4..B5 (the `.8ba` index 48..71), the range the PET's one-bit
speaker, the VIC-I, the SID and the X16's PSG all play without moving a note by
an octave. A sound is timed in calls of `sfx.update()`: a loop that overruns a
frame stretches a sound by that frame.

`pnpm run start:sound-test:<machine>` is the lab: it plays all five effects once
as it starts, then up/down choose and confirm plays. `pnpm run sound` is the
check: it builds the lab, records each machine's audio headlessly (VICE in
console mode at 2% volume, x16emu on SDL's dummy drivers, the web as the
rendered register timeline of the compiled program) and measures the pitch of
every note of every effect against the note it names. No window opens and
nothing worth hearing plays. It needs an 8BitScript checkout that has
`audio.tone` (`EIGHTBS_CHECKOUT`, default `../8bitscript`); the recording of
VICE's audio needs macOS.

What that check found: every note of every effect is the pitch it names on the
C64 (it reads the SID's registers: exact), the X16 and the web (exact), the PET
(a recorded WAV; a 50 ms note has only a few cycles to count, so those read to
about 40 cents and the long ones to within a few), and within the VIC-I's own
7-bit divisor on the VIC-20 (up to 50 cents flat or sharp; its table is NTSC and
a PAL VIC-20 plays about a semitone and a half sharp). The web's sound has **not been heard**: no
browser tab was available. One VIC-20 step is a frame long: the first step of
`big` measures 4.95 frames where its neighbours measure 4.00, and the cause is
not found.

`audio.tone` and `audio.NOTE_HIGH` are in 8BitScript's trunk, not in the
released 0.24.0, so `sound-test` does not build with the pinned CLI until the
release after that. CI builds with 8BitScript's trunk until then (the comment
in `.github/workflows/ci.yml` says how to go back); on a developer machine set
`EIGHTBITSCRIPT_CHECKOUT` to an 8BitScript checkout.

### Sound in the slot

`slot3x3` plays its sounds through `src/shared/sound.8bs`, which is `sfx` behind
a mute switch. What you hear: a tick as the reels step (once a frame, however many
reels moved), a stop as a reel comes to rest, and when the spin settles a win
jingle for a pay, a longer one for a big pay (twenty bets or more, `BIG_WIN` in
`game.8bs`), the fanfare for the jackpot, and for a loss the last reel's stop.
The cancel key mutes and unmutes. A frame plays at most one effect, and the frame
that settles the spin plays only its result: a stop struck under the jingle would
leave the SID's gate open, so the jingle's first note would not retrigger.

What it costs (`8bs build --target <t> --program slot3x3`, program bytes /
variable bytes, before sound, after):

| machine | before | with sound | added |
| --- | --- | --- | --- |
| PET 4032 32K | 6008 / 100 | 6689 / 108 | +681 / +8 |
| VIC-20 8K | 6376 / 99 | 7172 / 108 | +796 / +9 |
| C64 | 7768 / 103 | 9241 / 114 | +1473 / +11 |
| X16 | 8290 / 197 | 9334 / 197 | +1044 / 0 |
| web (const data) | 732 / 68 | 798 / 74 | +66 / +6 |

`pnpm run sound:slot` is the check that a spin sounds right. It builds the four
headless slot programs (a loss, a small win, a big win, the jackpot), whose last
spin's result the odds oracle knows, records each machine's audio, and compares
the LAST sound with the effect that result calls for, note by note (and that
reel ticks and stops came before it). The SID and the VIC-I are read from VICE's
register dump, the web from its per-frame voice, and the PET and X16 from the
WAV: there the notes are the pitches that hold for a few milliseconds, in order,
because a recording's time is not the logical frame (the PET's frame measures
about 58 Hz, the X16's steps are not evenly spaced in the WAV). Like `pnpm run
sound` it needs an 8BitScript checkout with `audio.tone` (`EIGHTBS_CHECKOUT`,
default `../8bitscript`, and `EIGHTBITSCRIPT_CHECKOUT` for the cli) and macOS for
VICE's audio. The on-screen tests (`pnpm run test:machines`) take the same
`EIGHTBITSCRIPT_CHECKOUT`.

## The baseline

`baseline: 'c64'` in the config names the machine the labs are designed on.
`pnpm run build` (`8bs build --release`) prints, per artifact, what that build
is short of the baseline in the facts a program tests.

## CI

`.github/workflows/ci.yml` calls 8BitScript's reusable compile workflow, which
runs `8bs build --release` — every program on every machine — with the CLI
version pinned in `package.json`. A second job, `c64web`, runs the on-screen tests
(`pnpm run test:c64web`) against the C64 built through wasm: exact reel windows, credit,
win and jackpot meters for the 3x3 and the 5x5, the free-spin rounds, the bonus bars.
They need no emulator, which is why they can run on a runner at all; the same tests
against the real machines (`pnpm run test:machines`) need VICE and x16emu.

## License

MIT.

## Symbol art

Slot symbols are pictures turned into per-machine tables at build time by `tools/tiles` — real 24x24 pixel art on the C64, VIC-20, X16 and web, ROM block glyphs on the PET. Themes live in `assets/themes/`; see [docs/tiles.md](docs/tiles.md) and the contact sheets in `docs/tiles/`. `pnpm run test:tiles` runs the unit tests and, where VICE and x16emu are installed, checks the on-screen result pixel for pixel.
