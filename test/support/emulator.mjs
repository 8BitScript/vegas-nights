// Headless captures through the CLI — the same path `pnpm run shot:*` uses
// and CI-less machines run locally. Never opens a window.
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './table.mjs';

// MACHINES=c64,web narrows a run to those machines.
// The project's own 8bs, run by this node: no command name is looked up on $PATH.
//
// EIGHTBS_CHECKOUT=/path/to/8bitscript runs that checkout's CLI and builds against its
// packages (`--checkout`), for what is on 8BitScript's trunk but in no release yet. The
// web's pixel reels need it: they write the runtime's redefinable glyph table
// (@8bitscript/web/charset, 8BitScript #303), which the pinned release does not have.
// EIGHTBITSCRIPT_CHECKOUT, the variable the cli itself reads, works too.
const CHECKOUT = process.env.EIGHTBS_CHECKOUT ?? process.env.EIGHTBITSCRIPT_CHECKOUT;
const CLI = CHECKOUT
  ? join(CHECKOUT, 'packages', 'cli', 'bin', '8bs.mjs')
  : join(ROOT, 'node_modules', '@8bitscript', 'cli', 'bin', '8bs.mjs');

export const MACHINES = (process.env.MACHINES ?? 'pet,vic20,c64,cx16,web').split(',');

// Which emulator each machine needs on PATH (web needs none).
const BINARY = { pet: 'xpet', vic20: 'xvic', c64: 'x64sc', cx16: 'x16emu', web: null };

// Where the emulators are installed (Homebrew on Apple silicon and Intel, the system
// bin directories): fixed locations, not a search of $PATH. The CLI finds the emulator
// itself when it runs; this only decides whether to skip a machine by name.
const EMULATOR_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/usr/games'];

/** Why `machine` cannot be tested here, or null if it can. */
export function unavailable(machine) {
  const bin = BINARY[machine];
  if (machine === 'web' && !CHECKOUT && !existsSync(join(ROOT, 'node_modules', '@8bitscript', 'web', 'src', 'charset.8bs'))) {
    return 'web: the pinned 8BitScript has no redefinable glyph table; set EIGHTBS_CHECKOUT to an 8BitScript checkout that does';
  }
  if (bin && !EMULATOR_DIRS.some((dir) => existsSync(join(dir, bin)))) return `${machine}: emulator not installed`;
  return null;
}

export function available(machine) {
  return unavailable(machine) === null;
}

export function capture(machine, program, name, frames) {
  const dir = join(ROOT, 'shots', 'tests');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${name}-${machine}.png`);
  const args = [CLI, 'run', machine, '--program', program, '--screenshot', out];
  if (CHECKOUT) args.push('--checkout', CHECKOUT);
  if (frames !== undefined) args.push('--frames', String(frames));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 240_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && existsSync(out)) resolve(out);
      else reject(new Error(`8bs run ${machine} --program ${program} --frames ${frames}: exit ${code}\n${log.slice(-600)}`));
    });
  });
}
