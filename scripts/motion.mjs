// Motion strips of the bonus round: what a single screenshot cannot show.
//
// The bonus round's full-screen look (src/shared/fx.<machine>.8bs) was judged from still
// screenshots, which cannot show flicker, strobing, a stripe that jumps, or tearing. This
// captures CONSECUTIVE video frames of the seeded, forced bonus round (the `slot5x5-bonus`
// program, the one test/fx.machines.test.mjs uses) and turns them into things an eye can read:
//
//   node scripts/motion.mjs capture <machine> [--start N] [--count 16] [--long 48 --step 3]
//        one deterministic boot per frame (VICE's --frames is an exact cycle count, the web
//        and c64web builds count waitFrame() calls), into shots/motion/<machine>/f<N>.png
//   node scripts/motion.mjs cx16 [--seconds 26] [--skip 18]
//        one x16emu session recorded with -gif (wall-clock, so not frame-exact), extracted
//        with ffmpeg at the GIF's own frame rate
//   node scripts/motion.mjs sheet <machine>      labelled grid of the consecutive frames
//   node scripts/motion.mjs spacetime <machine>  one border column per frame, side by side:
//                                                 a scrolling stripe is a slanted band, a static
//                                                 one a vertical band, a jumping one a break
//   node scripts/motion.mjs gif <machine>        animated GIF of the consecutive frames
//   node scripts/motion.mjs analyze <machine>    numbers: colours, changed area, stripe speed
//   node scripts/motion.mjs all <machine>        capture + sheet + spacetime + gif + analyze
//
// Output lands in docs/motion/<machine>/ (or docs/motion/$MOTION_VARIANT/<machine>/) (committed: sheets, diagrams, GIFs, analysis) and
// shots/motion/<machine>/ (raw frames, not committed). Headless only: the CLI's own screenshot
// path, never an interactive emulator window beyond what that path itself does.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from '../test/support/table.mjs';
import { capture, unavailable } from '../test/support/emulator.mjs';
import { decodePng } from '../test/support/png.mjs';

const PROGRAM = 'slot5x5-bonus';

// Where in the forced bonus round to look, per machine: `start` is a frame inside it (the same
// frames test/fx.machines.test.mjs reads), `before` one before the first spin, and `column` an x
// inside the left border (the stripes' column).
export const MACHINES = {
  c64: { start: 1000, before: 60, column: 4 },
  c64web: { start: 1000, before: 5, column: 2 },
  vic20: { start: 2400, before: 600, column: 10 },
  pet: { start: 3000, before: 400, column: 36 },
  web: { start: 1000, before: 5, column: 2 },
  cx16: { start: 1100, before: 200, column: 8 },
};

// An external tool by absolute path, from the directories a package manager installs to, never through
// a PATH lookup that a writable directory could shadow.
const TOOL_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
const tool = (name) => {
  const found = TOOL_DIRS.map((dir) => join(dir, name)).find((file) => existsSync(file));
  if (!found) throw new Error(`${name} not found in ${TOOL_DIRS.join(', ')}`);
  return found;
};

const framesDir = (m) => join(ROOT, 'shots', 'motion', m);
// MOTION_VARIANT=gold writes docs/motion/gold/<machine>/ and leaves the baseline strips of the brief
// (docs/motion/<machine>/) as they are, so a re-run can be compared against them.
const outDir = (m) => (process.env.MOTION_VARIANT ? join(ROOT, 'docs', 'motion', process.env.MOTION_VARIANT, m) : join(ROOT, 'docs', 'motion', m));
const ensure = (d) => { mkdirSync(d, { recursive: true }); return d; };
const load = (file) => decodePng(readFileSync(file));

