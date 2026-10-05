// A strip of consecutive spin frames, for the eye: what tear-rate.mjs counts.
//
//   node scripts/spin-strip.mjs crop <machine> --from 434 --count 8 [--program lines] --out DIR
//        captures COUNT consecutive frames of the seeded 3x3 spin and writes the reel window of each
//        as DIR/f<N>.png (VICE's --frames is an exact cycle count, so one deterministic boot a frame)
//   node scripts/spin-strip.mjs sheet --row "before=DIR1" --row "after=DIR2" --out sheet.png [--scale 2]
//        stacks the frames of each directory into one row (frame numbers under each frame, a coloured
//        bar at the left of the row: the first row red, the next green, then blue), scaled to read
//
// Headless only: the CLI's own screenshot path. No image library: the PNG helpers are motion.mjs's.
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { calibrate, loadPng } from '../test/support/screen.mjs';
import { capture } from '../test/support/emulator.mjs';
import { adapterFor } from '../test/support/adapters.mjs';
import { decodePng } from '../test/support/png.mjs';
import { Canvas } from './motion.mjs';

const args = process.argv.slice(2);
const mode = args[0];
const at = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback);

if (mode === 'crop') {
  const machine = args[1];
  const from = Number(at('--from', 434));
  const count = Number(at('--count', 8));
  const program = at('--program', 'lines');
  const out = at('--out');
  mkdirSync(out, { recursive: true });
  const geo = calibrate(loadPng(await capture(machine, 'slot3x3-ruler', 'strip-ruler')));
  const win = adapterFor(machine, undefined).window;
  for (let f = from; f < from + count; f += 1) {
    const png = loadPng(await capture(machine, `slot3x3-${program}`, `strip${f}`, f));
    const left = Math.round(geo.x0 + win.col * geo.pitchX);
    const top = Math.round(geo.y0 + win.row * geo.pitchY);
    const width = Math.round(win.cols * geo.pitchX);
    const height = Math.round(win.rows * geo.pitchY);
    const canvas = new Canvas(width, height);
    canvas.blit(png, left, top, width, height, 0, 0, 1);
    canvas.save(join(out, `f${f}.png`));
    console.log(`frame ${f}`);
  }
} else if (mode === 'sheet') {
  const rows = [];
  for (let i = 1; i < args.length; i += 1) if (args[i] === '--row') rows.push(args[i + 1].split('='));
  const scale = Number(at('--scale', 2));
  const bars = [0xd04040, 0x40c060, 0x4080e0];
  const loaded = rows.map(([name, dir]) => ({
    name,
    frames: readdirSync(dir).filter((f) => /^f\d+\.png$/.test(f)).sort((a, b) => Number(a.slice(1, -4)) - Number(b.slice(1, -4)))
      .map((f) => ({ number: f.slice(1, -4), png: decodePng(readFileSync(join(dir, f))) })),
  }));
  const fw = Math.max(...loaded.flatMap((r) => r.frames.map((f) => f.png.width))) * scale;
  const fh = Math.max(...loaded.flatMap((r) => r.frames.map((f) => f.png.height))) * scale;
  const gap = 8;
  const bar = 8;
  const label = 20;
  const cols = Math.max(...loaded.map((r) => r.frames.length));
  const canvas = new Canvas(bar + gap + cols * (fw + gap), loaded.length * (fh + label + gap) + gap);
  loaded.forEach((row, r) => {
    const top = gap + r * (fh + label + gap);
    canvas.rect(0, top, bar, fh + label, bars[r % bars.length]);
    row.frames.forEach((fr, i) => {
      const left = bar + gap + i * (fw + gap);
      canvas.blit(fr.png, 0, 0, fr.png.width, fr.png.height, left, top, scale);
      canvas.text(left, top + fh + 4, fr.number, 0xdddddd, 2);
    });
  });
  canvas.save(at('--out'));
  console.log(`wrote ${at('--out')}`);
} else {
  console.error('usage: spin-strip.mjs crop <machine> --from N --count N --out DIR | spin-strip.mjs sheet --row "name=DIR" ... --out FILE');
  process.exit(2);
}
