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
    const g = labConsts('slot5x5', machine);
    return { top: g.TOP - 1, bottom: g.TOP + 5 * quadS(machine) };
  }
  const top = num(read('src/labs/slot5x5/view.8bs'), 'TOP');
  return { top: top - 1, bottom: top + 10 };
}

/** Cells a quadrant symbol is on a side in the 5x5 on `machine` (the generated cosmic tables: 4 on the PET and web, 3 on the VIC-20). */
export function quadS(machine) {
  return num(read(machine === 'vic20' ? 'src/generated/tiles/cosmic.quad.vic20.8bs' : machine === 'web' ? 'src/generated/tiles/cosmic.quad.web.8bs' : 'src/generated/tiles/cosmic.quad.8bs'), 'QUAD_S');
}

/** The block's width in cells, frame and dividers included, for `lab` on `machine`. */
export function blockWidth(lab, machine) {
  if (lab === 'slot3x3') return QUAD.has(machine) ? 22 : blockFor(machine).WIDTH;
  if (QUAD.has(machine)) return 5 * (quadS(machine) + 1) + 1;
  return num(read('src/labs/slot5x5/view.8bs'), 'WIDTH');
}

/** True when the 5x5's panel sits in the margin beside the block and not under it. */
export function panelBeside(lab, machine) {
  return lab === 'slot5x5' && (labConsts(lab, machine).PANEL_COL ?? 0) > 0;
}

/** The panel's text rows (everything printed under or beside the machine) as block rows. */
export function panelRows(lab, machine) {
  const v = labConsts(lab, machine);
  if (lab === 'slot3x3') return [v.CREDIT_ROW, v.BET_ROW, v.WIN_ROW, v.MESSAGE_ROW];
  if (panelBeside(lab, machine)) return [];   // beside the block: its rows are the frame's own
  return [0, 1, 2, 3, 4, 5].map((r) => v.PANEL + r);
}

/** The strings the game prints on its message row, from game.8bs. */
export function messages(lab) {
  const src = read(`src/labs/${lab}/game.8bs`);
  const body = /function message\([^)]*\): void \{([\s\S]*?)\n\}/.exec(src)[1];
  return [...body.matchAll(/text\.print\(at, "([^"]*)"\)/g)].map((m) => m[1]);
}
