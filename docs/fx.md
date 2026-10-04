# The bonus round's look: `fx`

When the 5x5's free spins start, the game switches the whole picture into a different mode:
raster bars, a colour cycle, a wobble — whatever the machine can do to the *picture* rather than
to the reels. The game code is the same on every machine. What a machine does is one small file
of its own, and a machine that can do nothing keeps the portable file, which costs nothing.

## The seam

`src/shared/fx.8bs` is the portable file, and the definition of the surface:

```
export namespace fx {
    const RASTER: bool = false;
    function begin(): void { }
    function frame(tick: utinyint): void { }
    function end(): void { }
}
```

A machine that does better has a twin that **replaces the file whole** (8BitScript resolves
`name.<machine>.8bs` ahead of `name.8bs`, the way `feel.c64.8bs` and `cells.pet.8bs` already do):

| file | machine | state |
| --- | --- | --- |
| `src/shared/fx.8bs` | every machine without a twin | the stub: nothing, free |
| `src/shared/fx.web.8bs` | web | copper bars (done; the reference twin) |
| `src/shared/fx.c64.8bs` | Commodore 64 | copper bars (done; see "The C64" below) |
| `src/shared/fx.cx16.8bs` | Commander X16 | palette-cycled copper bars (done) |
| `src/shared/fx.vic20.8bs` | VIC-20 | border flash and a marquee (done; no bars, see below) |
| `src/shared/fx.pet.8bs` | PET | marquee, coins, stars, banner scanner (done; see "The PET") |

Those five names are the only twins; `test/fx.test.mjs` (CI) fails on any other. It also fails if a
twin adds, drops, renames or retypes a member, so the per-machine files cannot drift apart: the
shape is exactly the four members above, nothing exported besides them.

### What the game promises

`src/labs/slot5x5/game.8bs` is the only caller:

- `fx.begin()` — once, when a base spin lands the scatters that start the round, right after the
  FREE SPINS banner goes up. The reels are at rest and no spin is running.
- `fx.frame(tick)` — once per frame while the round runs (through free spins, wins and the pauses
  between them), **only if `fx.RASTER`**, called right after `waitFrame()` and before the frame's
  other work. `tick` is the frames since `begin()`, wrapping at 256. A raster list should be
  rewritten here, at the top of the frame, before the beam reaches the first entry's line.
- `fx.end()` — once, when the last free spin has paid, right after the banner comes down.

`RASTER` is the one flag. It means *`frame()` does something on this machine*, and the game
counts frames and calls `frame()` only when it is true — false folds the counter and the call away
(measured: the four 6502 builds are byte-for-byte the size they were before `fx` existed). It is
named for the raster effects it was made for; a twin whose effect is not a raster one (a chasing
frame on the PET, say) sets it true as well. Use a fact when the answer is the build's, not the
machine's: the web twin has `const RASTER: bool = #fact(video.raster);`, and a PET twin should have
the same, so a PET model with no raster stays free.

### What a twin must do

- **Put everything back.** `end()` restores every register, colour, character-set bit and raster
  list that `begin()`/`frame()` touched, so the normal look is exactly what it was — the test checks
  the border is the same colour column before and after.
- **Leave the reels alone.** The composer owns the reel cells' glyphs, screen codes and colours
  (`view.*`, `quad.8bs`, `reelscroll.8bs`); the payout flash and the frame pulse own the frame cells.
  An effect lives in the border, in rows with nothing drawn, in registers, or in a raster list —
  never in cells the player reads (the credit panel, the reels, the meters). The web twin keeps the
  background black from picture line 0 down to the last panel row and only paints bars in the rows
  below it.
- **The 5x5 uses no sprites and no other raster list**, so `fx` owns the list: build it in `begin()`,
  `clear()` it in `end()`. (`examples/fancy`'s C64 conflict — `graphics.update()` clearing the list
  every call — does not apply: the slots do not call `graphics.update()`.) If a later feature wants
  the list too, it has to go through `fx`.
- **Language rules that bit the web twin:** a const *array* cannot be a namespace member, and names
  inside a namespace must be qualified when used inside it — so keep tables, helpers and tuning
  consts at module level and put only `RASTER`, `begin`, `frame`, `end` in `fx`.

## What each machine can do

Documented in the 8BitScript repo (`packages/<machine>/AGENTS.md`, "Raster splits"); nothing below
has been tried in this game yet except the web.

