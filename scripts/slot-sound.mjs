// Record the 3x3 slot playing a spin on each machine and check that the sound it ends
// on is the one the spin's result calls for.
//
//   node scripts/slot-sound.mjs                  # every machine whose emulator is installed
//   node scripts/slot-sound.mjs c64 web          # just those
//
// The headless slot programs (src/labs/slot3x3/{lose,cherries,lines,jackpot}.8bs) take their
// spins by themselves from a fixed seed, and test/support/reference.mjs says what each spin
// pays. So the last thing the game should sound is known:
//
//   lose      a reel coming to rest      (sfx.stop,  one note)
//   cherries  a small pay                (sfx.win,   five notes)
//   lines     a pay of twenty bets or more (sfx.big, nine notes)
//   jackpot   the jackpot                (sfx.bonus, fourteen notes)
//
// For each machine this builds the program, records the audio the way scripts/sound.mjs does
// (VICE's register dumps for the SID and the VIC-I, a WAV for the PET and the X16, the
// register timeline rendered to samples for the web), and compares the LAST sound with that
// effect note by note, and checks that the reels were heard before it: ticks (the tick's
// pitch) and stops. Nothing opens a window worth looking at, and what is checked is what the
// machine plays, not whether it sounds nice (the web has not been heard in a browser).
import { loadTable } from '../test/support/table.mjs';
import { play } from '../test/support/reference.mjs';
import { MACHINES, EFFECTS, NOTE, FRAMES, FIRST, build, record, eachMachine, attempt, sidTones, vicTones, cents, noteHz } from './sound.mjs';

const PROBES = [
  { name: 'lose', program: 'slot3x3-lose', seed: 2026, spins: 3, frames: 2500 },
  { name: 'cherries', program: 'slot3x3-cherries', seed: 304, spins: 3, frames: 2500 },
  { name: 'lines', program: 'slot3x3-lines', seed: 145, spins: 1, frames: 1200 },
  { name: 'jackpot', program: 'slot3x3-jackpot', seed: 315, spins: 1, frames: 1200 },
];
// game.8bs: a pay of this many credits at the base bet or more is "big".
const BIG_WIN = 2000;

const table = loadTable();

// The effect the LAST spin's result calls for, from the odds oracle.
function expectedEffect(probe) {
  const last = play(table, probe.spins, { seed: probe.seed }).at(-1);
  if (last.jackpot) return 'bonus';
  if (last.win === 0) return 'stop';
  return last.lines.reduce((a, b) => a + b, 0) >= BIG_WIN ? 'big' : 'win';
}

const notesOf = (effect) => {
  const e = EFFECTS.indexOf(effect);
  const steps = [];
  for (let i = FIRST[e]; i < FIRST[e + 1]; i += 1) steps.push({ note: NOTE[i], frames: FRAMES[i] });
  return steps;
};

// The note a measured pitch is nearest to (C0 = 0, A4 = 57), for naming what was heard.
const nearestNote = (hz) => Math.round(57 + 12 * Math.log2(hz / 440));

// ---- the machines that are read from a register dump (C64's SID, VIC-20's VIC-I) ----

function checkDump(machine, events, effect) {
  const { dump } = MACHINES[machine];
  return checkTones(machine, dump === 'sid' ? sidTones(events) : vicTones(events, 12), effect);
}

// The web has no chip to dump: its per-frame voice (on, hz) is the register state, and a run of frames
// on one pitch is a tone.
function webTones(timeline) {
  const tones = [];
  let open = null;
  for (const frame of timeline) {
    const key = frame.on ? Math.round(frame.hz) : 0;
    if (open && open.key === key) { open.frames += 1; continue; }
    if (open && open.key !== 0) tones.push({ hz: open.hz, frames: open.frames });
    open = { key, hz: frame.hz, frames: 1 };
  }
  if (open && open.key !== 0) tones.push({ hz: open.hz, frames: open.frames });
  return tones;
}

