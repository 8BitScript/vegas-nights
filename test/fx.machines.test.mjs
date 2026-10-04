// The bonus round's full-screen look on the real machines — headless, through each target's own
// emulator (`8bs run <t> --screenshot`; no window is ever opened). The twins themselves are held
// to one shape by test/fx.test.mjs (CI); this is what they DO.
//
// A machine's effect is tested through the border, the one place every raster effect can be seen
// and no game cell ever is: a column of border pixels read down the screen. For each machine that
// has an entry in FX below it holds the twin to four things:
//   * before the bonus round the border is one plain colour (begin() has not leaked into play);
//   * during the round the border shows bars — several colours down the column;
//   * the bars move: two frames of the round differ, and the reels' own cells are not what changed;
//   * after the round ends the border is one plain colour again (end() restores everything).
// Add a machine by adding its row — the frames and the border column are the machine's own
// (a VICE capture has a different border from the web's) — and removing nothing else.
//
// It needs the emulators and minutes a machine, so it is `pnpm run test:machines`, not CI's
// `pnpm test`. MACHINES=web narrows a run; a machine whose emulator is missing is skipped by name.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MACHINES, unavailable, capture } from './support/emulator.mjs';
import { loadPng } from './support/screen.mjs';

// frames: [a, b] two frames inside the forced bonus round (the `slot5x5-bonus` entry: a seeded base
// spin lands three scatters, then 8 free spins); before: a frame before the first spin;
// after: a frame after the round and its pause are over (test/slot5x5.machines.test.mjs, ROUND);
// column: an x inside the left border.
const FX = {
  web: { frames: [1000, 1006], before: 5, after: 7400, column: 2 },
};

/** The values down one column of a capture. */
const columnOf = (png, x) => Array.from({ length: png.height }, (_, y) => png.at(x, y));

for (const machine of MACHINES) {
  describe(`fx on the ${machine}`, () => {
    const why = unavailable(machine) ?? (FX[machine] ? null : `${machine}: no bonus effect measured yet (add its row to FX)`);
    const config = FX[machine];

    test('the border is plain before the round, barred during it, moving, and plain again after', { skip: why ?? false }, async () => {
      const shot = async (frames) => loadPng(await capture(machine, 'slot5x5-bonus', `fx-${frames}`, frames));
      const before = columnOf(await shot(config.before), config.column);
      assert.equal(new Set(before).size, 1, 'one border colour before the bonus round');

      const a = columnOf(await shot(config.frames[0]), config.column);
      const b = columnOf(await shot(config.frames[1]), config.column);
      assert.ok(new Set(a).size >= 4, `bars during the round: ${new Set(a).size} colours down the border`);
      let moved = 0;
      for (let y = 0; y < a.length; y += 1) if (a[y] !== b[y]) moved += 1;
      assert.ok(moved >= 20, `the bars move between frames ${config.frames.join(' and ')}: ${moved} border rows changed`);

      const after = columnOf(await shot(config.after), config.column);
      assert.equal(new Set(after).size, 1, 'one border colour again once the round is over');
      assert.deepEqual(after, before, 'the border is exactly what it was before the round');
    });
  });
}