// ---- PNG output (RGB, no filter) and a 3x5 digit font for labels --------------------------
const CRC = (() => {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  return (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(CRC(body));
  return Buffer.concat([head, body, tail]);
};
function writePng(file, width, height, rgb) {
  const raw = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y += 1) rgb.copy(raw, y * (1 + width * 3) + 1, y * width * 3, (y + 1) * width * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
export class Canvas {
  constructor(w, h, bg = 0x202020) {
    this.w = w; this.h = h; this.rgb = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i += 1) this.set(i % w, Math.floor(i / w), bg);
  }
  set(x, y, v) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 3;
    this.rgb[o] = (v >> 16) & 255; this.rgb[o + 1] = (v >> 8) & 255; this.rgb[o + 2] = v & 255;
  }
  rect(x, y, w, h, v) { for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) this.set(x + i, y + j, v); }
  /** Blit a decoded PNG's rectangle at (dx, dy), scaled up by a whole factor. */
  blit(png, sx, sy, sw, sh, dx, dy, scale) {
    for (let y = 0; y < sh * scale; y += 1) {
      const py = sy + Math.floor(y / scale);
      for (let x = 0; x < sw * scale; x += 1) this.set(dx + x, dy + y, png.at(sx + Math.floor(x / scale), py));
    }
  }
  text(x, y, str, v = 0xffffff, scale = 2) {
    let cx = x;
    for (const ch of String(str)) {
      const g = FONT[ch];
      if (g) for (let r = 0; r < 5; r += 1) for (let c = 0; c < 3; c += 1) if (g[r] & (4 >> c)) this.rect(cx + c * scale, y + r * scale, scale, scale, v);
      cx += 4 * scale;
    }
  }
  save(file) { writePng(file, this.w, this.h, this.rgb); }
}
const FONT = {
  0: [7, 5, 5, 5, 7], 1: [2, 6, 2, 2, 7], 2: [7, 1, 7, 4, 7], 3: [7, 1, 7, 1, 7], 4: [5, 5, 7, 1, 1],
  5: [7, 4, 7, 1, 7], 6: [7, 4, 7, 5, 7], 7: [7, 1, 1, 1, 1], 8: [7, 5, 7, 5, 7], 9: [7, 5, 7, 1, 7],
  '-': [0, 0, 7, 0, 0], '+': [0, 2, 7, 2, 0], ' ': [0, 0, 0, 0, 0],
};

// ---- capture --------------------------------------------------------------------------------
const frameFile = (m, n) => join(framesDir(m), `f${n}.png`);

/** Run `jobs` (async thunks) `width` at a time. */
async function pool(jobs, width) {
  let next = 0;
  const worker = async () => { while (next < jobs.length) { const i = next; next += 1; await jobs[i](); } };
  await Promise.all(Array.from({ length: width }, worker));
}

async function captureFrames(machine, frames, concurrency) {
  ensure(framesDir(machine));
  const why = unavailable(machine);
  if (why) throw new Error(why);
  const todo = [...new Set(frames)].filter((n) => !existsSync(frameFile(machine, n)));
  let done = 0;
  await pool(todo.map((n) => async () => {
    const out = await capture(machine, PROGRAM, `motion-${n}`, n);
    writeFileSync(frameFile(machine, n), readFileSync(out));
    done += 1;
    if (done % 10 === 0) console.log(`${machine}: ${done}/${todo.length}`);
  }), concurrency);
}

function plan(machine, opts) {
  const base = opts.start ?? MACHINES[machine].start;
  const consecutive = Array.from({ length: opts.count ?? 16 }, (_, i) => base + i);
  const long = Array.from({ length: opts.long ?? 48 }, (_, i) => base + i * (opts.step ?? 3));
  return { base, consecutive, long, before: MACHINES[machine].before };
}

// ---- stitched outputs ------------------------------------------------------------------------
function listFrames(machine, frames) {
  return frames.filter((n) => existsSync(frameFile(machine, n)));
}

/** A labelled grid of `frames` at whole-pixel `scale`, `cols` across. */
function sheet(machine, frames, file, { cols = 4, scale = 1, crop } = {}) {
  const png0 = load(frameFile(machine, frames[0]));
  const r = crop ?? { x: 0, y: 0, w: png0.width, h: png0.height };
  const cw = r.w * scale, ch = r.h * scale, pad = 6, label = 16;
  const rows = Math.ceil(frames.length / cols);
  const c = new Canvas(cols * (cw + pad) + pad, rows * (ch + label + pad) + pad);
  frames.forEach((n, i) => {
    const x = pad + (i % cols) * (cw + pad), y = pad + Math.floor(i / cols) * (ch + label + pad);
    c.text(x, y + 2, n, 0xffffff, 2);
    c.blit(load(frameFile(machine, n)), r.x, r.y, r.w, r.h, x, y + label, scale);
  });
  c.save(file);
  console.log(`${file}: ${c.w}x${c.h}`);
}