| machine | what the raster layer gives | notes for the effect |
| --- | --- | --- |
| web | `BORDER`, `BACKGROUND`, `SCROLL_X`, `CHARSET`; 64 entries; the renderer reads the list at paint time | **done**: border bars all the way down, background bars under the panel; see `fx.web.8bs`. No wobble — it would move the cells the player reads |
| C64 | an IRQ-driven list: the four slots, 63 entries; entries land at the end of their line; two pages with an atomic `commit()` | rewrite values right after `waitFrame()`; `Slot.SCROLL_X` works (a wobble is possible in rows with nothing drawn); the reel composer in assembly takes ~0.6 of a frame per redraw, so measure that the IRQ list and the composer coexist at the speeds in `feel.c64.8bs` |
| X16 | VERA line IRQ: `BORDER` (DC_BORDER), `BACKGROUND` (recolours a palette entry — so anything drawn in that entry changes too), `SCROLL_X`, `CHARSET`; a picture line is a byte, so the list reaches lines 0–255 (text rows 0–31); an entry lands 1–2 lines late and two entries closer than two scanlines can't both be on time | palette entries are the X16's real copper bars: pick an entry nothing else uses; the reel pixels live in the text layer's redefined tiles, so don't repurpose their palette indices |
| VIC-20 | no raster interrupt: `waitFrame()`'s frame hook busy-waits down the frame and writes `$900F` (border + background) and `$9005` (character set) at each planned line; `FINE_SCROLL` false; 16 entries | the hook costs frame time and the quadrant composer already takes ~0.9 of a frame per redraw on this machine: measure before adding lines. `$900F` holds 8 border colours (0–7) and 16 backgrounds, so bars are chunkier |
| PET | only the 3032 and 4032 model tags have a driver (`#fact(video.raster)` true there): a character-set split (graphics ↔ text set) at a line, cycle-calibrated; no colour at all | the split changes which glyphs the ROM shows, so on a screen of block-graphics reels it only shows in rows of letters. The honest PET effect is probably not a raster one: a chasing / reverse-video frame (the quadrant codes have inverse twins), driven from `frame()` with `RASTER` true. Say so in the twin's header; the test row can read the frame cells instead of the border |

## Writing a machine's twin

1. Start from `fx.web.8bs` — copy its shape, not its numbers. Read the machine's raster section in
   `/Volumes/Development/8bitscript/packages/<machine>/AGENTS.md`.
2. Build the list once in `begin()`, rewrite only value bytes in `frame()` (`raster.setValue(entry,
   value)` with `entry` the byte offset, `raster.STRIDE` apart), `clear()` in `end()`.
3. Keep the effect inside the border and the rows nothing is drawn in; look at your screenshots.
4. `pnpm test` (the contract test) must pass.
5. **Measure the bytes.** The baseline is `8bs build <machine> --program slot5x5 --size` with the
   portable stub (program bytes / RAM): C64 10,899 / 105; PET 9,077 / 95; VIC-20 9,686 / 96; X16
   17,178 / 176; web 1,160 / 161 (const data / RAM; the web figure with its twin is 1,192 / 164).
   Write your machine's before/after in the PR and in the twin's header, and say what the machine
   can no longer fit, if anything (the PET and the 8K VIC-20 are the tight ones).
6. **Prove it on screen.** Add the machine's row to `FX` in `test/fx.machines.test.mjs` (two frames
   inside the forced bonus round, a frame before the first spin, a frame after the round, and an x
   inside the left border; a VICE capture's border is not at the web's x = 2) and run
   `MACHINES=<machine> pnpm run test:machines`. It checks the border is one plain colour before,
   barred and moving during, and exactly as before after. Mutation-check it: leave `end()`'s cleanup
   out and the test must fail. Then run the whole suite for the machine (the existing 5x5 tests read
   the free-spin counter *during* the round, so an effect that disturbs a cell fails them).
7. Look at the PNGs. A test can't tell you the bars are pretty.

## Keeping the bonus recognisable without the effect

On a machine with the stub the round is still unmistakable, and an effect must never be the only
thing that says so: the `-- FREE SPINS --` banner where the machine has a row for it, the pulsing
frame (`view.pulse`), the `FS nn X3` counter and the FREE SPINS! message. A twin adds to these; it
does not replace them.

## The C64

`src/shared/fx.c64.8bs` — rainbow copper bars from the raw raster list
(`@8bitscript/c64/raster`; the portable `@8bitscript/raster` refuses lines outside the 200-line
picture, and the border above and below it is where most of the bars are).

- **Border bars.** `$D020` takes a new colour every 6 raster lines from line 29 to 251: 38
  stripes from a 32-step table of four bars (blue/cyan/white, red/orange/yellow, green/white,
  purple/pink), scrolling down one stripe every other frame. All four borders show them.
