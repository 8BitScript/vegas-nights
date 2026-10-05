# Handoff: composed slot sounds (branch `sound/composed`, draft)

## Done and verified
- Idle drone root cause: the 5x5 loop never called `sound.update()`, so a note's gate/voice stayed open. Fixed and merged earlier (#18) with a silence-at-rest assertion (`scripts/slot-sound.mjs`) on every machine.
- Sounds are now composed in `assets/audio/classic.8ba` (instruments + 7 songs), played via `audio.play` from `src/shared/sfx.8bs` (importance, tick gap of 5 frames, volume off/low/normal, default LOW, cancel key cycles, "VOL ..." on the panel). PET plays no ticks at LOW (one-bit speaker).
- `scripts/sound.mjs` reads the `.8ba` through the compiler and checks every machine plays the composed notes: passes on web, C64, VIC-20, X16, PET (sound-test lab).
- `scripts/slot-sound.mjs` (game level): passes on web, C64, VIC-20 (all four spins + silence), PET (before the stop fix; re-run), X16 except the item below.

## Not done / failing
- X16 `lose` probe: the last sound is `stop` (two frames, C3); the WAV segmenter cannot see it ("heard notes <none>"). Harness issue, not a sound bug; loosen the check for sub-3-frame sounds on X16.
- Not re-run after the last changes: `pnpm run test:machines` (on-screen suites), README byte-cost table and "Composing the slot sounds" section (README's Sound section still describes the old `audio.tone` effects; its cost table is stale).
- Needs 8bitscript PR #316 (draft) merged first: vegas CI builds 8bitscript trunk.
- Out of the sound scope: owner also wants a larger playfield and a less janky bonus (other forks).

## Sizes (program bytes, before -> after, `8bs build --target <t> --program slot3x3`)
PET 6481 -> 8211, VIC-20 6986 -> 9072, C64 8998 -> 11077, X16 9349 -> 11246. 5x5 on VIC-20 no longer fits the 8K expansion (old 10764; +~2.1 KB), so `8bitscript.config.8bs` now builds the VIC-20 with `ram: '16k'` (and `scripts/sound.mjs` runs `-memory 16k`). README lines still say 8K.

## Resume
```
cd <worktree of sound/composed>
export EIGHTBS_CHECKOUT=<8bitscript checkout on audio/8ba-songs>
node scripts/sound.mjs            # composition vs machines
node scripts/slot-sound.mjs       # game level (needs xpet/xvic/x64sc/x16emu; VICE audio needs macOS)
pnpm run test:machines
```
