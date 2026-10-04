// The bonus round's full-screen look on the real machines — headless, through each target's own
// emulator (`8bs run <t> --screenshot`; no window is ever opened). The twins themselves are held
// to one shape by test/fx.test.mjs (CI); this is what they DO.
//
// A machine's effect is tested through the border, the one place every raster effect can be seen
// and no game cell ever is: a column of border pixels read down the screen. For each machine that
// has an entry in FX below it holds the twin to these things ("Gold": docs/fx-brief.md):
//   * before the bonus round the border is one plain colour (begin() has not leaked into play);
//   * during the round the border shows the glow — at least 3 and at most `maxColours` colours down
//     the column (a rainbow of bars is what the first version was);
//   * the glow moves: two frames of the round differ in the border;
//   * NOTHING ELSE changes colour: in every sampled frame of the round the rows under the panel
//     (`free`) are the one plain colour they were before it (the first version flashed the whole
//     playfield a stripe colour in 4 frames of 16);
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
//
// kind 'pulse' is for a machine whose effect is not bars: the whole border takes one colour and changes it
// slowly between two (a breathing, one change in ten frames or more), and a marquee of lights runs down a
// column of cells nothing else is drawn in. frames are then six frames of the round spaced twelve apart,
// `marquee` an x inside that column and the picture rows to read it over. Every sampled frame must show
// exactly ONE border colour: a write that landed mid-frame would show two (the seam the first version
// had in 5 frames of 58).
//
// kind 'margins' is for a machine with no border and one ink (the PET): the effect is written into the cells
// beside the machine, so the test reads `columns` (x values, taken together down the screen) through those
// cells and holds the same four things: plain before, the effect during (at least `colours` colours, and at
// least `moved` pixels different between the two `frames`), and exactly the pixels it had before once the
// round is over.
const FX = {
  // The web and the C64 built through wasm run one game-loop pass to a video frame, so a step of the glow is
  // exactly 5 frames; the wasm C64 draws only the side borders (a picture-line list cannot name the border
  // above and below the 200 lines). `free` is the rows under the panel, which must never change colour.
  web: { frames: [1000, 1012], calm: [1003, 1020], before: 5, after: 7400, column: 2, maxColours: 7 },
  c64web: { frames: [1000, 1012], calm: [1003, 1020], before: 5, after: 7400, column: 2, maxColours: 7, free: { x0: 48, x1: 336, y0: 192, y1: 218 } },
  // The C64: seven 36-line stripes of a ten-notch ramp, one notch every 5 video frames (the handler counts
  // them); its VICE capture has a 32-pixel border. free: a rectangle of the picture nothing is drawn in.
  c64: { frames: [1000, 1012], calm: [1004, 1008, 1020], before: 60, after: 8000, column: 4, maxColours: 7, free: { x0: 48, x1: 336, y0: 192, y1: 218 } },
  // The VIC-20 cannot afford bars (a raster list held the reels back by 78%; see src/shared/fx.vic20.8bs): its
  // border breathes between red and yellow, one change in ten frames or more, written only at the top of the
  // frame. before is the first spin, after the round is long over; the border is x 0-39 of the capture, the
  // marquee the picture's last 16-pixel column (x 376-391).
  vic20: { kind: 'pulse', frames: [2400, 2412, 2424, 2436, 2448, 2460], before: 600, after: 13000, column: 10, marquee: { x: 384, rows: [24, 200] } },
  // The PET's effect is a marquee ring and a banner scanner written into the margins beside the machine
  // (src/shared/fx.pet.8bs). The 4032 is 40 columns; a capture's screen starts at pixel (32, 36), 8 pixels a
  // cell; the machine is columns 9-29. The columns read are the middle of margin cells: the ring on the two
  // edges (0 and 39) and the margin lanes beside the machine. The forced bonus round starts near frame 508
  // and ends near 3,957, so `before` is after the machine is drawn and before the round, and `after` is well
  // past it.
  pet: { kind: 'margins', frames: [3000, 3012], before: 400, after: 6000, columns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 31, 32, 33, 34, 35, 36, 37, 38, 39].map((c) => 32 + 8 * c + 4), colours: 2, moved: 40 },
  // The X16's border is 16 pixels wide once screen.8bs insets the picture: x = 8 is inside it. Its glow is a
  // palette cycle, twelve stripes of a 24-step gold table, one notch every 4 video frames.
  cx16: { frames: [1100, 1112], calm: [1104], before: 200, after: 4400, column: 8, maxColours: 14 },
};