- **Background bars.** The same table half a turn out of step, scrolling the other way, in text
  rows 20-24 (raster lines 210-249), the five rows nothing is drawn in; `$D021` is black
  everywhere above, so no digit, reel or frame cell ever sits on a bar.
- **Wobble.** The `-- FREE SPINS --` banner row only: `$D016`'s fine scroll, 0-6 pixels, one
  entry every two lines (the pitch the handler keeps up with), following a sine; reset to 0
  before the reels' frame starts. It is gentle (the banner's left edge moves between x = 153 and
  157 in the captures) and it moves no cell the player or the tests read.
- **The list:** 54 of the 63 entries — two resets to black at line 1 (so a frame the handler
  could not finish, the first after `enable()`, never carries its last bar into the next), 38
  border stripes, 7 background stripes, 5 wobble (4 + the reset) and the 2 that restore black at
  line 254. The stripes sit on the wobble's lines (29 + 6k lands on 59 and 65): two entries on one
  line cost 25 cycles, two on neighbouring lines across a bad line made the handler fall behind
  (the first version, with stripes on 58 and 64, tore).
- **end()** disables the interrupt, clears the list and writes `$D020`/`$D021`/`$D016` back by
  hand, because the handler leaves the last value it wrote in the register.
- **Cost** (`8bs build c64 --program slot5x5 --size`, 2026-10-04): 11,804 B of program and 114 B
  of RAM with the stub, 13,151 / 121 with the twin: +1,347 B, +7 B. Most of it is the raster
  list's handler and install routine (about 400 B) and the per-frame rewrite loop.
- **Against the reel composer.** The composer is assembly in the main loop and the handler is an
  interrupt (it saves A and X and touches no zero page but its own `jmp`), so the glyph bytes are
  not torn by the bars; the interrupt only costs the composer cycles. All 16 C64 tests of
  `pnpm run test:machines` (the exact reel windows, the numbers, the bonus and retrigger rounds
  with the free-spin counter read during the round) pass with the effect running.
- **Test.** `test/fx.machines.test.mjs`' `c64` row checks the border column (plain at frame 60,
  barred and moving at 1000 and 1004, plain and exactly as before at 8000) and the free rectangle
  (plain, 3+ colours during, plain again). Leaving `end()`'s cleanup out fails it.

## The VIC-20 twin

`src/shared/fx.vic20.8bs`: the whole border flashes through eight colours (changing every second
frame) and a marquee of three lit bars (white head, yellow, red) runs down the screen's last
column, over a dim blue tube. `RASTER` is true because `frame()` does work, but there is no raster
list. `docs/fx/vic20-bonus-a.png` and `vic20-bonus-b.png` are two frames of a bonus round.

**Why there are no copper bars.** The VIC-I has no raster interrupt, so `@8bitscript/raster` applies
a list from `waitFrame()`'s frame hook, which busy-waits from the top of the frame down to the last
planned line (`packages/vic20/AGENTS.md`, "Raster splits"). The quadrant composer needs most of a
frame for one reel redraw, so a hook that holds the CPU for even the top third of the frame pushes
every composing frame past its edge. It was built first and measured, because the brief asks for a
twin to be measured before it is trusted. "End of round" below is the first video frame at which
the `FS nn X3` counter text has gone, in the forced `slot5x5-bonus` round (bisected to 40 frames):