function checkTones(machine, tones, effect) {
  const { tolerance } = MACHINES[machine];
  const want = notesOf(effect);
  const lines = [];
  let bad = 0;
  if (tones.length < want.length + 2) return { lines: [`  FAIL heard ${tones.length} tones, wanted the ${effect} (${want.length}) after some reel sounds`], bad: 1 };
  const last = tones.slice(-want.length);
  const heard = last.map((t) => nearestNote(t.hz));
  const wrong = [];
  want.forEach((step, i) => {
    const error = Math.abs(cents(last[i].hz, noteHz(step.note)));
    if (error > tolerance) wrong.push(`${last[i].hz.toFixed(0)}/${noteHz(step.note).toFixed(0)} Hz (${error.toFixed(0)}c)`);
  });
  if (wrong.length > 0) bad += 1;
  // The web's tones carry their length in frames: a step lasts the frames the effect asks for.
  if (last[0].frames !== undefined) {
    const off = want.filter((step, i) => last[i].frames !== step.frames);
    if (off.length > 0) { lines.push(`  FAIL ${off.length} step(s) not the length asked for`); bad += 1; }
  }
  lines.push(`  last sound: ${effect}  heard notes ${heard.join(' ')}  wanted ${want.map((s) => s.note).join(' ')}${wrong.length ? `  FAIL ${wrong.join(', ')}` : '  ok'}`);
  // The reels were heard before it: the tick's note and the stop's note both occur in what came first.
  const before = tones.slice(0, -want.length).map((t) => nearestNote(t.hz));
  const ticks = before.filter((n) => n === NOTE[FIRST[0]]).length;
  const stops = before.filter((n) => n === NOTE[FIRST[1]]).length;
  // On the web a run of same-pitch ticks is one tone in the per-frame voice (the gate is not dropped between
  // them), so there it is enough that the reels were heard at all.
  const wantTicks = machine === 'web' ? 1 : 5;
  if (ticks < wantTicks) { lines.push(`  FAIL only ${ticks} reel ticks were heard before it`); bad += 1; }
  if (effect !== 'stop' && stops < 1) { lines.push('  FAIL no reel stop was heard before it'); bad += 1; }
  lines.push(`  before it: ${ticks} ticks, ${stops} stops, ${tones.length - want.length} tones in all`);
  return { lines, bad };
}

// ---- the machines that are heard as samples (the PET, the X16, the web's render) ----

// The notes a recording plays, in order: the pitch is measured in short sliding windows, a note is a
// pitch that holds for at least two windows, and runs of the same note are one. A recording's time is
// not the logical frame's (the PET's measures about 58 Hz, the X16's steps are not evenly spaced in the
// WAV), so this compares WHICH notes were played in what order, which is what the effect is.
function plateaus(analysis, from, to) {
  const notes = [];
  for (let t = from; t + 0.02 <= to; t += 0.006) {
    const got = analysis.measure(t, t + 0.02);
    notes.push(got.cycles >= 2 && got.frequency > 50 ? Math.round(57 + 12 * Math.log2(got.frequency / 440)) : null);
  }
  // A window that straddles two notes reads as a pitch in between for a moment, so a note must
  // hold for three windows in a row to count (the shortest effect step, 3 frames, is about 8).
  const heard = [];
  let run = 0;
  for (let i = 0; i < notes.length; i += 1) {
    run = i > 0 && notes[i] === notes[i - 1] ? run + 1 : 1;
    if (notes[i] === null || run !== 3) continue;
    if (heard.length === 0 || heard.at(-1) !== notes[i]) heard.push(notes[i]);
  }
  return heard;
}

function checkWav(machine, analysis, effect) {
  const { frameRate } = MACHINES[machine];
  const want = notesOf(effect);
  const segments = analysis.segments;
  const lines = [];
  let bad = 0;
  if (segments.length < 1) return { lines: [`  FAIL heard nothing, wanted reel sounds and then the ${effect}`], bad: 1 };
  const last = segments.at(-1);
  const total = want.reduce((sum, s) => sum + s.frames / frameRate, 0);
  // Collapse the effect's own repeats the same way (an effect never repeats a note back to back here).
  const wantNotes = want.map((s) => s.note).filter((n, i, all) => i === 0 || n !== all[i - 1]);
  const heard = plateaus(analysis, Math.max(0, last.end - total - 0.6), last.end + 0.02);
  const tail = heard.slice(-wantNotes.length);
  const same = tail.length === wantNotes.length && tail.every((n, i) => n === wantNotes[i]);
  if (!same) bad += 1;
  lines.push(`  last sound: ${effect}  heard notes ${tail.join(' ')}  wanted ${wantNotes.join(' ')}  ${same ? 'ok' : 'FAIL'}`);
  // Reel sounds came before it: the last sound is longer than the effect alone, or there was an earlier one.
  const earlier = segments.length >= 2 || last.seconds > total + 0.3 || last.start > 0.5;
  if (!earlier) { lines.push('  FAIL no reel sounds before the last'); bad += 1; }
  lines.push(`  ${segments.length} separate sound${segments.length === 1 ? '' : 's'} in the run, the last ${last.seconds.toFixed(2)} s (the effect alone: ${total.toFixed(2)} s)`);
  return { lines, bad };
}

// ---- main ------------------------------------------------------------------------

const failed = await eachMachine(async (machine) => {
  let problems = 0;
  for (const probe of PROBES) {
    const effect = expectedEffect(probe);
    console.log(` ${probe.name} (seed ${probe.seed}, ${probe.spins} spin${probe.spins === 1 ? '' : 's'}):`);
    problems += await attempt(async () => {
      build(machine, probe.program);
      const recorded = await record(machine, probe.program, { frames: probe.frames });
      if (machine === 'web') return checkTones(machine, webTones(recorded.timeline), effect);
      return MACHINES[machine].dump ? checkDump(machine, recorded, effect) : checkWav(machine, recorded, effect);
    });
  }
  return problems;
});
console.log(failed === 0 ? 'slot-sound: every spin ends on the sound its result calls for' : `slot-sound: ${failed} problem(s)`);
process.exit(failed === 0 ? 0 : 1);
