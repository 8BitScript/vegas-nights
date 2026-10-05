// Where the machine's frame and panel sit, read from the sources (the same constants the 6502 build uses), so the
// panel tests and the 6502 cannot disagree. Rows are block rows: the screen's own rows, counted from 0.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { labConsts, blockFor, ROOT } from './table.mjs';

const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const num = (text, name) => Number(new RegExp(`const ${name}: \\w+ = (\\d+);`).exec(text)?.[1]);

/** The machines that draw their reels from the ROM's quadrant blocks (the others redefine glyphs). */
export const QUAD = new Set(['pet', 'vic20', 'web']);

/** The row of the frame's bottom border, and of its top border, for `lab` ('slot3x3' | 'slot5x5') on `machine`. */
export function frame(lab, machine) {
  if (lab === 'slot3x3') {
    if (QUAD.has(machine)) {
      const top = num(read('src/labs/slot3x3/quad.8bs'), 'TOP');
      const s = num(read('src/generated/tiles/classic.quad.8bs'), 'QUAD_S');
      return { top: top - 1, bottom: top + 3 * s };
    }
    return { top: 1, bottom: blockFor(machine).END };
  }
  if (QUAD.has(machine)) {
    const top = num(read('src/labs/slot5x5/quad.8bs'), 'TOP');
    return { top: top - 1, bottom: top + 5 * 3 };
  }
  const top = num(read('src/labs/slot5x5/view.8bs'), 'TOP');
  return { top: top - 1, bottom: top + 10 };
}

/** The panel's text rows (everything printed under or beside the machine) as block rows. */
export function panelRows(lab, machine) {
  const v = labConsts(lab, machine);
  if (lab === 'slot3x3') return [v.CREDIT_ROW, v.BET_ROW, v.WIN_ROW, v.MESSAGE_ROW];
  return [0, 1, 2, 3, 4, 5].map((r) => v.PANEL + r);
}

/** The strings the game prints on its message row, from game.8bs. */
export function messages(lab) {
  const src = read(`src/labs/${lab}/game.8bs`);
  const body = /function message\([^)]*\): void \{([\s\S]*?)\n\}/.exec(src)[1];
  return [...body.matchAll(/text\.print\(at, "([^"]*)"\)/g)].map((m) => m[1]);
}
