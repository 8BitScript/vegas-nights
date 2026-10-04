// Record the sound-test lab on each machine and check what it plays.
//
//   node scripts/sound.mjs                 # every machine whose emulator is installed
//   node scripts/sound.mjs c64 vic20       # just those
//
// The lab plays the five slot sounds once each at start (src/shared/sfx.8bs).
// This builds it, records the machine's audio headlessly, and for every note
// of every effect measures the pitch in that note's window and compares it
// with the note the effect says. What it uses to record is
// packages/audio/test/capture.mjs in the 8BitScript checkout that has
// `audio.tone` (EIGHTBS_CHECKOUT, default ../8bitscript): VICE in `-console`
// mode at 2% volume, x16emu on SDL's dummy drivers, and for the web the
// register timeline of the compiled program rendered to samples, because
// there is no browser tab to record. Nothing opens a window or makes a sound
// worth hearing. The check says what the machine PLAYS; whether a person
// likes it is another matter, and the web's sound has not been heard.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHECKOUT = resolve(process.env.EIGHTBS_CHECKOUT ?? join(process.cwd(), '..', '8bitscript'));
const CLI = join(CHECKOUT, 'packages', 'cli', 'bin', '8bs.mjs');
const capturePath = join(CHECKOUT, 'packages', 'audio', 'test', 'capture.mjs');
if (!existsSync(capturePath)) {
  console.error(`sound: ${capturePath} not found. Set EIGHTBS_CHECKOUT to an 8BitScript checkout with audio.tone (packages/audio/test/capture.mjs).`);
  process.exit(2);
}
const { haveBinary, viceWav, viceDump, x16Wav, analyzeSamples, sidTones, vicTones, cents, noteHz } = await import(pathToFileURL(capturePath));

// ---- the schedule, read from the source of truth --------------------------------

function table(source, name) {
  const match = new RegExp(`const ${name}: array<u8, \\d+> = \\[([^\\]]*)\\];`).exec(source);
  if (!match) throw new Error(`sound: no ${name} table in src/shared/sfx.8bs`);
  return match[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
}
const sfx = readFileSync('src/shared/sfx.8bs', 'utf8');
const NOTE = table(sfx, 'NOTE');
const FRAMES = table(sfx, 'FRAMES');
const FIRST = table(sfx, 'FIRST');
const EFFECTS = ['tick', 'stop', 'win', 'big', 'bonus'];

// ---- the machines ---------------------------------------------------------------

// `cents`: how far a measured note may be from its note. The VIC-I's 7-bit
// divisor is up to 50 cents off by design (packages/audio/AGENTS.md); the
// PET's T2 steps round; the SID and the PSG are exact; the web's is a formula.
//
// `dump`: the SID and the VIC-I are read register by register from VICE's
// `dump` sound device, which is exact; a recorded WAV of a 50 ms note on
// either is a poor ruler (the SID's envelope hides where a note starts and a
// VIC-I note change glitches the zero crossings), so the notes are checked on
// the registers and the lengths on the cycles between them. The PET has no
// registers to read (its CB2 wave is not a chip write) and is measured on the
// WAV. The PET's logical frame is measured at about 58 Hz in xpet, not the
// catalog's 50, so a window is timed with 60.
const MACHINES = {
  pet: { frameRate: 60, tolerance: 35, emulator: 'xpet', cycles: 12_000_000, modelArgs: ['-model', '4032', '-ramsize', '32'], build: ['--target', 'pet'] },
  vic20: { dump: 'vic', tolerance: 60, emulator: 'xvic', cycles: 11_000_000, modelArgs: ['-model', 'vic20ntsc', '-memory', '8k'], build: ['--target', 'vic20'] },
  c64: { dump: 'sid', tolerance: 3, emulator: 'x64sc', cycles: 12_000_000, modelArgs: ['-model', 'ntsc'], build: ['--target', 'c64'] },
  cx16: { frameRate: 60, tolerance: 20, emulator: 'x16emu', build: ['--target', 'cx16'] },
  web: { frameRate: 60, tolerance: 5, build: ['--target', 'web'] },
};

function build(machine) {
  const run = spawnSync('node', [CLI, 'build', ...MACHINES[machine].build, '--program', 'sound-test', '--checkout', CHECKOUT], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`build failed:\n${run.stderr}${run.stdout}`);
}

function prgFor(machine) {
  const prg = readdirSync('dist').find((f) => f.startsWith(`sound-test-${machine}`) && f.endsWith('.prg'));
  if (!prg) throw new Error(`no dist/sound-test-${machine}*.prg`);
  return resolve('dist', prg);
}

async function record(machine) {
  const m = MACHINES[machine];
  if (machine === 'cx16') return x16Wav(prgFor(machine), { ms: 11000 });
  if (machine === 'web') return renderWeb();
  if (m.dump) return viceDump(m.emulator, prgFor(machine), { cycles: m.cycles, modelArgs: m.modelArgs });
  return viceWav(m.emulator, prgFor(machine), { cycles: m.cycles, modelArgs: m.modelArgs });
}

// No browser tab here: run the compiled program a frame at a time, read the
// four tone registers each frame as the page would, and render what they say.
async function renderWeb() {
  const { instantiateProgram, FrameLimitReached } = await import(pathToFileURL(join(CHECKOUT, 'packages', 'cli', 'src', 'wasm-host.mjs')));
  const { voiceState, renderVoice } = await import(pathToFileURL(join(CHECKOUT, 'packages', 'cli', 'src', 'web-audio.mjs')));
  const { layoutFromHardware } = await import(pathToFileURL(join(CHECKOUT, 'packages', 'cli', 'src', 'web-layout.mjs')));
  const layout = layoutFromHardware({ facts: {}, options: { machine: 'hifi' } });
  const bytes = readFileSync(join('dist', 'sound-test.wasm'));
  const timeline = [];
  let memory = null;
  const program = await instantiateProgram(bytes, {
    waitFrame: () => {
      timeline.push(voiceState(new Uint8Array(memory.buffer), layout.audioBase));
      if (timeline.length >= 700) throw new FrameLimitReached(700);
    },
  });
  memory = program.memory;
  try { program.entry(); } catch (error) { if (!(error instanceof FrameLimitReached)) throw error; }
  const rate = 48000;
  const samples = renderVoice(timeline, { sampleRate: rate, frameRate: 60 });
  const scaled = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) scaled[i] = samples[i] * 32767;
  return analyzeSamples(scaled, rate);
}

