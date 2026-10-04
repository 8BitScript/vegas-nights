# Symbol art: PNG to per-machine tables

`tools/tiles` turns a theme's symbol artwork into const tables an 8BitScript program
indexes. The art is made once, as pictures; the pipeline decides, at build time, what
each machine can show of it and writes that down as data. Nothing is converted on the
machine (the repository rule: what is knowable at compile time never reaches the 6502).

```
assets/themes/<theme>/
  theme.json        name, the engine game it dresses, palette, symbol size in cells
  symbols/<ID>.png  one picture per symbol id of the game (48x48 RGBA, any size works)
  symbols/<ID>.pet.png   optional hand-tuned art at the PET's 6x6 pseudo-pixels
  frame.json        the reel-window cells (ring, dividers, payline arrows, panel)
  art.mjs           optional: procedural source that writes the PNGs above
src/generated/tiles/<theme>.8bs, <theme>.<machine>.8bs     what the programs import
docs/tiles/<theme>.<machine>.png                           contact sheets, no emulator needed
```

Two themes ship: **classic** (`classic3x3`: SEVEN BAR3 BAR2 BAR1 CHERRY BLANK, neon fruit
machine) and **cosmic** (`grid5x5`: STAR MOON SUN COMET ORB RING BLANK WILD SCAT).
Symbol ids and order come from the engine spec (`tools/slotmath/specs/<game>.mjs`), never
from the theme, so the art cannot drift from the odds tables: the test fails if a symbol is
missing or the order differs from `SYM_*` in `src/generated/<game>.8bs`.

## Commands

```
pnpm run tiles:art classic       # draw the procedural art into symbols/*.png (themes with an art.mjs)
pnpm run tiles:build classic     # symbols + frame -> src/generated/tiles/classic*.8bs
pnpm run tiles:preview classic   # contact sheets -> docs/tiles/classic.<machine>.png
pnpm run tiles:check             # fail if a committed table is not what `build` writes now
pnpm run test:tiles              # unit tests, plus the emulator cell-exact tests where VICE/x16emu exist
pnpm run shot:tile-test          # headless screenshots of the on-machine proof (shots/)
```

## Picking a theme in a program

Import one name; the machine-twin rule (`tile.pet.8bs` beside `tile.8bs`) picks the file:

```ts
import { SYMBOL_BITMAP, SYMBOL_COLOR, SYMBOL_BYTES, SYMBOL_CELLS, SYMBOL_CELLS_W, SYMBOL_CELLS_H,
         FRAME_BITMAP, FRAME_COLOR, FRAME_TL /* ... */ } from "@generated/tiles/classic.8bs";
```

Swapping to another theme is changing that import path. **Caution:** a theme's PET file has a
different set of names (below), so a portable game imports through its own small adapter
(`src/labs/tile-test/board*.8bs` shows one per machine). The base file is the C64's; the VIC-20,
X16, web and PET have twins.

## The two table shapes

`TILE_MODE` says which: **1 = pixels**, **0 = quadrants**.

### Pixels (C64, VIC-20, X16, web)

A character cell is 8x8 pixels, 1 bit each, **one ink colour per cell**; the paper (the 0 bits)
is the screen background, global on all four machines. A symbol is `SYMBOL_CELLS_W x
SYMBOL_CELLS_H` cells (3x3 = 24x24 pixels by default).

