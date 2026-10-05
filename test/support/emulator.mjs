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

/** True when this run can build programs that read `#define` (it is on 8BitScript's trunk, in no release yet). */
export const HAS_DEFINE = Boolean(CHECKOUT);

// `c64web` is the C64 built through the wasm backend (`8bs run c64 --web`) and painted by the
// page's own compositor: the same program as `c64`, run with no emulator. It needs an 8BitScript
// that has a C64 wasm port (EIGHTBS_CHECKOUT, or a release that has one).
export const MACHINES = (process.env.MACHINES ?? 'pet,vic20,c64,cx16,web,c64web').split(',');

// Which emulator each machine needs on PATH (web needs none).
const BINARY = { pet: 'xpet', vic20: 'xvic', c64: 'x64sc', cx16: 'x16emu', web: null, c64web: null };

// Where the emulators are installed (Homebrew on Apple silicon and Intel, the system
// bin directories): fixed locations, not a search of $PATH. The CLI finds the emulator
// itself when it runs; this only decides whether to skip a machine by name.
const EMULATOR_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/usr/games'];

/** Why `machine` cannot be tested here, or null if it can. */
export function unavailable(machine) {
  const bin = BINARY[machine];
  if (machine === 'c64web') {
    const twin = CHECKOUT
      ? join(CHECKOUT, 'packages', 'c64', 'src', 'input.c64.web.8bs')
      : join(ROOT, 'node_modules', '@8bitscript', 'c64', 'src', 'input.c64.web.8bs');
    if (!existsSync(twin)) return 'c64web: the pinned 8BitScript cannot build the C64 through wasm; set EIGHTBS_CHECKOUT to an 8BitScript checkout that can';
  }
  if (machine === 'web' && !CHECKOUT && !existsSync(join(ROOT, 'node_modules', '@8bitscript', 'web', 'src', 'charset.8bs'))) {
    return 'web: the pinned 8BitScript has no redefinable glyph table; set EIGHTBS_CHECKOUT to an 8BitScript checkout that does';
  }
  if (bin && !EMULATOR_DIRS.some((dir) => existsSync(join(dir, bin)))) return `${machine}: emulator not installed`;
  return null;
}

export function available(machine) {
  return unavailable(machine) === null;
}

export function capture(machine, program, name, frames, defines = {}) {
  const dir = join(ROOT, 'shots', 'tests');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${name}-${machine}.png`);
  // c64web is the C64's wasm build: the target is c64, with --web.
  const args = machine === 'c64web'
    ? [CLI, 'run', 'c64', '--web', '--program', program, '--screenshot', out]
    : [CLI, 'run', machine, '--program', program, '--screenshot', out];
  if (CHECKOUT) args.push('--checkout', CHECKOUT);
  // EIGHTBS_RUN_ARGS="--pal" adds options to every run (the C64 and VIC-20 timings differ in PAL: 312 lines a frame).
  args.push(...(process.env.EIGHTBS_RUN_ARGS ?? '').split(' ').filter(Boolean));
  for (const [key, value] of Object.entries(defines)) args.push('--define', `${key}=${value}`);
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
