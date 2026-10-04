// Capture one headless screenshot per machine for a lab program:
//
//   pnpm run shot:hello-reels            # all five machines
//   node scripts/shot.mjs hello-reels c64 web
//
// Each shot is written to shots/<program>-<target>.png through the target's
// own emulator API (`8bs run <target> --screenshot`), without opening a
// window. `--frames` is left at each target's default; see
// docs/setup/verify.md#screenshots in the 8bitscript repository.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const ALL = ['pet', 'vic20', 'c64', 'cx16', 'web'];
const [program, ...asked] = process.argv.slice(2);
if (!program) {
  console.error('usage: node scripts/shot.mjs <program> [target...]');
  process.exit(2);
}
const targets = asked.length > 0 ? asked : ALL;
mkdirSync('shots', { recursive: true });

let failed = 0;
for (const target of targets) {
  const out = `shots/${program}-${target}.png`;
  const run = spawnSync(
    'pnpm',
    ['exec', '8bs', 'run', target, '--program', program, '--screenshot', out],
    { stdio: 'inherit' },
  );
  if (run.status !== 0) {
    console.error(`shot: ${program} on ${target} failed (exit ${run.status})`);
    failed += 1;
  }
}
process.exit(failed === 0 ? 0 : 1);
