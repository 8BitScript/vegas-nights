// Record the sound-test lab on each machine and check what it plays against what assets/audio/classic.8ba
// COMPOSES. Nothing here knows a note: the expected notes, rows, lengths and decays are read from the
// `.8ba` file with the 8BitScript compiler (EIGHTBS_CHECKOUT), so editing a song and running this
// checks the new song.
//
//   node scripts/sound.mjs                 # every machine whose emulator is installed
//   node scripts/sound.mjs c64 vic20       # just those
//
// The lab (src/labs/sound-test) plays the seven sounds once each at start. This builds it, records the
// machine's audio headlessly, and compares every note: its pitch (folded into the machine's range, as the
// driver does) and, where the chip reports it, how long it sounded. What it records with is
// packages/audio/test/capture.mjs in the 8BitScript checkout: VICE in `-console` mode (the SID and the
// VIC-I read register by register from its `dump` sound device, the PET recorded), x16emu on SDL's dummy
// drivers, and for the web the register timeline of the compiled program. Nothing opens a window or makes
// a sound worth hearing. The check says what the machine PLAYS; whether a person likes it is another
// matter, and the web's sound has not been heard.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHECKOUT = resolve(process.env.EIGHTBS_CHECKOUT ?? join(process.cwd(), '..', '8bitscript'));
const CLI = join(CHECKOUT, 'packages', 'cli', 'bin', '8bs.mjs');
const capturePath = join(CHECKOUT, 'packages', 'audio', 'test', 'capture.mjs');
const compilerPath = join(CHECKOUT, 'packages', 'compiler', 'index.mjs');
const songPath = join(CHECKOUT, 'packages', 'compiler', 'src', 'media', 'audio', 'song.mjs');
if (!existsSync(capturePath) || !existsSync(songPath)) {
  console.error(`sound: ${CHECKOUT} has no packages/audio/test/capture.mjs or no .8ba song encoder. Set EIGHTBS_CHECKOUT to an 8BitScript checkout with .8ba songs (8bitscript #316 or later).`);
  process.exit(2);
}
export const { haveBinary, viceWav, viceDump, x16Wav, analyzeSamples, sidTones, vicTones, cents, noteHz } = await import(pathToFileURL(capturePath));
const { analyzeMedia } = await import(pathToFileURL(compilerPath));
const { songEvents } = await import(pathToFileURL(songPath));

// ---- the composition, read from the source of truth -------------------------------

export const EFFECTS = ['tick', 'stop', 'win', 'big', 'jackpot', 'bonus', 'over'];

const bank = analyzeMedia(readFileSync('assets/audio/classic.8ba', 'utf8'), 'classic.8ba', { sourceKind: '.8ba' });
if (bank.diagnostics.length > 0) throw new Error(`assets/audio/classic.8ba: ${bank.diagnostics.map((d) => d.message).join('; ')}`);

/** The sound as composed: { name, speed, rows, notes: [{ note, start, frames, decay }] } with frames counted from the first row. */
export function composed(name) {
  const song = bank.air.songs.find((s) => s.name === `${name}Sound`);
  if (!song) throw new Error(`no song ${name}Sound in assets/audio/classic.8ba`);
  const events = songEvents(bank.air, song);
  const rows = song.patterns.find((p) => p.name === song.order[0]).length;
  const notes = events.map((e, i) => {
    // A note sounds for its length, or until the next one starts, whichever is first (and not past the last row).
    const nextRow = i + 1 < events.length ? events[i + 1].row : rows;
    const sounded = Math.min(e.length, nextRow - e.row, rows - e.row);
    return { note: e.note, start: e.row * song.speed, frames: sounded * song.speed, decay: e.decay, volume: e.volume };
  });
  return { name, speed: song.speed, rows, frames: rows * song.speed, notes };
}

// ---- the machines ---------------------------------------------------------------