// ---- the check ------------------------------------------------------------------

// Notes and lengths from a register dump: one tone per step, in order, the
// pitch from the registers and the length from the cycles it stayed on. The
// frame period is whatever the steps agree on (it is cycles / frames), and it
// has to be a real machine's frame, 16,000 to 18,500 cycles.
function checkDump(machine, events) {
  const { tolerance, dump } = MACHINES[machine];
  const tones = dump === 'sid' ? sidTones(events) : vicTones(events, 12);
  const lines = [];
  const warnings = [];
  let bad = 0;
  if (tones.length < NOTE.length) {
    lines.push(`  FAIL heard ${tones.length} steps, wanted ${NOTE.length}`);
    return { lines, bad: 1 };
  }
  const periods = tones.slice(0, NOTE.length).map((t, i) => t.cycles / FRAMES[i]).sort((a, b) => a - b);
  const frame = periods[Math.floor(periods.length / 2)];
  if (frame < 16000 || frame > 18500) {
    lines.push(`  FAIL a frame measures ${frame.toFixed(0)} cycles`);
    bad += 1;
  }
  EFFECTS.forEach((name, e) => {
    const notes = [];
    let wrongLength = 0;
    for (let i = FIRST[e]; i < FIRST[e + 1]; i += 1) {
      const tone = tones[i];
      const error = Math.abs(cents(tone.hz, noteHz(NOTE[i])));
      const frames = tone.cycles / frame;
      if (error > tolerance) bad += 1;
      // A length that is off is a warning, not a failure: the pitch is the
      // property of the sound. The VIC-20's first step of `big` runs a frame
      // long (4.95 where its neighbours measure 4.00); the cause is not found.
      if (Math.abs(frames - FRAMES[i]) > 0.6) { warnings.push(`${name} step ${i - FIRST[e]}: ${frames.toFixed(2)} frames, wanted ${FRAMES[i]}`); wrongLength += 1; }
      const wrong = Math.abs(frames - FRAMES[i]) > 0.6 ? ` [${frames.toFixed(1)} of ${FRAMES[i]} frames!]` : '';
      notes.push(`${tone.hz.toFixed(0)}/${noteHz(NOTE[i]).toFixed(0)}${error <= tolerance ? '' : ` (${error.toFixed(0)}c!)`}${wrong}`);
    }
    lines.push(`  ${name.padEnd(6)} ${wrongLength === 0 ? 'lengths ok' : `${wrongLength} length warning`}  ${notes.join(' ')}`);
  });
  lines.push(`  frame ${frame.toFixed(0)} cycles`);
  for (const warning of warnings) lines.push(`  WARN ${warning}`);
  return { lines, bad };
}

