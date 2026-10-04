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

This repository is at the very start. **What exists today** is the scaffold and
one placeholder lab; nothing here is a slot machine yet.

| Program | What it is | Status |
| --- | --- | --- |
| `main` | The lobby: a title screen that says how to run a lab | builds and runs on all five machines |
| `hello-reels` | Three text cells that cycle symbols when you press confirm | builds and runs on all five machines |

## Run it

Needs Node 26+ and pnpm 12+.

```sh
pnpm install
pnpm start                      # the lobby on the C64
pnpm start:c64                  # the lobby on a given machine (pet, vic20, c64, cx16, web)
pnpm start:hello-reels:vic20    # a lab on a given machine
pnpm run build                  # every program for all five machines -> dist/
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
src/shared/                code the labs share (reel symbols today)
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
- **`random.range(n)` does not build** on the 6502 machines. `src/shared/reels.8bs`
  draws a reel stop from the top bits of `random.next()` instead (the comment
  there has the reason).

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
