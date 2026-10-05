// The panel's layout, from the sources: one blank row between the frame and the first line of text under it, no
// message that repeats a label, no message too long for its row. (The on-screen half, which reads the pixels, is in
// machines.test.mjs and slot5x5.machines.test.mjs.) Two 5x5 layouts have no spare row, and are listed, not skipped
// silently: the VIC-20's (22 columns and 23 rows hold the frame, 17 rows, and six panel lines), and the PET's, whose
// bonus banner prints on row 23, the row a panel one lower would end on (the PET and web 5x5 move their panel into
// the margin beside a bigger block in the next change, which removes the exception).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { frame, panelRows, messages } from './support/geometry.mjs';
import { labConsts } from './support/table.mjs';

const MACHINES = ['pet', 'vic20', 'c64', 'cx16', 'web'];
const NO_SPARE_ROW = new Set(['slot5x5/vic20', 'slot5x5/pet']);
const LABELS = ['CREDIT', 'BET', 'WIN', 'CR', 'FS', 'MI', 'MN', 'MJ', 'GR'];

for (const lab of ['slot3x3', 'slot5x5']) {
  describe(lab, () => {
    for (const machine of MACHINES) {
      test(`${machine}: a blank row under the frame, then the panel`, { skip: NO_SPARE_ROW.has(`${lab}/${machine}`) }, () => {
        const f = frame(lab, machine);
        for (const row of panelRows(lab, machine)) {
          // a line above the frame (the VIC-20's win and message) may sit against its top border; one below needs a gap
          assert.ok(row < f.top || row >= f.bottom + 2, `row ${row} is against the frame (its bottom border is row ${f.bottom})`);
        }
      });
    }

    test('the messages repeat no label and fit the message row', () => {
      const all = messages(lab);
      assert.ok(all.length >= 6, 'the message function was not found');
      for (const m of all) assert.ok(!LABELS.includes(m), `the message "${m}" is also a label on the panel`);
      for (const machine of MACHINES) {
        const width = lab === 'slot3x3' ? (labConsts(lab, machine).MESSAGE_WIDTH ?? 20) : 21;
        // the VIC-20's 3x3 message shares its row with the win: 11 columns
        for (const m of all) assert.ok(m.length <= width, `"${m}" is ${m.length} columns; ${machine}'s message row holds ${width}`);
      }
    });
  });
}