| const | meaning |
| --- | --- |
| `ART_SYMBOLS`, `SYMBOL_CELLS_W/H`, `SYMBOL_CELLS`, `SYMBOL_BYTES` | counts; `SYMBOL_BYTES` = cells x 8 |
| `ART_<ID>` | the symbol's index, in the engine's order |
| `SYMBOL_BITMAP[symbol * SYMBOL_BYTES + cell * 8 + pixelRow]` | the row byte; `cell = cellRow * SYMBOL_CELLS_W + cellCol` |
| `SYMBOL_COLOR[symbol * SYMBOL_CELLS + cell]` | the machine's **own** colour number for that cell's ink (the VIC-20's are 0-7) |
| `BIT0_IS_LEFT` | `false`: bit 7 is the leftmost pixel (C64, VIC-20, X16). `true`: bit 0 is (the web's glyph table; `classic.web.8bs` has every row byte mirrored) |
| `BACKGROUND_COLOR` | the paper colour the art was made against (black) |
| `FRAME_CELLS`, `FRAME_<NAME>`, `FRAME_BITMAP[frameCell * 8 + row]`, `FRAME_COLOR[frameCell]` | the reel window's cells |

### Quadrants (PET)

The PET has no bitmap and no redefinable glyphs, but its character ROM holds all sixteen 2x2
block patterns, so a 3x3-cell symbol is 6x6 pseudo-pixels. Scroll granularity is one
pseudo-pixel row (a cell is two).

| const | meaning |
| --- | --- |
| `SYMBOL_PIXEL_ROWS`, `SYMBOL_PIXEL_COLS`, `SYMBOL_BYTES` | 6, 6, 6 |
| `SYMBOL_PIXELS[symbol * SYMBOL_BYTES + row]` | one byte per pseudo-pixel row, bit 7 leftmost |
| `QUAD_CODE[topLeft<<3 \| topRight<<2 \| bottomLeft<<1 \| bottomRight]` | the screen code for that block |
| `FRAME_CODE[frameCell]` | the screen code to print for each frame cell |

`QUAD_CODE` = `32, 108, 123, 98, 124, 225, 255, 254, 126, 127, 97, 252, 226, 251, 236, 160`.
It was read from the real character ROMs (PET `characters-2`, C64 and VIC-20 `chargen`), not
recalled: codes 96-127 hold eight patterns and bit 7 reverses a glyph, so the other eight are
those +128. The test re-derives it from the ROMs when VICE's data is installed, and it is the
same table `@8bitscript/pet/blocks` uses.

### Quadrant tables (PET, VIC-20, web: any symbol size)

A theme with `"quad": { "default": 6, "web": 6 }` (cells a side) also gets, for the three machines that build
a reel from 2×2 block glyphs, `<theme>.quad.8bs` (PET), `<theme>.quad.vic20.8bs` and `<theme>.quad.web.8bs`
(the machine's twin is chosen by the build, as for any file). A symbol is `QUAD_S` × `QUAD_S` cells, each a
2×2 picture, so `2·QUAD_S` square "pseudo-pixels" of four screen pixels. A display cell of a scrolling reel
takes two consecutive pseudo-pixel rows of the window, so its screen code is one of three precomputed tables
and a redraw is one read and one write a cell:

| table | index | the cell for |
| --- | --- | --- |
| `QUAD_C0` | `(symbol * S + k) * S + c` | rows 2k and 2k+1 of the symbol (the window starts on an even row) |
| `QUAD_C1` | `(symbol * (S - 1) + k) * S + c` | rows 2k+1 and 2k+2 (an odd start), k < S - 1 |
| `QUAD_CX` | `(symbol * QUAD_SYMBOLS + next) * S + c` | the last row of `symbol` over the first row of `next` |
| `QUAD_K` | `(symbol * S + k) * S + c` | the ink of symbol cell (k, c) — only where there is colour |

`src/labs/slot3x3/quad.8bs` is the composer. The shape of a symbol is the master PNG resampled to the grid, or,
if the theme has `symbols/<ID>.quad<S>.png`, that hand-drawn image (`art.mjs` `overrides.quad6`): the three
BAR symbols are told apart by how many bars they have because the master's lettering does not survive 12×12.
The ink always comes from the colour master. `test/pipeline.test.mjs` decodes every table back to the
symbols' pseudo-pixels and checks C1 and CX cover exactly the rows they claim.

### The frame

Every theme supplies the same 14 cells (`frame-kit.mjs` makes them; a theme sets the colours or
writes its own `frame.json`): `TL T TR L R BL B BR` (the ring), `DIV DIVT DIVB` (between reels,
and where the divider meets the top and bottom of the ring), `ARROW_L ARROW_R` (replace `L`/`R`
at the payline row), `PANEL` (outside). A window is: the ring around `reels x SYMBOL_CELLS_W`
columns with a `DIV` between reels. The PET cannot draw a cell finer than a 2x2 block, so each
frame cell carries an explicit PET pattern (`"1100"` = top half, or a ROM screen code).

## Drawing a symbol

Either edit the PNGs (any size; the pipeline averages it down) or change `art.mjs`, which draws
on a 24x24 grid with a small vector API (`rect circle ellipse ring rrect poly line`, `erase`,
`erasePoly`) and writes 48x48 masters. Rules that follow from the hardware:

- **One ink per 8x8 cell.** Detail comes from shape and from black gaps (`erase`), not from a
  second colour inside a cell. If a cell holds two colours the majority wins and the rest are
  drawn in it (`tiles build` prints the number of pixels this changes as "colour clash").
- **Black is paper.** Paint black and it is ink in black, which is invisible and takes the pixels
  away from the cell's real colour. Use `erase` for gaps.
- **Colours are the C64's** (the repo's shared meaning of a colour number); each machine maps them
  to its nearest available one, the VIC-20 among only eight.
- **The PET gets its own 6x6.** Averaging a drawing down to 6x6 is poor; put a hand-tuned
  `symbols/<ID>.pet.png` (or an ASCII `overrides.pet` in `art.mjs`) beside it, and leave a blank
  margin so stacked symbols do not run together.

## What is approximated, honestly

| machine | what you get | what is lost |
| --- | --- | --- |
| C64, X16 | the art at 24x24, one colour per cell | multicolour (the C64 could do 2 bits a pixel at half the width) and a second colour in a cell |
| VIC-20 | the same, with ink colours 0-7 | colours 8-15 (they shift to the nearest of eight) |
| web | 16x16 art (2x2 cells) from the runtime's 80-glyph table | a third of the pixels of the 24x24 art, and bit order differs (mirrored in `classic.web.8bs`): the table holds 80 glyphs, which a scrolling composer fills at 36 for three reels + 14 frame = 50 with 2x2 cells but not with 3x3 (81 + 14) |
| PET | 6x6 pseudo-pixels in the ROM's block glyphs | everything finer than half a cell, and all colour |

A glyph is shared by every cell with the same bits and colour, but the classic theme has only 7
duplicates in 68 cells, so de-duplication does not change the budget. The lever is symbol size, and
the themes pull it for the web: `"cells": { "web": [2, 2] }` in `theme.json` gives 16x16 symbols
(`view.web.8bs` composes 12 glyphs a reel, 36 for three reels, and the frame adds 14).

## Proving it on a machine

`src/labs/tile-test` draws every symbol and a reel window at rest with the generated tables.
`tools/tiles/test/screens.test.mjs` builds it for each machine, takes a headless screenshot, and
compares it with the screen the tables predict: ink on exactly the expected pixels, paper elsewhere,
one RGB per colour index. It passes on the **PET, C64, VIC-20 (8K) and X16** with zero wrong pixels
(about 5,900-6,200 ink pixels each); the web is not in the lab yet (below).

| machine | where the lab puts the glyphs | data (classic / cosmic) | lab program |
| --- | --- | --- | --- |
| PET | no glyphs: block screen codes at `$8000` | 66 B / 84 B | 1,310 B |
| C64 | character RAM at `$D000` (glyph 0 = code 128), screen at `$E000` | 612 B / 855 B | 2,243 B |
| VIC-20 8K | RAM at `$1C00` (`$9005` = `$CF`), codes 60-127; the screen is at `$1000` | 612 B / 855 B | 2,060 B |
| X16 | VRAM at `L1_TILEBASE`, tiles 128 up, through `text.putChar` | 612 B / 855 B | 2,753 B |

Pitfalls the lab hit, all 8-bit width: `@8bitscript/c64/charset` computes `code * 8` on a `utinyint`, so
`define/setRow/copy` write the wrong place for codes of 32 and up in 0.24.0 (the lab writes
`$D000 + code * 8` itself at 16 bits); the C64's `screen.blank()` leaves the lower-case set selected,
so call `charset.useUppercase()` after installing glyphs; on the VIC-20, widen to `usmallint` before
multiplying a glyph code by 8.

## Next

- **Web in the tile-test lab.** The slot machine uses the web's glyph table through `view.web.8bs`;
  the tile-test lab still lists four machines, because `@8bitscript/web/charset` (8bitscript #303)
  is on trunk but in no release yet.
- **Upgrades.** `TILE_MODE` and the table layout are stable so a renderer can pick a better mode
  without touching a game: C64 multicolour bitmaps; the X16's 4/8-bpp tiles with a real palette; a
  `.8bg` `tileset` kind in 8BitScript so a picture is a first-class asset (a later 8BitScript change,
  not tonight's).
