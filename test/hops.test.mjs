// A hop is a cheaper way to the same picture.
//
// Where a machine can copy its screen (the PET and VIC-20), a reel that moves a whole cell row (8 pixels) or two (16)
// does not recompose its cells: it moves them with a 6502 block copy and composes only the new top rows
// (src/labs/slot3x3/quad.8bs, src/shared/move.8bs). That is only allowed to be faster. This test walks three reels up
// their strips twenty times, over several symbol boundaries, once by the spin's own path (hops) and once redrawing the
// whole reel after every move, and demands the two screens be the same picture, pixel for pixel; and, so the
// comparison cannot be vacuous, that the walk really moved (the screen differs from the reels' starting picture).
// The web has no screen memory to copy, so its path is a redraw either way: it is run anyway.
//
// It reads `#define` (EIGHTBS_CHECKOUT=/path/to/8bitscript) and needs the emulators: `pnpm run test:machines`.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MACHINES, unavailable, capture, HAS_DEFINE } from './support/emulator.mjs';
import { loadPng } from './support/screen.mjs';

// long enough for twenty full redraws of the reels (a VIC-20 redraw is ~2.5 frames a reel) after the boot
const FRAMES = { slot3x3: { vic20: 900, pet: 600, web: 30 }, slot5x5: { pet: 1100, web: 30 } };
// the 5x5's VIC-20 keeps the compact composer, which recomposes a reel whole and never hops
const GAMES = [['slot3x3', ['pet', 'vic20', 'web']], ['slot5x5', ['pet', 'web']]];


/** Every pixel of a decoded screenshot as one string, so two can be compared and a difference located. */
function dump(png) {
  const out = new Array(png.height);
  for (let y = 0; y < png.height; y += 1) {
    const row = new Array(png.width);
    for (let x = 0; x < png.width; x += 1) row[x] = png.at(x, y);
    out[y] = row.join(',');
  }
  return out;
}

for (const [game, machines] of GAMES) for (const machine of MACHINES.filter((m) => machines.includes(m))) {
  const skip = unavailable(machine) ?? (HAS_DEFINE ? false : 'the probe reads #define: set EIGHTBS_CHECKOUT to an 8BitScript checkout that has it');
  describe(`${game} on the ${machine}: hopping is the same picture as redrawing`, { skip }, () => {
    for (const step of [8, 16]) {
      test(`twenty moves of ${step} pixels: the spin's own path and a full redraw give the same screen`, async () => {
        const shoot = async (full) => dump(loadPng(await capture(machine, `${game}-hops`, `${game}-hops${step}-${full}`, FRAMES[game][machine], { HOPS: 20, STEP: step, FULL: full })));
        const walked = await shoot(0);
        const redrawn = await shoot(1);
        const rows = walked.map((r, y) => (r === redrawn[y] ? -1 : y)).filter((y) => y >= 0);
        assert.deepEqual(rows, [], `rows ${rows.slice(0, 10).join(', ')} differ between the hopped and the redrawn screen`);
        // not vacuous: the same program with no moves at all shows a different picture
        const still = dump(loadPng(await capture(machine, `${game}-hops`, `${game}-hops${step}-still`, FRAMES[game][machine], { HOPS: 0, STEP: step, FULL: 0 })));
        assert.notDeepEqual(still, walked, 'the reels moved: the walked screen is not the starting one');
      });
    }
  });
}
