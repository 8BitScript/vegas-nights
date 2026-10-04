// The cell-exact proof: build the tile-test lab for each machine, take a headless
// screenshot through the target's own emulator (`8bs run --screenshot`; no window),
// and compare it with the screen the generated tables say it should be — ink on
// exactly the expected pixels, paper everywhere else, one RGB per colour index.
// Skipped where there is no emulator or no local `8bs` (CI builds the lab but cannot
// run the machines). Geometry is where each emulator puts the text grid in its
// screenshot, found once with findOffset() and pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodePng } from '../src/png.mjs';
import { loadTheme, ROOT } from '../src/theme.mjs';
import { convertTheme } from '../src/build.mjs';
import { expectedScreen } from '../src/layout.mjs';
import { compare } from '../src/shotcheck.mjs';

const MACHINES = {
  pet: { binary: 'xpet', cols: 40, rows: 25, geometry: { left: 32, top: 36 } },
  c64: { binary: 'x64sc', cols: 40, rows: 25, geometry: { left: 32, top: 23 } },
  vic20: { binary: 'xvic', cols: 22, rows: 23, geometry: { left: 40, top: 22, sx: 2 } }, // the VIC's pixels are twice as wide in the shot
  cx16: { binary: 'x16emu', cols: 76, rows: 56, geometry: { left: 16, top: 17 } },
};

const have = (binary) => spawnSync('which', [binary]).status === 0;
const cli = existsSync(join(ROOT, 'node_modules', '.bin', '8bs'));
const theme = await loadTheme('classic');
const scratch = mkdtempSync(join(tmpdir(), 'tiles-'));

for (const [machine, spec] of Object.entries(MACHINES)) {
  const skip = !cli ? 'no local 8bs (run pnpm install)' : !have(spec.binary) ? `no ${spec.binary} installed` : false;
  test(`under ${spec.binary}, the classic tiles on the ${machine} are exactly what the tables say`, { skip, timeout: 240000 }, () => {
    const out = join(scratch, `${machine}.png`);
    const run = spawnSync('pnpm', ['exec', '8bs', 'run', machine, '--program', 'tile-test', '--screenshot', out], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(run.status, 0, `8bs run failed: ${run.stderr}`);
    const png = decodePng(readFileSync(out));
    const expected = expectedScreen(machine, convertTheme(theme, machine), spec.cols, spec.rows);
    const r = compare(png, expected, spec.geometry);
    assert.equal(r.wrongInk, 0, 'every expected ink pixel is on screen');
    assert.equal(r.wrongPaper, 0, 'no paper pixel is ink');
    assert.equal(r.inconsistent, 0, 'each colour index is one colour on screen');
    assert.equal(r.collisions, 0, 'no two colour indexes share a colour on screen');
    assert.ok(r.inkSeen > 5000, `${r.inkSeen} ink pixels checked`);
    // the test can fail: an expected pixel the table lacks, or has extra, must be caught
    const bad = { ...expected, px: expected.px.slice() };
    bad.px[bad.px.findIndex((v) => v >= 0)] = -1;
    assert.ok(compare(png, bad, spec.geometry).wrongPaper >= 1, 'ink the tables do not predict is detected');
    const extra = { ...expected, px: expected.px.slice() };
    extra.px[extra.px.findIndex((v) => v < 0)] = 1;
    assert.ok(compare(png, extra, spec.geometry).wrongInk >= 1, 'ink the tables predict but the screen lacks is detected');
  });
}

test('every generated table passes 8bs check', { skip: cli ? false : 'no local 8bs (run pnpm install)' }, () => {
  const files = ['classic', 'classic.vic20', 'classic.cx16', 'classic.web', 'classic.pet'].map((n) => join('src', 'generated', 'tiles', `${n}.8bs`));
  const run = spawnSync('pnpm', ['exec', '8bs', 'check', ...files], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /No problems found/);
});