// `range`: the notes the driver plays; one outside it moves by whole octaves (packages/audio/AGENTS.md).
// `cents`: how far a measured note may be from its note. The VIC-I's 7-bit divisor is up to 50 cents off by
// design; the PET's T2 steps round; the SID and the PSG are exact; the web's is a formula.
// `gate`: how a note's sounding time ends. The SID's gate stays open for the note's length (its
// envelope does the fading); the others silence the voice when the decay is up.
export const MACHINES = {
  pet: { frameRate: 60, tolerance: 35, range: [48, 71], gate: 'decay', emulator: 'xpet', cycles: 15_000_000, modelArgs: ['-model', '4032', '-ramsize', '32'], build: ['--target', 'pet'] },
  vic20: { dump: 'vic', tolerance: 60, range: [36, 71], gate: 'decay', emulator: 'xvic', cycles: 14_000_000, modelArgs: ['-model', 'vic20ntsc', '-memory', '16k'], build: ['--target', 'vic20'] },
  c64: { dump: 'sid', tolerance: 3, range: [0, 83], gate: 'length', emulator: 'x64sc', cycles: 14_000_000, modelArgs: ['-model', 'ntsc'], build: ['--target', 'c64'] },
  cx16: { frameRate: 60, tolerance: 20, range: [36, 95], gate: 'decay', emulator: 'x16emu', build: ['--target', 'cx16'] },
  web: { frameRate: 60, tolerance: 5, range: [24, 95], gate: 'decay', build: ['--target', 'web'] },
};

export function fold(machine, note) {
  const [low, high] = MACHINES[machine].range;
  let n = note;
  while (n < low) n += 12;
  while (n > high) n -= 12;
  return n;
}

/** What `machine` should play for `name`: the folded notes and the frames each sounds for. */
export function expectedFor(machine, name) {
  const sound = composed(name);
  return sound.notes.map((n) => ({
    note: fold(machine, n.note),
    start: n.start,
    frames: MACHINES[machine].gate === 'decay' && n.decay > 0 ? Math.min(n.frames, n.decay) : n.frames,
  }));
}

export function build(machine, program = 'sound-test') {
  const run = spawnSync(process.execPath, [CLI, 'build', ...MACHINES[machine].build, '--program', program, '--checkout', CHECKOUT], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`build failed:\n${run.stderr}${run.stdout}`);
}

export function prgFor(machine, program = 'sound-test') {
  const prg = readdirSync('dist').find((f) => f.startsWith(`${program}-${machine}`) && f.endsWith('.prg'));
  if (!prg) throw new Error(`no dist/${program}-${machine}*.prg`);
  return resolve('dist', prg);
}

// `run` overrides the lab's own length: { frames } for a longer program (a slot that
// takes several spins by itself); the cycle and millisecond budgets follow from it.
export async function record(machine, program = 'sound-test', run = {}) {
  const m = MACHINES[machine];
  const frames = run.frames;
  if (machine === 'cx16') return x16Wav(prgFor(machine, program), { ms: frames ? Math.round(frames * 17 + 6000) : 16000 });
  if (machine === 'web') return renderWeb(program, frames ?? 1500);
  const cycles = frames ? Math.round((frames + 300) * 17200) : m.cycles;
  if (m.dump) return viceDump(m.emulator, prgFor(machine, program), { cycles, modelArgs: m.modelArgs });
  return viceWav(m.emulator, prgFor(machine, program), { cycles, modelArgs: m.modelArgs });
}

// No browser tab here: run the compiled program a frame at a time, read the
// four tone registers each frame as the page would, and render what they say.
async function renderWeb(name = 'sound-test', limit = 1500) {
  const { instantiateProgram, FrameLimitReached } = await import(pathToFileURL(join(CHECKOUT, 'packages', 'cli', 'src', 'wasm-host.mjs')));
  const { voiceState, renderVoice } = await import(pathToFileURL(join(CHECKOUT, 'packages', 'cli', 'src', 'web-audio.mjs')));
  const { layoutFromHardware } = await import(pathToFileURL(join(CHECKOUT, 'packages', 'cli', 'src', 'web-layout.mjs')));
  const layout = layoutFromHardware({ facts: {}, options: { machine: 'hifi' } });
  const bytes = readFileSync(join('dist', `${name}.wasm`));
  const timeline = [];
  let memory = null;
  const program = await instantiateProgram(bytes, {
    waitFrame: () => {
      timeline.push(voiceState(new Uint8Array(memory.buffer), layout.audioBase));
      if (timeline.length >= limit) throw new FrameLimitReached(limit);
    },
  });
  memory = program.memory;
  try { program.entry(); } catch (error) { if (!(error instanceof FrameLimitReached)) throw error; }
  const rate = 48000;
  const samples = renderVoice(timeline, { sampleRate: rate, frameRate: 60 });
  const scaled = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) scaled[i] = samples[i] * 32767;
  const analysis = analyzeSamples(scaled, rate);
  // The per-frame voice, for a check that wants the notes themselves.
  analysis.timeline = timeline;
  return analysis;
}