/** The values down one column of a capture. */
const columnOf = (png, x) => Array.from({ length: png.height }, (_, y) => png.at(x, y));

/** The distinct values in a rectangle of a capture. */
const colorsIn = (png, { x0, x1, y0, y1 }) => {
  const seen = new Set();
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) seen.add(png.at(x, y));
  return seen.size;
};

for (const machine of MACHINES) {
  describe(`fx on the ${machine}`, () => {
    const why = unavailable(machine) ?? (FX[machine] ? null : `${machine}: no bonus effect measured yet (add its row to FX)`);
    const config = FX[machine];

    test('the border is plain before the round, glows during it, moves, and is plain again after; nothing else changes colour', { skip: why ?? (config.kind ? 'this machine has no border bars: its own test below holds it' : false) }, async () => {
      const shot = async (frames) => loadPng(await capture(machine, 'slot5x5-bonus', `fx-${frames}`, frames));
      const beforePng = await shot(config.before);
      const before = columnOf(beforePng, config.column);
      assert.equal(new Set(before).size, 1, 'one border colour before the bonus round');
      const freeBefore = config.free ? colorsIn(beforePng, config.free) : 1;
      if (config.free) assert.equal(freeBefore, 1, 'the free rows are one plain colour before the round');
      const freeColour = config.free ? beforePng.at(config.free.x0, config.free.y0) : null;

      const aPng = await shot(config.frames[0]);
      const a = columnOf(aPng, config.column);
      const b = columnOf(await shot(config.frames[1]), config.column);
      assert.ok(new Set(a).size >= 3, `a glow during the round: ${new Set(a).size} colours down the border`);
      assert.ok(new Set(a).size <= config.maxColours, `a glow, not a rainbow: ${new Set(a).size} colours down the border (at most ${config.maxColours})`);
      let moved = 0;
      for (let y = 0; y < a.length; y += 1) if (a[y] !== b[y]) moved += 1;
      assert.ok(moved >= 20, `the glow moves between frames ${config.frames.join(' and ')}: ${moved} border rows changed`);

      // Nothing but the border changes colour: the rows under the panel stay what they were in every
      // sampled frame, not only in the first.
      if (config.free) {
        for (const frames of [config.frames[0], ...config.calm]) {
          const png = frames === config.frames[0] ? aPng : await shot(frames);
          assert.equal(colorsIn(png, config.free), 1, `the free rows stay one plain colour at frame ${frames}`);
          assert.equal(png.at(config.free.x0, config.free.y0), freeColour, `the free rows stay the colour they were before the round, at frame ${frames}`);
        }
      }

      const afterPng = await shot(config.after);
      const after = columnOf(afterPng, config.column);
      assert.equal(new Set(after).size, 1, 'one border colour again once the round is over');
      if (config.free) assert.equal(colorsIn(afterPng, config.free), 1, 'the free rows are one plain colour again once the round is over');
      assert.deepEqual(after, before, 'the border is exactly what it was before the round');
    });

    test('the border breathes between two colours and the marquee runs during the round, and both are put back after', { skip: why ?? (config.kind === 'pulse' ? false : 'this machine does not pulse: another test holds it') }, async () => {
      const shot = async (frames) => loadPng(await capture(machine, 'slot5x5-bonus', `fx-${frames}`, frames));
      const [y0, y1] = config.marquee.rows;
      const marqueeOf = (png) => columnOf(png, config.marquee.x).slice(y0, y1);

      const beforeShot = await shot(config.before);
      const before = columnOf(beforeShot, config.column);
      const marqueeBefore = marqueeOf(beforeShot);
      assert.equal(new Set(before).size, 1, 'one border colour before the bonus round');
      assert.equal(new Set(marqueeBefore).size, 1, 'the marquee column is empty before the bonus round');

      const during = [];
      for (const frames of config.frames) during.push(await shot(frames));
      // The colour is written only at the top of the frame (the beam is read first, and it is written
      // within the first twenty lines), so a frame's border is one colour. On the frame of a change a
      // VICE capture, which stops at a cycle count and so can land partway down the picture, shows the
      // new colour above that point and the old below it: two colours in that one frame. So: never more
      // than two colours in a frame, and at most one of the sampled frames split; the old effect's seam
      // was in 5 frames of 58, a different row each time, with nothing to do with a change.
      const borders = during.map((png) => columnOf(png, config.column));
      const mainOf = (column) => {
        const counts = new Map();
        for (const v of column) counts.set(v, (counts.get(v) ?? 0) + 1);
        return [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
      };
      for (const [i, column] of borders.entries()) {
        assert.ok(new Set(column).size <= 2, `the border is at most two colours at frame ${config.frames[i]}: ${new Set(column).size}`);
      }
      const split = borders.filter((column) => new Set(column).size > 1).length;
      assert.ok(split <= 1, `at most one sampled frame shows a change in progress: ${split} of ${borders.length}`);
      const colours = new Set(borders.map((column) => mainOf(column)[0]));
      assert.equal(colours.size, 2, `the border breathes between exactly two colours over frames ${config.frames.join(', ')}: ${colours.size}`);
      let changes = 0;
      for (let i = 1; i < borders.length; i += 1) if (mainOf(borders[i])[0] !== mainOf(borders[i - 1])[0]) changes += 1;
      assert.ok(changes <= 3, `the border changes slowly: ${changes} changes over ${borders.length} frames twelve apart`);

      const marquees = during.map(marqueeOf);
      assert.ok(new Set(marquees[0]).size >= 3, `the marquee shows lights: ${new Set(marquees[0]).size} colours down its column`);
      let moved = 0;
      for (let y = 0; y < marquees[0].length; y += 1) if (marquees[0][y] !== marquees[1][y]) moved += 1;
      assert.ok(moved >= 8, `the lights move between frames ${config.frames[0]} and ${config.frames[1]}: ${moved} marquee rows changed`);

      const afterShot = await shot(config.after);
      assert.deepEqual(columnOf(afterShot, config.column), before, 'the border is exactly what it was before the round');
      assert.deepEqual(marqueeOf(afterShot), marqueeBefore, 'the marquee column is empty again once the round is over');
    });

    test('the margins show the effect during the round, it moves, and they are exactly as they were after', { skip: why ?? (config.kind === 'margins' ? false : 'this machine does not write into margins: another test holds it') }, async () => {
      const shot = async (frames) => loadPng(await capture(machine, 'slot5x5-bonus', `fx-${frames}`, frames));
      const read = (png) => config.columns.flatMap((x) => columnOf(png, x));

      const before = read(await shot(config.before));
      assert.equal(new Set(before).size, 1, 'the margins are one plain colour before the bonus round');

      const a = read(await shot(config.frames[0]));
      const b = read(await shot(config.frames[1]));
      assert.ok(new Set(a).size >= config.colours, `the effect during the round: ${new Set(a).size} colours in the margins (wanted ${config.colours})`);
      let moved = 0;
      for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) moved += 1;
      assert.ok(moved >= config.moved, `the effect moves between frames ${config.frames.join(' and ')}: ${moved} pixels changed (wanted ${config.moved})`);

      const after = read(await shot(config.after));
      assert.deepEqual(after, before, 'the margins are exactly what they were before the round');
    });
  });
}
