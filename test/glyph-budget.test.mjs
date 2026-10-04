// The 3x3's glyph arithmetic, checked against the tile data. The 6502 sources state the machine's
// geometry as plain literals (src/labs/slot3x3/block.8bs, block.c64.8bs) because the compiler folds
// a literal and a 1 MHz machine should not work them out at run time; this test is where they are
// worked out, from the tile data (SYMBOL_CELLS_W / SYMBOL_CELLS_H), the engine's REELS and ROWS and
// the machine's glyph layer. Change the art's size and the test names the line to change. It needs
// no emulator, so CI runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTable, loadFile, blockFor, ROOT } from './support/table.mjs';

const game = loadTable().consts;

/** Every `const NAME: type = number;` of a hand-written source file. */
function constsOf(rel) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  const out = {};
  for (const m of text.matchAll(/^\s*const (\w+): \w+ = (\d+);/gm)) out[m[1]] = Number(m[2]);
  return out;
}

// The machines whose 3x3 composes glyph reels with view.8bs: the tile file each reads, the glyph layer.
const MACHINES = [
  { machine: 'c64', tiles: 'tiles/classic.8bs', glyphs: 'src/shared/glyphs.c64.8bs' },
  { machine: 'c64web', tiles: 'tiles/classic.8bs', glyphs: 'src/shared/glyphs.c64.web.8bs' },
  { machine: 'cx16', tiles: 'tiles/classic.cx16.8bs', glyphs: 'src/shared/glyphs.cx16.8bs' },
];

for (const { machine, tiles, glyphs } of MACHINES) {
  const t = loadFile(tiles).consts;
  const block = blockFor(machine);
  const g = constsOf(glyphs);
  const cw = t.SYMBOL_CELLS_W;
  const ch = t.SYMBOL_CELLS_H;

  test(`${machine}: block.8bs states the geometry of ${cw}x${ch}-cell symbols`, () => {
    const down = game.ROWS * ch;
    const pitch = cw + 1;
    const end = 4 + down; // the window starts on row 4; the frame's bottom edge is the row after it
    assert.deepEqual(
      {
        DOWN: block.DOWN, PER_REEL: block.PER_REEL, PITCH: block.PITCH, RIGHT: block.RIGHT, WIDTH: block.WIDTH,
        FRAME_AT: block.FRAME_AT, PIXELS: block.PIXELS, ARROW: block.ARROW, END: block.END,
        CREDIT: block.CREDIT, BET: block.BET, WIN: block.WIN, MESSAGE: block.MESSAGE, HINT: block.HINT,
      },
      {
        DOWN: down, PER_REEL: down * cw, PITCH: pitch, RIGHT: game.REELS * pitch, WIDTH: game.REELS * pitch + 1,
        FRAME_AT: game.REELS * down * cw, PIXELS: ch * 8, ARROW: 4 + ch + (ch >> 1), END: end,
        CREDIT: end + 2, BET: end + 3, WIN: end + 4, MESSAGE: end + 6, HINT: end + 8,
      },
      'a literal in block.8bs is stale for these symbols',
    );
  });

  test(`${machine}: the reels and the frame fit the glyph codes the machine has`, () => {
    const total = block.FRAME_AT + t.FRAME_CELLS;
    const first = g.FIRST - (g.EXTRA ?? 0);
    assert.ok(total <= g.CODES + (g.EXTRA ?? 0), `${total} glyphs needed, ${g.CODES + (g.EXTRA ?? 0)} codes available`);
    assert.ok(first + total - 1 <= g.FIRST + g.CODES - 1, 'the last glyph code is past the last free code');
    // codes under FIRST are free only where the text never draws them: the portable text is
    // letters, digits and marks, all below screen code 91 on the C64
    assert.ok(first >= 91 || !g.EXTRA, `the block would start at code ${first}, inside the range the text draws`);
  });
}

test('the C64 stages the whole tileset and every strip into the RAM the composer reads', () => {
  const t = loadFile('tiles/classic.8bs').consts;
  const g = readFileSync(join(ROOT, 'src/shared/glyphs.c64.8bs'), 'utf8');
  const tiles = Number(/let tileBytes: array<utinyint, (\d+)>/.exec(g)[1]);
  const strips = Number(/let stripBytes: array<utinyint, (\d+)>/.exec(g)[1]);
  const symbolTables = Number(/let symbolLow: array<utinyint, (\d+)>/.exec(g)[1]);
  assert.ok(t.ART_SYMBOLS * t.SYMBOL_BYTES <= tiles, 'the tileset is bigger than the buffer at $C000');
  assert.ok(game.REELS * game.STOPS <= strips, 'the strips are bigger than the buffer at $C400');
  assert.ok(t.ART_SYMBOLS <= symbolTables, 'more symbols than the offset table holds');
  assert.equal(t.SYMBOL_BYTES, t.SYMBOL_CELLS_W * t.SYMBOL_CELLS_H * 8);
});

test('the C64 hop divides a symbol, so a reel lands on its stop', () => {
  const t = loadFile('tiles/classic.8bs').consts;
  const feel = constsOf('src/shared/feel.c64.8bs');
  const pixels = t.SYMBOL_CELLS_H * 8;
  // reelscroll.8bs: REEL_FAR a redraw far out, 8 within four symbols, 4 within EASE, 2 for the last 8 pixels
  assert.equal(pixels % feel.REEL_FAR, 0, `feel.c64.8bs REEL_FAR=${feel.REEL_FAR} does not divide a ${pixels}-pixel symbol`);
  assert.ok(feel.REEL_FAR <= pixels);
  assert.equal(feel.EASE, pixels, 'EASE is a symbol in pixels');
});