// ---- reading what was played -----------------------------------------------------

/** The web's per-frame voice as notes: a run of frames on one pitch is a tone. `at` is its first frame. */
export function webTones(timeline) {
  const tones = [];
  let open = null;
  timeline.forEach((frame, index) => {
    const key = frame.on ? Math.round(frame.hz) : 0;
    if (open && open.key === key) { open.frames += 1; return; }
    if (open && open.key !== 0) tones.push({ hz: open.hz, frames: open.frames, at: open.at });
    open = { key, hz: frame.hz, frames: 1, at: index };
  });
  if (open && open.key !== 0) tones.push({ hz: open.hz, frames: open.frames, at: open.at });
  return tones;
}

/** The tones a register dump or a timeline shows, as { hz, frames, at } (at in frames), in order. */
export function tonesOf(machine, recorded) {
  if (machine === 'web') return webTones(recorded.timeline);
  const { dump } = MACHINES[machine];
  const tones = dump === 'sid' ? sidTones(recorded) : vicTones(recorded, 12);
  return tones.map((t) => ({ hz: t.hz, frames: t.cycles / 17090, at: t.at / 17090 }));
}

// The notes a recording plays, in order: the pitch is measured in short sliding windows, a note is a pitch
// that holds for three windows in a row, and runs of the same note are one. A recording's time is not the
// logical frame's (the PET's measures about 58 Hz, the X16's steps are not evenly spaced in the WAV), so a
// recording is compared by WHICH notes were played in what order, and only notes long enough to span
// three windows (a note of three frames or more) can be seen at all.
export function plateaus(analysis, from = 0, to = analysis.seconds) {
  const notes = [];
  for (let t = from; t + 0.02 <= to; t += 0.006) {
    const got = analysis.measure(t, t + 0.02);
    notes.push(got.cycles >= 2 && got.frequency > 50 ? Math.round(57 + 12 * Math.log2(got.frequency / 440)) : null);
  }
  const heard = [];
  let run = 0;
  for (let i = 0; i < notes.length; i += 1) {
    run = i > 0 && notes[i] === notes[i - 1] ? run + 1 : 1;
    if (notes[i] === null || run !== 3) continue;
    if (heard.length === 0 || heard.at(-1) !== notes[i]) heard.push(notes[i]);
  }
  return heard;
}

// ---- the check -------------------------------------------------------------------

/** Compare the tones heard with the notes composed: pitch within tolerance, length within a frame or so. */
export function compareTones(machine, tones, want, label) {
  const { tolerance } = MACHINES[machine];
  const lines = [];
  let bad = 0;
  if (tones.length !== want.length) {
    return { lines: [`  FAIL ${label}: heard ${tones.length} notes, composed ${want.length}`], bad: 1 };
  }
  const got = [];
  want.forEach((step, i) => {
    const error = Math.abs(cents(tones[i].hz, noteHz(step.note)));
    const slack = 1.3 + step.frames * 0.12;
    // A note that sounds LONGER than it was composed is the bug this guards (a held tone); one that is
    // gone sooner is only reported: a fade over integer volumes reaches 0 before its last frames, and
    // that is the chip, not the song.
    const tooLong = tones[i].frames > step.frames + slack;
    const short = tones[i].frames < step.frames - slack;
    if (error > tolerance) bad += 1;
    if (tooLong) bad += 1;
    got.push(`${tones[i].hz.toFixed(0)}/${noteHz(step.note).toFixed(0)}${error <= tolerance ? '' : ` (${error.toFixed(0)}c!)`}${tooLong ? ` [${tones[i].frames.toFixed(1)} frames, composed ${step.frames}: TOO LONG]` : ''}${short ? ` [${tones[i].frames.toFixed(1)} of ${step.frames} frames]` : ''}`);
  });
  lines.push(`  ${label.padEnd(8)} ${got.join(' ')}`);
  return { lines, bad };
}