/** One pixel column per frame, side by side; `colW` pixels wide each; frame numbers every `tick`. */
function spacetime(machine, frames, x, file, { colW = 6, scale = 2, tick = 4 } = {}) {
  const first = load(frameFile(machine, frames[0]));
  const top = 14;
  const c = new Canvas(frames.length * colW + 8, first.height * scale + top + 4);
  frames.forEach((n, i) => {
    const png = load(frameFile(machine, n));
    for (let y = 0; y < png.height; y += 1) c.rect(4 + i * colW, top + y * scale, colW, scale, png.at(x, y));
    if (i % tick === 0) c.text(4 + i * colW, 2, n - frames[0], 0xffffff, 1);
  });
  c.save(file);
  console.log(`${file}: ${c.w}x${c.h}`);
}

/** The same rectangle from several frames stacked in a column, scaled up: for banners and reel edges. */
function cropStack(machine, frames, rect, scale, file) {
  const label = 14, pad = 4;
  const c = new Canvas(rect.w * scale + 8 * 5 + pad * 2, frames.length * (rect.h * scale + pad) + pad);
  frames.forEach((n, i) => {
    const y = pad + i * (rect.h * scale + pad);
    c.text(pad, y + 2, n, 0xffffff, 1);
    c.blit(load(frameFile(machine, n)), rect.x, rect.y, rect.w, rect.h, 8 * 5 + pad, y, scale);
  });
  c.save(file);
  console.log(`${file}: ${c.w}x${c.h}`);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`))));
  });
}

async function gif(machine, frames, file, { fps = 12, scale = 2 } = {}) {
  const list = join(tmpdir(), `motion-${machine}-${process.pid}.txt`);
  writeFileSync(list, frames.map((n) => `file '${frameFile(machine, n)}'\nduration ${1 / fps}`).join('\n') + `\nfile '${frameFile(machine, frames.at(-1))}'\n`);
  await run(tool('ffmpeg'), ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf',
    `scale=iw*${scale}:ih*${scale}:flags=neighbor,split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=none`, '-loop', '0', file]);
  rmSync(list, { force: true });
  console.log(`${file}`);
}

// ---- analysis --------------------------------------------------------------------------------
const colorsOf = (png) => { const s = new Set(); for (let y = 0; y < png.height; y += 1) for (let x = 0; x < png.width; x += 1) s.add(png.at(x, y)); return s; };
const columnOf = (png, x) => Array.from({ length: png.height }, (_, y) => png.at(x, y));
/** Runs of equal colour down a column: [{ color, length }]. */
function runsOf(col) {
  const runs = [];
  for (const v of col) { if (runs.length && runs.at(-1).color === v) runs.at(-1).length += 1; else runs.push({ color: v, length: 1 }); }
  return runs;
}
/** How many lines the column moved between two frames (positive = down): the shift with the fewest mismatches. */
function shiftBetween(a, b, max = 24) {
  let best = { shift: 0, miss: Infinity };
  for (let s = -max; s <= max; s += 1) {
    let miss = 0, n = 0;
    for (let y = Math.max(0, s); y < Math.min(a.length, a.length + s); y += 1) { n += 1; if (b[y] !== a[y - s]) miss += 1; }
    const rate = miss / n;
    if (rate < best.miss) best = { shift: s, miss: rate };
  }
  return best;
}


/** The most common colour in a capture and its share of the pixels. */
function modal(png) {
  const counts = new Map();
  for (let y = 0; y < png.height; y += 1) for (let x = 0; x < png.width; x += 1) { const v = png.at(x, y); counts.set(v, (counts.get(v) ?? 0) + 1); }
  const [color, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { color, share: n / (png.width * png.height) };
}

/**
 * Whole-screen flashes: frames whose most common colour is not the round's usual one (the black the
 * playfield is meant to stay), over every captured frame of the machine. A frame is a flash when its
 * modal colour differs from the sequence's and covers more than a fifth of the picture.
 */
function flashes(machine, frames) {
  const shots = frames.map((n) => ({ n, ...modal(load(frameFile(machine, n))) }));
  const usual = [...shots.reduce((m, s) => m.set(s.color, (m.get(s.color) ?? 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1])[0][0];
  const bad = shots.filter((s) => s.color !== usual && s.share > 0.2);
  return { frames: shots.length, usual: usual.toString(16).padStart(6, '0'), flashFrames: bad.map((s) => s.n), flashPct: +(100 * bad.length / shots.length).toFixed(1) };
}

/** Stripe steps: how many frames between changes of the border column's pattern, from the shift series. */
function stepFrames(rows) {
  const shifts = rows.filter((r) => r.shift !== undefined).map((r) => r.shift);
  const moves = shifts.filter((v) => v !== 0);
  return { shifts, meanAbsShift: +(moves.reduce((a, v) => a + Math.abs(v), 0) / Math.max(1, moves.length)).toFixed(1), framesMoving: moves.length, of: shifts.length };
}

function analyze(machine, frames, beforeFrame, column) {
  const pre = existsSync(frameFile(machine, beforeFrame)) ? load(frameFile(machine, beforeFrame)) : null;
  const rows = [];
  let prev = null;
  for (const n of frames) {
    const png = load(frameFile(machine, n));
    const col = columnOf(png, column);
    const row = { frame: n, colours: colorsOf(png).size, borderColours: new Set(col).size, stripes: runsOf(col).length };
    if (prev) {
      let changed = 0, borderChanged = 0, borderTotal = 0;
      const bw = Math.min(column * 2, 48);
      for (let y = 0; y < png.height; y += 1) for (let x = 0; x < png.width; x += 1) {
        const d = png.at(x, y) !== prev.png.at(x, y);
        if (d) changed += 1;
        if (x < bw || x >= png.width - bw) { borderTotal += 1; if (d) borderChanged += 1; }
      }
      row.changedPct = +(100 * changed / (png.width * png.height)).toFixed(2);
      row.borderChangedPct = +(100 * borderChanged / borderTotal).toFixed(2);
      const s = shiftBetween(prev.col, col);
      row.shift = s.shift; row.shiftMismatch = +(100 * s.miss).toFixed(1);
    }
    rows.push(row);
    prev = { png, col };
  }
  const moving = rows.filter((r) => r.shift !== undefined);
  const summary = {
    machine, frames: frames.length, firstFrame: frames[0], lastFrame: frames.at(-1),
    spanFrames: frames.at(-1) - frames[0],
    maxColoursInAFrame: Math.max(...rows.map((r) => r.colours)),
    maxBorderColoursInColumn: Math.max(...rows.map((r) => r.borderColours)),
    meanChangedPct: +(moving.reduce((s, r) => s + r.changedPct, 0) / Math.max(1, moving.length)).toFixed(2),
    meanBorderChangedPct: +(moving.reduce((s, r) => s + r.borderChangedPct, 0) / Math.max(1, moving.length)).toFixed(2),
    framesWithNoMotion: moving.filter((r) => r.shift === 0 && r.borderChangedPct === 0).length,
    framesWithMotion: moving.filter((r) => r.borderChangedPct > 0).length,
    preBonusColours: pre ? colorsOf(pre).size : null,
    ...stepFrames(rows),
  };
  return { summary, rows };
}

// ---- the X16: one recording, extracted ------------------------------------------------------
async function cx16Record(opts) {
  const CHECKOUT = process.env.EIGHTBS_CHECKOUT ?? process.env.EIGHTBITSCRIPT_CHECKOUT;
  const CLI = CHECKOUT ? join(CHECKOUT, 'packages', 'cli', 'bin', '8bs.mjs') : join(ROOT, 'node_modules', '@8bitscript', 'cli', 'bin', '8bs.mjs');
  const dist = join(ROOT, 'dist');
  const prg = join(dist, `${PROGRAM}-cx16.prg`);
  const buildArgs = [CLI, 'build', '--target', 'cx16', '--program', PROGRAM];
  if (process.env.EIGHTBS_CHECKOUT) buildArgs.push('--checkout', process.env.EIGHTBS_CHECKOUT);
  await run(process.execPath, buildArgs);
  const dir = ensure(framesDir('cx16'));
  const gifPath = join(dir, 'record.gif');
  rmSync(gifPath, { force: true });
  const child = spawn(tool('x16emu'), ['-ram', '512', '-prg', prg, '-run', '-gif', gifPath, '-sound', 'none'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1000 * (opts.seconds ?? 26)));
  child.kill('SIGTERM');
  await new Promise((r) => child.on('close', r));
  // x16emu writes one GIF frame per emulated frame, so a GIF frame index is a video frame. Extract the
  // frame before the first spin and a run of frames inside the bonus round, named by their index.
  for (const f of readdirSync(dir)) if (/^f\d+\.png$/.test(f)) rmSync(join(dir, f));
  const from = opts.from ?? MACHINES.cx16.start;
  const total = opts.total ?? 160;
  const grab = (a, b) => run(tool('ffmpeg'), ['-y', '-i', gifPath, '-vf', `select=between(n\\,${a}\\,${b})`, '-fps_mode', 'passthrough', '-start_number', String(a), join(dir, 'f%d.png')]);
  await grab(MACHINES.cx16.before, MACHINES.cx16.before);
  await grab(from, from + total - 1);
  const got = readdirSync(dir).filter((f) => /^f\d+\.png$/.test(f));
  console.log(`cx16: ${got.length} frames extracted from ${gifPath}`);
  return got.length;
}

// ---- commands ----------------------------------------------------------------------------------
function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) { const v = argv[++i]; o[a.slice(2)] = Number.isNaN(Number(v)) ? v : Number(v); } else o._.push(a);
  }
  return o;
}

export async function main(argv) {
  const o = parse(argv);
  const [cmd, machine] = o._;
  if (!cmd || !MACHINES[machine ?? 'c64']) { console.error(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 30).join('\n')); process.exit(2); }
  const m = MACHINES[machine];
  const out = machine ? ensure(outDir(machine)) : null;
  const p = machine ? plan(machine, o) : null;
  const steps = cmd === 'all' ? [machine === 'cx16' ? 'cx16' : 'capture', 'sheet', 'spacetime', 'gif', 'analyze'] : [cmd];
  for (const step of steps) {
    if (step === 'capture') await captureFrames(machine, [...p.consecutive, ...p.long, p.before], o.jobs ?? 2);
    else if (step === 'cx16') await cx16Record(o);
    else if (step === 'sheet') {
      const frames = p.consecutive;
      sheet(machine, listFrames(machine, frames), join(out, 'consecutive-16.png'), { cols: 4, scale: o.scale ?? 1 });
    } else if (step === 'spacetime') {
      const long = p.long;
      const all = Array.from({ length: 48 }, (_, i) => p.base + i);
      spacetime(machine, listFrames(machine, long), m.column, join(out, 'spacetime-every-3rd.png'), { colW: 8, tick: 4 });
      spacetime(machine, listFrames(machine, all), m.column, join(out, 'spacetime-every-frame.png'), { colW: 6, tick: 4 });
    } else if (step === 'crop') {
      const rect = { x: o.x, y: o.y, w: o.w, h: o.h };
      cropStack(machine, listFrames(machine, p.consecutive.slice(0, o.count ?? 10)), rect, o.scale ?? 3, join(out, `${o.name ?? 'crop'}.png`));
    } else if (step === 'gif') {
      const frames = p.consecutive;
      await gif(machine, listFrames(machine, frames), join(out, 'bonus.gif'), { fps: o.fps ?? 10, scale: o.gifscale ?? 2 });
    } else if (step === 'analyze') {
      const frames = p.consecutive;
      const res = analyze(machine, listFrames(machine, frames), m.before, m.column);
      res.flashes = flashes(machine, listFrames(machine, [...new Set([...p.consecutive, ...p.long])]));
      writeFileSync(join(out, 'analysis.json'), `${JSON.stringify(res, null, 1)}\n`);
      console.log(JSON.stringify({ ...res.summary, flashes: res.flashes }));
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
