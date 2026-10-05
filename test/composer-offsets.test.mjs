// The reel composers, held still at every pixel offset.
//
// A reel is drawn by copying bytes out of the symbols' bitmaps at a pixel offset into the
// glyphs (or, on the PET and VIC-20, by choosing a quadrant block from two rows of the
// symbol). The other tests sample a reel at rest and during a spin, which visits only some
// offsets; a copy that is wrong at the others shows as a brief glitch in the last frames of
// every spin (the 3x3's C64 composer once read the wrong rows at 1, 2, 3, 5, 6 and 7 pixels
// into a cell row, and nothing sampled saw it). This test draws the reels at each offset a
// composer works at, once each, and compares every pixel of every reel with the picture the
// tile data and the strip say it must be. It does both games, the 3x3 and the 5x5:
//
//   * the pixel machines (C64, X16, and the web's 3x3): ROW = 0-7 pixels into a cell row, all
//     eight, with each further reel 8 pixels on, so every band of a symbol is checked;
//   * the quadrant machines (PET, VIC-20, and the web's 5x5): the window moves in rows of
//     four pixels, so the offsets that differ are 0 and 4.
//
// It reads a `#define` (src/labs/slot3x3/offsets.8bs, src/labs/slot5x5/offsets.8bs), which is on
// 8BitScript's trunk but in no release yet, so it needs EIGHTBS_CHECKOUT=/path/to/8bitscript.
// Like the other machine tests it needs the emulators and is `pnpm run test:machines`, not
// part of CI's `pnpm test`. MACHINES=c64,web narrows a run.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTable } from './support/table.mjs';
import { MACHINES, unavailable, capture, HAS_DEFINE } from './support/emulator.mjs';
import { calibrate, loadPng } from './support/screen.mjs';
import { adapterFor, inkReader } from './support/adapters.mjs';
import { KIND as KIND5, pixelAdapter, quadAdapter, x16Adapter } from './support/adapters5.mjs';

// A frame by which the machine has booted and drawn the reels (the VICE machines spend ~215
// frames booting), per machine.
const FRAMES = { c64: 330, vic20: 330, pet: 300, cx16: 140, web: 30, c64web: 30 };
// The stop the first reel shows; the probe puts each further reel 5 stops on from the last.
const STOPS_TRIED = [3, 11];

const GAMES = [
  { name: '3x3', program: 'slot3x3-offset', ruler: 'slot3x3-ruler', consts: loadTable().consts, adapter: (machine) => adapterFor(machine, undefined) },
  { name: '5x5', program: 'slot5x5-offset', ruler: 'slot5x5-ruler', consts: loadTable('grid5x5').consts, adapter: (machine) => (KIND5[machine] === 'sprite' ? x16Adapter() : KIND5[machine] === 'pixel' ? pixelAdapter(machine) : quadAdapter(machine)) },
];

for (const machine of MACHINES) {
  const skip = unavailable(machine) ?? (HAS_DEFINE ? false : 'the probe reads #define: set EIGHTBS_CHECKOUT to an 8BitScript checkout that has it');
  for (const game of GAMES) {
    describe(`${machine} ${game.name}: reels held at each pixel offset`, { skip }, () => {
      const c = game.consts;
      const adapter = game.adapter(machine);
      // Pixels in a symbol on this machine: 24, 16 where the art is 16x16 (the web's 3x3, the 5x5 on C64 and X16).
      const symbolPixels = adapter.unit === 'pixel' ? adapter.unitsPerSymbol : (adapter.symbolPixels ?? adapter.unitsPerSymbol * adapter.pxPerUnit);
      const pixel = adapter.unit === 'pixel';
      let geo;

      test('reads the screen: cell size from the ruler', async () => {
        geo = calibrate(loadPng(await capture(machine, game.ruler, `${game.name}-ruler`)));
      });

      // The offsets that differ: every pixel on the pixel machines, one in four on the quadrant ones.
      // The pixel machines also draw a few that cross a cell row: the probe puts each further reel 8
      // pixels on, so 0-7 already visit the first three bands of a symbol, and the later ones reach
      // the fourth band of a 32-pixel symbol (the C64's) and its last row (11 = band 1 + 3, 21 =
      // band 2 + 5, 31 = band 3 + 7; only those that fit inside this machine's symbol).
      const rows = pixel ? [0, 1, 2, 3, 4, 5, 6, 7, 11, 21, 31].filter((r) => r < symbolPixels) : [0, 4];
      for (const row of rows) {
        for (const stop of STOPS_TRIED) {
          test(`${row} pixel${row === 1 ? '' : 's'} into ${row < 8 ? 'a cell row' : 'its symbol'}, first reel at stop ${stop}: every reel is exactly the strip's picture`, async () => {
            const png = loadPng(await capture(machine, game.program, `${game.name}-offset${row}-${stop}`, FRAMES[machine], { ROW: row, STOP: stop }));
            const ink = inkReader(png);
            for (let reel = 0; reel < c.REELS; reel += 1) {
              // where the probe pinned this reel: its stop, and the pixels into that symbol (wrapped at its height)
              const at = (row + reel * 8) % symbolPixels;
              const symbolStop = (stop + reel * 5) & c.STOP_MASK;
              const position = symbolStop * adapter.unitsPerSymbol + (pixel ? at : at >> 2);
              const want = adapter.expected(reel, position).split(',');
              const got = adapter.observe(png, geo, ink, reel).split(',');
              const wrong = want.map((v, i) => (v === got[i] ? -1 : i)).filter((i) => i >= 0);
              assert.deepEqual(wrong, [], `reel ${reel} (${at} px into stop ${symbolStop}): window ${pixel ? 'pixel rows' : 'cells'} ${wrong.slice(0, 8).join(', ')}${wrong.length > 8 ? ', …' : ''} differ — expected ${want[wrong[0]]}, saw ${got[wrong[0]]}`);
            }
          });
        }
      }
    });
  }
}