function checkLab(machine, recorded) {
  const lines = [];
  let bad = 0;
  if (MACHINES[machine].dump || machine === 'web') {
    const tones = tonesOf(machine, recorded);
    const all = EFFECTS.flatMap((name) => expectedFor(machine, name));
    // The tones come in the order the lab plays the effects; walk them effect by effect.
    let at = 0;
    for (const name of EFFECTS) {
      const want = expectedFor(machine, name);
      const result = compareTones(machine, tones.slice(at, at + want.length), want, name);
      lines.push(...result.lines);
      bad += result.bad;
      at += want.length;
    }
    if (tones.length !== all.length) { lines.push(`  FAIL heard ${tones.length} notes in all, composed ${all.length}`); bad += 1; }
    return { lines, bad };
  }
  // A recording: the notes of the effects long enough to see, in order.
  const seen = (name) => expectedFor(machine, name).filter((n) => n.frames >= 3).map((n) => n.note);
  const wantAll = EFFECTS.flatMap((name) => seen(name));
  const collapsed = wantAll.filter((n, i, all) => i === 0 || n !== all[i - 1]);
  const heard = plateaus(recorded);
  // Every composed note, in order, and not much else: a recording shows the odd transient between
  // two notes, and the one-frame ticks a speaker with no volume plays as full notes.
  let at = 0;
  for (const note of heard) {
    if (at < collapsed.length && note === collapsed[at]) at += 1;
  }
  const extras = heard.length - at;
  const ok = at === collapsed.length && extras <= 4;
  lines.push(`  notes heard   ${heard.join(' ')}`);
  lines.push(`  notes wanted  ${collapsed.join(' ')}  ${ok ? 'ok' : `FAIL (found ${at} of ${collapsed.length} in order, ${extras} extra)`}`);
  if (!ok) bad += 1;
  return { lines, bad };
}

// Why a machine cannot be recorded here, or null: its emulator is not installed, or (for the VICE
// machines) VICE's audio can only be recorded through the macOS sound device.
export function skipReason(machine) {
  const m = MACHINES[machine];
  if (m.emulator && !haveBinary(m.emulator)) return `${m.emulator} is not installed`;
  if (machine === 'pet' && process.platform !== 'darwin') {
    return "recording VICE's audio needs the macOS sound device";
  }
  return null;
}

// Run `each(machine)` for every machine named on the command line (all of them if none is) that
// can be recorded here, naming each one, and add up the problems `each` returns.
export async function eachMachine(each) {
  const asked = process.argv.slice(2);
  const targets = (asked.length > 0 ? asked : Object.keys(MACHINES)).filter((m) => MACHINES[m]);
  let failed = 0;
  for (const machine of targets) {
    const why = skipReason(machine);
    if (why) {
      console.log(`${machine}: skipped (${why})`);
      continue;
    }
    console.log(`${machine}:`);
    failed += await each(machine);
  }
  return failed;
}

// One build-record-check step: print what it found and return its problems; a throw is one problem.
export async function attempt(step) {
  try {
    const { lines, bad } = await step();
    console.log(lines.join('\n'));
    return bad;
  } catch (error) {
    console.log(`  FAIL ${error.message}`);
    return 1;
  }
}

// ---- main ------------------------------------------------------------------------

// Run the check only when this file is the program, so scripts/slot-sound.mjs can import the helpers.
const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const failed = await eachMachine((machine) => attempt(async () => {
    build(machine);
    return checkLab(machine, await record(machine));
  }));
  console.log(failed === 0 ? 'sound: every note of every sound is the pitch the .8ba composes' : `sound: ${failed} problem(s)`);
  process.exit(failed === 0 ? 0 : 1);
}
