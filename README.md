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
(`tools/tiles`), and the first slot machine, [`slot3x3`](#slot3x3--a-three-by-three-slot-with-three-paylines),
on all five machines.

| Program | What it is | Status |
| --- | --- | --- |
| `main` | The lobby: a title screen that says how to run a lab | builds and runs on all five machines |
| `hello-reels` | Three text cells that cycle symbols when you press confirm | builds and runs on all five machines |
| `slot3x3` | A graphical 3×3 slot with three paylines, scrolling reels, bet and win | all five machines; the web uses a cell-step fallback |

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
  feel.*.8bs                   per machine: frames between redraws, pixels per redraw
  glyphs.*.8bs                 per machine: can glyphs be redefined, and how (C64, X16)
  cells.*.8bs                  per machine: write a raw screen code and ink (PET, VIC-20)
  bank.8bs                     exact six-digit credits
  layout.8bs                   where the block sits on a 22-, 40- or 80-column screen
  sound.8bs                    tick / stop / win / bonus hooks, empty until audio is wired in
src/labs/slot3x3/
  game.8bs                     the machine: spin, stop, evaluate, pay, flash (no pixels)
  view.8bs                     the reels where glyphs can be redefined, and the text fallback
  view.pet.8bs view.vic20.8bs  thin wrappers over quad.8bs
  quad.8bs                     the reels from the ROM's quadrant blocks (PET, VIC-20)
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
| C64 | the reel is 27 redefined characters; a frame rewrites their bytes from the symbol bitmaps, in assembly | 1 pixel | ~0.6 frames a reel | 7,768 B / 103 B |
| X16 | the same, through VERA's data port | 1 pixel | ~0.25 frames | 8,285 B / 197 B |
| PET | the reel is built from the 16 quadrant blocks in the character ROM | 4 pixels (one block row) | ~0.7 frames | 6,008 B / 100 B |
| VIC-20 | the same, with a colour for every cell | 4 pixels | ~0.9 frames | 6,376 B / 99 B |
| web | **fallback:** one character a symbol, redrawn when the symbol changes | 24 pixels | — | 1,032 B const / 68 B |

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
cost: the C64 steps 12 pixels every second frame, the X16 8 pixels every frame, the
PET and VIC-20 12 pixels (3 block rows) every third frame, and every machine eases
in to 2-pixel (the PET and VIC-20: 4-pixel) steps at the end.

### What a redraw costs

`scripts/measure-redraw.mjs` redraws one reel N times under each machine's own
emulator and finds when the program finishes, so the cost is a number, not a guess:
the C64's was 4.1 frames in compiled script, 2.1 with the copy in assembly, 1.0
with the row maths in assembly and **0.6 with the whole reel in one assembly call**.
Taking the redraw out of compiled code is what makes a reel hop every second frame
possible on a 1 MHz machine.

### Where it is not what it should be

- **The web uses the fallback** (one character a symbol, cell-step). Its redefinable
  glyph table holds 80 glyphs (codes 176–255) and a 3×3-cell reel window needs 81
  for the reels alone and 95 with the frame: a **shortfall of 15**. The
  tile pipeline can emit 16×16 symbols for the web (`"cells": {"web": [2, 2]}`),
  which needs about 50; the composer takes its sizes from the data and could use
  them, but that is not done here. (The web glyph table is also in no release of
  8BitScript yet.)
- **The VIC-20 has no RAM character set** here: the 8K program is linked from
  `$1201` upward over `$1C00`–`$1FFF`, the only RAM the video chip can read glyphs
  from, and there is no way yet to reserve a hole in the image. It uses the PET's
  quadrant composer instead, with colour — recognisable, and scrolling in 4-pixel
  steps, but blockier than the C64 and X16.
- **Tearing.** The reel redraw is not synchronised to the raster beam, so a
  headless screenshot taken mid-spin can catch half of one frame and half of the
  next (the tests skip those captures). It is invisible at rest; it reads as motion
  blur while a reel spins.
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
  position on its strip and only ever moves down it;
- **easing** — in the last frames of a spin the steps are small (≤ 12 pixels);
- **the win flash** — the paying lines blink and the reels come to rest as they were.

![the slot at rest on the PET, VIC-20, C64, X16 and web](docs/slot3x3/at-rest.png)

*The same spin (seed 145: a two-line win) at rest on, left to right, the PET, VIC-20, C64, X16 and web.*

### Per machine, as measured

Numbers are from `pnpm run test:machines` and `scripts/measure-redraw.mjs` on a Mac, NTSC, CLI 0.24.0.

| machine | builds | program / RAM | reels = engine's evaluator | reel hop while spinning | eases to | what it is |
| --- | :-: | --- | :-: | --- | --- | --- |
| C64 | yes | 7,768 / 103 B | exact, pixel for pixel | 12 px every 2nd frame | 2 px | composed glyphs, pixel art |
| X16 | yes | 8,285 / 197 B | exact, pixel for pixel | 8 px every frame | 2 px | composed glyphs through VERA, pixel art |
| PET | yes (4032, 32K) | 6,008 / 100 B | exact, block for block | 12 px (3 block rows) every 3rd frame | 4 px (1 block row) | quadrant blocks, no colour |
| VIC-20 | yes (8K) | 6,376 / 99 B | exact, block for block | 12 px every 3rd frame | 4 px | quadrant blocks, coloured |
| web | yes | 1,032 B const / 68 B | exact, symbol for symbol | 24 px (a symbol) each 2 frames | whole symbols | **cell-step fallback** |

**Falls back to cell-step: the web, and why.** The composer needs 81 glyphs for the
reels and 14 for the frame; the web's redefinable table (8BitScript #303, in no
release yet) holds 80, a shortfall of 15. So on the web a reel is three characters
a symbol (`7`, `B`, `C`, `L`, `.`) in a white ink, and it jumps a symbol at a time.
Two ways out, neither done here: the tile pipeline can emit 16×16 symbols for the
web (about 50 glyphs, which fit), or the quadrant composer (`quad.8bs`) can run on
the web's own 2×2 block glyphs at codes 128–143, which need no table at all — that
one needs the web's block order mapped to `QUAD_CODE`, and the web's `cells` twin.

## What the 5x5 reuses

`reelscroll`, `feel`, `glyphs`, `cells`, `bank` and `layout` take their sizes from
data and are the 5x5's as they are; `quad.8bs` and `view.8bs` are written for three
reels and need their reel count, window height and block width lifted into
constants (the 5×5 needs `REELS = 5`, `ROWS = 5`, 45 glyphs a reel on the glyph
machines, 225 in all against the C64's and X16's 127 free codes — so a 5×5 on those
machines wants either the 16×16 art or a second glyph bank, not a bigger table).


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

## The baseline

`baseline: 'c64'` in the config names the machine the labs are designed on.
`pnpm run build` (`8bs build --release`) prints, per artifact, what that build
is short of the baseline in the facts a program tests.

## CI

`.github/workflows/ci.yml` calls 8BitScript's reusable compile workflow, which
runs `8bs build --release` — every program on every machine — with the CLI
version pinned in `package.json`.

## License

MIT.

## Symbol art

Slot symbols are pictures turned into per-machine tables at build time by `tools/tiles` — real 24x24 pixel art on the C64, VIC-20, X16 and web, ROM block glyphs on the PET. Themes live in `assets/themes/`; see [docs/tiles.md](docs/tiles.md) and the contact sheets in `docs/tiles/`. `pnpm run test:tiles` runs the unit tests and, where VICE and x16emu are installed, checks the on-screen result pixel for pixel.