| twin | end of round | program / RAM | what it is |
| --- | --- | --- | --- |
| the portable stub | ~10,200 | 9,686 / 96 | no effect |
| eight border stripes, six lines apart, plus a 23-cell marquee rewritten every frame | ~18,200 (78% slower) | 11,594 / 114 | the raster hook, 1.9 KB of raster code |
| the same marquee with no raster, rewriting all 23 cells every frame | ~13,800 (35% slower) | 10,439 / 105 | 23 cells, a 16-bit multiply each for the address |
| **this twin** | **~10,300 (about 1%, inside the bisect's resolution)** | **10,535 / 106** | a table of the 23 addresses; three bars repainted four cells each every second frame; one read and one write of `$900F` a frame |

So the cost on this machine is time, not bytes: +849 bytes of program and 10 of RAM over the stub,
on the 8K build (11,775 usable), and the reels run at the speed they do without the effect. A frame
that composes a reel has roughly a tenth of a frame to spare; budget the effect against that, not
against the frame.

**What it touches, and what it puts back.**

- *Border:* `$900F` bits 0-2 only. Bits 3-7 are the background colour the reels' blank quadrants are
  drawn on and the inverse flag; they are read back and kept, so no reel or panel pixel changes.
  Written once a frame, right after `waitFrame()`, so it is one colour all the way down the screen;
  when a frame's work ran past its edge the write lands partway down and that one frame shows two
  colours (the test allows it). `end()` writes back the colour it found in `begin()`.
- *Marquee:* column 21, the one column `layout.centre` leaves empty on every row (the block is 21
  wide on a 22-column screen). `begin()` saves each cell's colour and fills it with solid blocks;
  `end()` puts back spaces and the saved colours. No reel, panel or meter cell is written.
- *Background colour:* never changed. A BACKGROUND entry (or any write to bits 4-7) repaints every
  blank half of the reels' quadrant blocks and the whole credit panel, which is drawn on the
  background.

**The test.** `kind: 'flash'` in `test/fx.machines.test.mjs`: the border is one colour before the
round (frame 600), the marquee column is empty; during it (frames 2400-2436) each frame's border
has at most two colours and the main colours differ over four frames (at least three), the marquee
shows at least three colours and the lights move between frames; after (frame 13,000) the border
column and the marquee column are exactly what they were. Mutation-checked four ways, each failing
on its own assertion: `end()` leaving the border flashing; `end()` leaving the marquee blocks;
`frame()` never writing the border; `frame()` never moving the bars.

**Not done.** The unexpanded (3.5K) VIC-20 cannot hold the 5x5 at all (9,686 bytes before this
twin), so this twin is only ever built on 8K and up. PAL was not captured; the effect uses nothing
region-specific, but the end-of-round figures above are NTSC.

## The PET

`src/shared/fx.pet.8bs`. The PET has one ink, no border and no colour, and a fixed character ROM,
so its bonus look is made of screen-RAM writes in cells the game never reads: a marquee ring of dots
round the edge of the screen with four comets (solid block, shade, dot) chasing round it, dollar-sign
coins falling in the margins, `*` stars blinking, shade strips down both sides of the machine, and a
reverse-video block scanning along a `-- FREE SPINS --` banner on row 23 (the PET has no title row:
`view.TITLE` is false). `RASTER` is `true` on every PET model, because `frame()` does something on
all of them; it is deliberately not `#fact(video.raster)`.

![the PET's bonus round](fx/pet-bonus-a.png) ![a few frames later](fx/pet-bonus-b.png)

![the same on the 8032, 80 columns](fx/pet8032-bonus.png)

### Why no character-set split

The 3032 and 4032 can split the character set at a line (`Slot.CHARSET`,
`@8bitscript/pet/rasterline`), and a split over the banner row would flicker its text case. It is not
used. The driver busy-waits down the frame to its last entry's line (about 5,209 + 50 cycles a line of
a ~20,000-cycle frame), so an entry at the banner's line 184 spends nearly the whole frame, and the
quadrant composer that redraws five reels needs most of a frame already. A split over the reels would
turn their block graphics into letters. So the PET's effect is not a raster one.

### What it costs

The measurement that mattered was not bytes, it was time. The composer leaves the PET little to spare
in the bonus round, and `waitFrame()` loses a whole frame whenever a frame's work runs over. Both
builds are deterministic, so the forced bonus round (`slot5x5-bonus`, seeded, starting near frame 508)
was timed by bisecting for the frame its free-spin counter disappears on (`--frames`, 4032, 32K):

| build | round ends at frame | longer than the stub |
| --- | --- | --- |
| portable stub (no effect) | 3,905 | |
| first version: each cell's address worked out with `row * columns` | 4,424 | 519 frames, 15% |
| addresses in tables, half of everything moving every other frame | 4,046 | 140 frames, 4% |
| shipped: one comet, one coin and one banner cell move per frame, ring split in two tables | 3,957 | 52 frames, 1.5% |

A 16-bit multiply by the column count is a software loop on a 6502, and the first version did three
a cell written. Nothing multiplies once the round is running: `begin()` lays the ring, coin, star and
banner addresses into tables and `frame()` looks them up and adds. The ring table is two arrays of 93
sixteen-bit offsets, not one of 185: the backend indexes a 16-bit array with an 8-bit register, so on
the 80-column 8032 (a 185-place ring) every place from the 128th landed on top of one of the first 57
and the left edge disappeared; the 40-column 4032 (105 places) never showed it.

`8bs build pet --program slot5x5-bonus --size`, program bytes / RAM for variables:

| build | program | RAM |
| --- | --- | --- |
| portable stub | 9,369 | 101 |
| with `fx.pet.8bs` (4032, 32K) | 11,896 | 112 |
| with `fx.pet.8bs` (8032) | 11,933 | 112 |

About 370 of the extra bytes are the zero-filled ring tables, sized for the 80-column ring on both
(an array length cannot be an expression).

### How it is checked

`test/fx.machines.test.mjs` has a PET row, `kind: 'margins'` (the third path beside the bars and the VIC-20's flash). The PET has no border, so it reads a set of pixel columns
through the margin cells (the ring's two edges, the coin lanes and the star lanes) and asserts the
four things every machine's row does: plain before the round (frame 400), the effect during it (two
ink colours, the cells different between frames 3,000 and 3,012), and exactly the pixels it had
before once the round is over (frame 6,000). Two mutations fail it: leaving the ring in `end()`, and a
`frame()` that does nothing. The existing 3x3 and 5x5 PET tests, which read the free-spin counter and
the exact credit during the bonus and retrigger rounds, pass with the effect running (16 of 16).

### Not verified

A real PET: the timings are VICE's, and a real machine's 50 Hz or 60 Hz frame may differ from
`xpet`'s. The 8032 was looked at in a screenshot after the ring fix (above) but is not in the
on-screen test, which runs the 4032. The 2001, 3008 and 3016 are not targets of the 5x5 (it does not
fit their RAM); the 4016 and 3032 were not run.

## The Commander X16's twin

`src/shared/fx.cx16.8bs`: copper bars in both side borders, a glowing band below the credit panel,
and none of it touches a cell the player reads.

- **Border bars cost no per-frame list writes.** On the X16 a raster `BORDER` value is a *palette
  index* (0-255), and VERA's palette is video memory the CPU can rewrite in a few dozen bytes. So
  `begin()` writes the raster list once (twenty stripes, one entry per 12 picture lines, each naming
  its own palette entry 64-83, which nothing else uses) and `frame(tick)` only rewrites those twenty
  entries' RGB from a 64-step copper table (four bars of sixteen steps: gold, magenta, cyan, green,
  each with a white-hot peak). One step further along the table moves the bars down the border.
  Forty data-port writes a frame, at the top of the frame, inside the blanking.
- **Background bars** (`Slot.BACKGROUND`, which can only name the 16 stock colours) fill the rows
  under the panel, picture lines 176-247 (text rows 22-30; the panel ends on row 20). Nine entries,
  rewritten with `raster.setValue` from a 16-colour blue / red-yellow ramp. Everything above line 176
  holds black, so no reel, digit or meter ever sits on a bar.
- **The list is 31 of the 32 entries**, on 29 distinct picture lines (the driver's plan arrays hold 32),
  no two closer than 4 scanlines, so every split lands on its own line. The last border stripe (line 228) holds to the bottom of the
  frame, and the same stripe shows above line 0; it fades through the table a step at a time, so the
  top and bottom edge of the screen glow rather than flash.
- **No wobble.** `SCROLL_X` would move the title and banner rows, and the list has one entry left.
- **No tearing against the reel composer.** The composer streams tile bytes through VERA's DATA0, and
  `frame()` writes the palette through DATA0 too. The raster handler saves and restores ADDR0 and CTRL
  around every write, `frame()` sets its own address, and the composer sets its own before every copy
  (`packages/cx16/AGENTS.md`, "Raster splits"); `pnpm run test:machines` (cx16) reads every reel
  pixel during the round and all of them match the oracle.
- **`end()` puts everything back.** It saves nothing it did not read: `begin()` reads `DC_BORDER` and
  the twenty palette entries; `end()` commits a one-entry list (border as it was, background black),
  waits two frames for the handler to apply it, takes the handler off, and writes the border and the
  palette entries back. The border column of a capture after the round is identical to the one before
  it (the test checks).

### Bytes (`8bs build cx16 --program slot5x5 --size`, program / RAM)

| | program | RAM |
| --- | --- | --- |
| portable stub (`fx.8bs`) | 17,701 | 197 |
| `fx.cx16.8bs` | 19,701 | 197 |

+2,000 bytes of program, no RAM. Most of it is the raster layer the twin pulls in (the handler,
`commit`, `at`, the palette write: `packages/cx16/AGENTS.md` measures +1,251 bytes for a two-entry
list); the rest is the twin's own code and its two 64-byte copper tables. The split was not measured
separately. The X16 has the room.
Measured 2026-10-04, x16emu r50 with ROM `fbe32a60`, against 8BitScript trunk.

### On screen

`test/fx.machines.test.mjs` (`MACHINES=cx16`, column x = 8, inside the 16-pixel border): frame 200
(first base spin) one plain border colour; frames 1100 and 1106 (free spins under way) several colours
down the column and more than twenty rows different between the two; frame 4400 (round over) the same
column as at frame 200, pixel for pixel. Leaving `end()`'s restore out fails it. Not checked: a real
X16, whose VERA may raise the line interrupt at a different point of the line than x16emu does.
