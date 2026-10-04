# The bonus round's look: `fx`

When the 5x5's free spins start, the game switches the picture into a different mode: a warm
gold glow round the edge of the screen, a banner that glows, a steady gold reel frame —
whatever the machine can do to the *picture* rather than to the reels. The look is called
**Gold** (the reasoning, with 16 consecutive frames of the version it replaced, is in
[`fx-brief.md`](fx-brief.md); the measurements of this version are in [Gold: what shipped](#gold-what-shipped)
below). The game code is the same on every machine. What a machine does is one small file of its
own, and a machine that can do nothing keeps the portable file, which costs nothing.

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
| `src/shared/fx.web.8bs` | web | Gold border stripes (done; the reference twin) |
| `src/shared/fx.c64.web.8bs` | the C64 built through wasm | the same Gold stripes through the portable list (done) |
| `src/shared/fx.c64.8bs` | Commodore 64 | seven Gold border stripes from the raster list (done; see "The C64") |
| `src/shared/fx.cx16.8bs` | Commander X16 | a palette-cycled Gold gradient in the border (done) |
| `src/shared/fx.vic20.8bs` | VIC-20 | a slow red/yellow border breath and a marquee (done; no bars, see below) |
| `src/shared/fx.pet.8bs` | PET | a smooth marquee chase and a banner scanner (done; see "The PET") |

Those six names are the only twins; `test/fx.test.mjs` (CI) fails on any other. It also fails if a
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

Documented in the 8BitScript repo (`packages/<machine>/AGENTS.md`, "Raster splits"). All six twins
are built and measured; the sections below say how.

| machine | what the raster layer gives | notes for the effect |
| --- | --- | --- |
| web | `BORDER`, `BACKGROUND`, `SCROLL_X`, `CHARSET`; 64 entries; the renderer reads the list at paint time | **done**: twelve Gold border stripes, nothing else; see `fx.web.8bs`. No wobble — it would move the cells the player reads |
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

## Gold: what shipped

The first bonus look was a rainbow of copper bars (thirty-eight stripes from four unrelated
colour bars), a background-colour band under the panel, a horizontal wobble of the banner, a
reel frame that cycled through four colours, coins and stars blinking in the PET's margins and a
border that strobed through eight colours on the VIC-20. The owner ran it and called it "an
explosion of color and weird artifacts". It had been judged from single screenshots, which
cannot show a flash, a stripe that jumps or a banner that shears, so
[`fx-brief.md`](fx-brief.md) captured 16 consecutive frames (plus 48 more at every third) per
machine and measured it. Gold is the answer, built to that brief:

- **One warm ramp**: brown, orange, light red, yellow, a white peak, back to brown. Never a
  rainbow, and never black in the border (a black stripe next to a bright one is the hard edge
  that a late interrupt makes visible).
- **The border only.** The playfield, the reels, the panel and the rows under it are the plain
  black they always are. The old background band is gone, which also removes the cause of the
  C64's solid-colour flashes (below).
- **Slow, in notches.** Each stripe's colour moves one notch along the ramp every 5 video frames
  (every 4 on the X16, whose gradient has 24 notches). A step is a soft shift, not a jump.
- **The banner glows; it does not move.** `-- FREE SPINS --` pulses through the ramp's colours
  every 5 passes (`glowBanner` in `slot5x5/game.8bs`) on the machines that have a title row.
  The `$D016` wobble that sheared it is gone everywhere.
- **The reel frame holds gold** for the whole round (`view.pulse`, one colour; it used to cycle
  yellow, red, white and purple). A win still flashes the reel rows white.
- **The mouse pointer is hidden** on the X16 for the whole game (`pointer.hide()` in both games;
  `@8bitscript/pointer`, a no-op where a machine has no pointer).

### The clock

An effect must step in *video* frames, not in passes of the game loop: on the C64 and X16 a pass
that redraws reels can span two frames. 8BitScript's `raster.frame()` (PR #315) is a counter the
raster handler keeps, exact on those two machines even when the loop runs slow, and
`raster.FRAME_COUNTER` says whether a machine has one (true only there). `fx.c64.8bs` and
`fx.cx16.8bs` bank `raster.frame() - last` each pass and step when the bank reaches the step
length. Everywhere else a pass *is* a frame (the web and the wasm C64 run exactly one pass per
`waitFrame()`), or there is no interrupt to count with (the VIC-20 and PET), so `fx.frame(tick)`
counts passes.

### Measured

`scripts/motion.mjs all <machine>` (`MOTION_VARIANT=gold` writes `docs/motion/gold/<machine>/`),
58 frames a machine: 16 consecutive and 48 at every third. The "before" strips are
`docs/motion/<machine>/` (the brief), the "after" strips `docs/motion/gold/<machine>/`: each has
`consecutive-16.png`, `bonus.gif`, `spacetime-every-frame.png` and `analysis.json`.

| | colours in a frame | colours down the border | border pixels changing per frame | whole-screen flash frames | stripe step |
| --- | --- | --- | --- | --- | --- |
| C64 (x64sc) | 13 -> 12 | 13 -> 5 | 65.8% -> 38.3% | **10 of 58 -> 0 of 58** | every ~5-6 frames |
| C64 in wasm | 13 -> 12 | 13 -> 6 | 43.0% -> 13.4% | 0 -> 0 | every 5 frames |
| web | 12 -> 11 | 11 -> 6 | 32.7% -> 13.2% | 0 -> 0 | every 5 frames |
| VIC-20 (xvic) | 8 -> 7 | 2 -> 2 | 13.3% -> 6.7% | torn frames 5 of 58 -> see below | a change every ~20 frames |
| PET (xpet) | 2 -> 2 | 2 -> 2 | 0.3% -> 0.3% | 0 -> 0 | one comet cell per 4 frames |
| X16 (x16emu) | 35 -> 20 | 22 -> 8 | 21.4% -> 26.7% | 0 -> 0 | one notch every 4 frames |

How to read it:

- A "flash frame" is a frame whose most common colour is not the round's usual black: the
  playfield turned a stripe colour. The C64 had 10 of 58; it now has none.
- The border-pixels figure is high where a step recolours every stripe: a C64 step moves all
  seven stripes, so a step frame changes most of the border and the other frames almost none.
  The brief's target for it (25%) is met by the web and wasm builds and not by the C64 (38%) or
  the X16 (27%, a palette cycle recolours every stripe by one small notch). It is a count of
  pixels that differ at all, not of how much; the X16's steps are one notch of 24.
- The VIC-20's "flash" in `analysis.json` (43%) is not meaningful: it counts frames in the second
  of its two legitimate border colours. The torn frames are in the VIC-20 section.

## The C64

`src/shared/fx.c64.8bs` — seven Gold border stripes from the raw raster list
(`@8bitscript/c64/raster`; the portable `@8bitscript/raster` refuses lines outside the 200-line
picture, and the border above and below it is where most of the glow is).

- **The list.** Seven entries, `$D020` only, 36 lines apart from line 15 to 231, a ten-notch
  ramp (`brown brown orange lightred yellow white yellow lightred orange brown`) of which the
  seven stripes show seven. A step rewrites each entry's colour byte in place
  (`raster.setValue`); the line and address bytes never change, so the interrupt never reads a
  half-built entry.
- **Why seven, and wide.** A reel redraw is two 80-byte copies inside one window with the I/O area
  banked out and interrupts masked (`glyphs.c64.8bs`, about 2,200 cycles, 35 raster lines), and
  up to five of them run back to back. A list entry due inside a window is applied when it
  ends, so a stripe boundary is late by up to 35 lines and two boundaries in one window merge.
  The first Gold try (twelve 21-line stripes) showed exactly that: neighbours merging into
  tall blocks and edges bouncing from frame to frame. A 36-line stripe cannot merge with its
  neighbour, and since the ramp never goes to black a late edge is a soft shift between two
  close browns and oranges.
- **What did not work, and is not in.** Letting the interrupt in *during* the copy (closing and
  reopening the window every 32 bytes, or once per reel between the two copies) removed the
  late edges and made things worse: the raster handler lost a whole pass in 1 frame of 7, so the
  border was one solid colour for that frame (8 of 58 sampled). Each of those variants was
  measured with the colours frozen, so the cause is the gaps and not the effect. The handler's
  pass logic (`packages/c64/native/6502/raster.s`) is the place to look; this is left as it was
  (zero lost passes) and the stripes are made to tolerate a late edge instead.
- **No background entries.** `$D021` is never written, so a frame the handler is late on cannot
  leave the playfield a stripe colour. That was the old effect's flash (4 frames in 16).
- **No wobble**, and the banner glows through the game loop's colour RAM writes instead.
- **Cost** (`8bs build c64 --program slot5x5 --size`, program / RAM): 12,006 / 116 with the stub,
  12,972 / 126 with the twin: **+966 B, +10 B** (the first Gold try was +1,347 B, +7 B).
- **end()** disables the interrupt, empties the list and writes `$D020` and `$D021` back to black.
- **Test.** `test/fx.machines.test.mjs`, `c64`: the border column is plain at frame 60, a glow of
  3 to 7 colours at frames 1000 and 1012 and moving between them, the rows under the panel stay
  one plain colour in every sampled frame, and the border is plain and exactly as before at 8000.

## The VIC-20

`src/shared/fx.vic20.8bs` — a slow red/yellow border breath and a marquee of lights up the last
column. The measurements that ruled out stripes (a raster list held the reels back by 78%: the
bonus round finishing at frame ~18,200 instead of ~10,200) and the first marquee (35% slower) are
kept in the file's header.

- **The border.** `$900F`'s three border bits take one of two warm colours, red or yellow, and
  hold each for 8 passes of the game loop (about 20 video frames). The write is made right after
  `waitFrame()` returns, only when the colour is to change, and only if `$9004` (the raster
  counter, lines / 2) is under 10: on a pass the composer overran `waitFrame()` returns at once in
  the middle of the picture and a write there would split the border. Measured: the counter
  reads under 8 on every on-time pass, so the window is 20 lines; the first version of this check
  used 4 and never fired.
- **Torn frames.** The old effect (a new colour every other frame) split the border in 5 of 58
  captured frames. This one changes 6 times in 58 and shows a second colour in 3 of the 58
  (one frame per change at most); in one the old colour covers 44% of the border, which is a
  VICE capture stopped partway down the picture on the frame of a change (the write itself lands in
  the first 20 lines), not a write in the middle of the frame. The test therefore allows two
  colours in a sampled frame but at most one split frame in six.
- **The marquee** is unchanged: three bars of lights (white head, yellow, red) down the last
  column over a dim blue tube, a table of the 23 addresses, four cells repainted per bar every
  second pass. No glyph is redefined; no reel, panel or meter cell is touched.
- **Cost** (`8bs build vic20 --program slot5x5 --size`, program / RAM): 10,026 / 105 with the
  stub, 10,571 / 109 with the twin: **+545 B, +4 B**.
- **Reel speed.** The border write is one read-modify-write on a change pass and a read of `$9004`
  on a pending one; the earlier twin (an 8-colour strobe every other frame plus the same marquee)
  measured within 1% of the stub. This twin does less and was not re-bisected.

## The PET

`src/shared/fx.pet.8bs` — a smooth marquee chase round the edge and a banner scanner, written into
screen RAM cells the game never reads. `RASTER` is true on every PET because `frame()` does
something on all of them (it is not `#fact(video.raster)`: the effect is not a raster one).

- **What it does.** A ring of dots round the screen edge with four comets (a solid block, then
  a shade, then back to a dot), one comet cell per 4 frames each, a different comet every frame;
  a strip of shade blocks down both sides of the machine; and, on the free row under the panel
  (row 23), `-- FREE SPINS --` with a block of reverse video scanning along it, a cell every
  fourth frame.
- **What was removed.** Six `$` coins falling down the margins and eight `*` stars blinking on
  and off. In the motion strips those isolated single characters appearing and vanishing at
  scattered cells read as screen noise, not confetti. The chase is the one thing that reads as
  intentional, so it is the one thing left (and the work per frame is smaller).
- **No character-set split**, as before: the driver busy-waits most of a frame and a split over
  the reels would turn their blocks into letters.
- **Cost** (`8bs build pet --program slot5x5 --size`, program / RAM, 4032 with 32K): 9,361 / 100
  with the stub, 11,123 / 110 with the twin: **+1,762 B, +10 B** (the coins and stars version was
  +2,527 B). About 370 bytes of that are the zero-filled ring tables (an 80-column ring needs 185
  places; the 6502 backend indexes a 16-bit table with an 8-bit index, so the ring is two
  tables of 93).
- **Test.** `pet` (`kind: 'margins'`): the margins are plain before the round, show at least two
  colours and move between frames 3000 and 3012, and are exactly as they were afterwards.

## The Commander X16

`src/shared/fx.cx16.8bs` — a palette-cycled Gold gradient in the border. The X16's raster
`BORDER` value is a palette index and VERA's palette is video memory the CPU can rewrite in a few
dozen bytes, so the stripes are twelve raster entries written **once**, each naming its own palette
entry (64-75), and the animation is the palette: every 4 video frames the twelve entries' RGB are
rewritten from a 24-step gold table, one notch further along.

- **The table.** 24 steps of VERA 12-bit colour, a triangle: black, deep brown, orange, amber, gold,
  cream, a white-yellow peak at step 12, and back. Stripe `k` shows step `2k - phase`, so about six
  stripes make one swell and a step is a soft shift of the whole glow. The first version cycled four
  unrelated bars (gold, magenta, cyan, green) and added a blue/white/cyan glow band under the
  panel: 35 colours in a frame, 20 now (the reel art accounts for most).
- **Border only**, a black background held at line 0, no wobble, no background stripes.
- **The clock** is `raster.frame()`, so a game-loop pass that spans several frames still steps on
  time.
- **The pointer** is hidden for the whole game (`pointer.hide()`), restored by nothing: the
  program never gives the machine back.
- **Cost** (`8bs build cx16 --program slot5x5 --size`, program / RAM): 17,826 / 197 with the stub,
  19,555 / 197 with the twin: **+1,729 B, +0 B** (it was +2,000 B). Most of it is the raster layer
  the twin pulls in.
- **The reel composer and the palette** both go through VERA's `DATA0`. The raster handler saves and
  restores `ADDR0` and `CTRL` around its writes, `paint()` sets its own address, and the composer
  sets its own before each copy.
- **Test.** `cx16`: the border column is plain at frame 200, a glow of 3 to 14 colours that moves
  between 1100 and 1112, and plain and exactly as before at 4400.

## Web and the C64 in wasm

`src/shared/fx.web.8bs` and `src/shared/fx.c64.web.8bs` — twelve Gold border stripes through the
portable list (`@8bitscript/raster`, `BORDER` at a picture line): 21 lines apiece on the web (the
picture is 256 lines), 17 on the wasm C64 (200 lines). Both rewrite the colour bytes and
`commit()` every 5 frames; a pass is exactly one frame on both builds, so the step is exact
without the counter (`raster.FRAME_COUNTER` is false there). The wasm C64 cannot name the border
above and below the 200 picture lines; the page paints that in its plain colour, so it shows
the side borders only.