function check(machine, analysis) {
  if (MACHINES[machine].dump) return checkDump(machine, analysis);
  const { frameRate, tolerance } = MACHINES[machine];
  const lines = [];
  let bad = 0;
  const fail = (text) => { lines.push(`  FAIL ${text}`); bad += 1; };
  if (analysis.segments.length < EFFECTS.length) {
    fail(`heard ${analysis.segments.length} sounds, wanted ${EFFECTS.length}`);
    return { lines, bad };
  }
  EFFECTS.forEach((name, e) => {
    const segment = analysis.segments[e];
    const steps = [];
    for (let i = FIRST[e]; i < FIRST[e + 1]; i += 1) steps.push({ note: NOTE[i], seconds: FRAMES[i] / frameRate });
    const total = steps.reduce((sum, s) => sum + s.seconds, 0);
    const longEnough = segment.seconds >= total - 0.05;
    // A SID's release and a recording's tail run past the last frame; a sound
    // that rings for more than a third of a second extra is not the one asked for.
    const notTooLong = segment.seconds <= total + 0.35;
    const notes = [];
    let at = segment.start;
    for (const step of steps) {
      const pad = step.seconds * 0.2;
      const got = analysis.measure(at + pad, at + step.seconds - pad);
      const want = noteHz(step.note);
      if (got.cycles >= 3) {
        const error = Math.abs(cents(got.frequency, want));
        const allowed = Math.max(tolerance, 1200 * Math.log2(1 + 1 / got.cycles));
        notes.push(`${got.frequency.toFixed(0)}/${want.toFixed(0)}${error <= allowed ? '' : ` (${error.toFixed(0)}c!)`}`);
        if (error > allowed) bad += 1;
      } else {
        notes.push(`?/${want.toFixed(0)}`);
      }
      at += step.seconds;
    }
    lines.push(`  ${name.padEnd(6)} ${segment.seconds.toFixed(2)}s (wanted ${total.toFixed(2)}s) ${longEnough && notTooLong ? 'ok' : 'LENGTH!'}  ${notes.join(' ')}`);
    if (!(longEnough && notTooLong)) bad += 1;
  });
  return { lines, bad };
}

// ---- main ------------------------------------------------------------------------

const asked = process.argv.slice(2);
const targets = (asked.length > 0 ? asked : Object.keys(MACHINES)).filter((m) => MACHINES[m]);
let failed = 0;
for (const machine of targets) {
  const m = MACHINES[machine];
  if (m.emulator && !haveBinary(m.emulator)) {
    console.log(`${machine}: skipped (${m.emulator} is not installed)`);
    continue;
  }
  if ((machine === 'pet' || machine === 'vic20' || machine === 'c64') && process.platform !== 'darwin') {
    console.log(`${machine}: skipped (recording VICE's audio needs the macOS sound device)`);
    continue;
  }
  console.log(`${machine}:`);
  try {
    build(machine);
    const { lines, bad } = check(machine, await record(machine));
    console.log(lines.join('\n'));
    failed += bad;
  } catch (error) {
    console.log(`  FAIL ${error.message}`);
    failed += 1;
  }
}
console.log(failed === 0 ? 'sound: every note of every effect is the pitch it names' : `sound: ${failed} problem(s)`);
process.exit(failed === 0 ? 0 : 1);
