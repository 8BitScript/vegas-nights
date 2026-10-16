# Handoff: composed slot sounds (branch `sound/composed`)

Rebased onto trunk after #24 (2026-10-16). Delete this file in the change that merges the branch.

## Done and verified (8BitScript `audio/8ba-songs`, PR #316, at `dd186b54`)
- Sounds composed in `assets/audio/classic.8ba`, played through `audio.play` from `src/shared/sfx.8bs`
  (importance, tick only on a symbol crossing, 5-frame tick gap, volume OFF/LOW/MID, default LOW).
- Volume label: the 3x3 prints it where each view says (`VOLUME`, `VOLUME_COL`, `VOLUME_ROW` in
  `labs/slot3x3/view*.8bs`; none on the VIC-20, whose rows are all taken) and reads the key only between
  spins (the C64 composes the reels out of sight; text prints to the home copy). The 5x5 prints it where
  `view.TITLE` is true.
- `8bs check`, `8bs build --release` (every program, every machine), and the c64 wasm build.
- `scripts/sound.mjs web c64 vic20 cx16`: pass. `scripts/slot-sound.mjs web c64 vic20 cx16`: pass (the
  X16's two-frame stop is now checked as a short sound, not by pitch). The PET was not re-run here: its
  recording plays through the computer's sound device.
- README: the Sound section, the cost table, the VIC-20 at 16K.

## Left
- **Needs 8BitScript PR #316 merged**: on 8BitScript trunk the build fails (`unknown field 'volume'` in
  the `.8ba`). CI builds 8BitScript trunk, so CI's compile job is red until then.
- **Rebase after #28** (the bigger PET/web 5x5): both change `labs/slot5x5/game.8bs`; #28 sets
  `TITLE` false on the PET and web, where the 5x5 then shows no volume label.
- `pnpm run test:machines` against #316 (see the PR for the last run).
