// Real captures of today's layouts, one PNG per game per machine, headless:
//   EIGHTBS_CHECKOUT=/path/to/8bitscript node tools/size/capture-today.mjs [machine ...]
// slot3x3-lines (a two-line win) and slot5x5-win (a 6,100-credit win) are the fixed-seed entries
// the screenshot tests use, so these are the same pictures as docs/slot3x3/at-rest.png.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture, MACHINES, unavailable } from '../../test/support/emulator.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'docs', 'reel-size', 'today');
mkdirSync(OUT, { recursive: true });
const asked = process.argv.slice(2);
const machines = (asked.length ? asked : MACHINES.filter((m) => m !== 'c64web'));
const GAMES = [['slot3x3', 'slot3x3-lines'], ['slot5x5', 'slot5x5-win']];
for (const machine of machines) {
  const why = unavailable(machine);
  if (why) { console.log(`skip ${machine}: ${why}`); continue; }
  for (const [game, program] of GAMES) {
    const png = await capture(machine, program, `today-${game}`, undefined);
    copyFileSync(png, join(OUT, `${game}-${machine}.png`));
    console.log(`${game} ${machine} -> ${join(OUT, `${game}-${machine}.png`)}`);
  }
}
