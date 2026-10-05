// Record the slot machines playing on each machine and check what they SOUND like.
//
//   node scripts/slot-sound.mjs                  # every machine whose emulator is installed
//   node scripts/slot-sound.mjs c64 web          # just those
//
// What it checks, against the composition in assets/audio/classic.8ba (read by scripts/sound.mjs, so a
// change to a song is checked against the song):
//
//  1. The sound a spin ENDS on is the one its result calls for. The headless slot programs
//     (src/labs/slot3x3/{lose,cherries,lines,jackpot}.8bs) take their spins by themselves from a fixed
//     seed, and test/support/reference.mjs says what each spin pays:
//        lose      a reel coming to rest   (stop)       cherries  a small pay (win)
//        lines     a pay of twenty bets    (big)        jackpot   the jackpot (jackpot)
//     and the reels were heard before it: ticks (one per symbol going by) and stops.
//  2. The ticks are rate-limited: no two closer than TICK_GAP frames, however many reels turn.
//  3. The machine is SILENT when it is just sitting there: after booting (the lobby), after a spin, after a
//     5x5 bonus round has ended. A stuck tone (a gate that never closed, a voice left on) is the worst
//     bug a sound system can have, and a check of the notes that were played cannot see it, so this one
//     looks at how the run ENDS: the SID gates and VIC-I voices off, the PET and X16 recordings and the web
//     voice quiet for the last second.
//
// Nothing opens a window worth looking at, and what is checked is what the machine plays, not whether it
// sounds nice (the web has not been heard in a browser).
import { loadTable } from '../test/support/table.mjs';
import { play } from '../test/support/reference.mjs';
import { MACHINES, expectedFor, build, record, eachMachine, attempt, tonesOf, plateaus, cents, noteHz } from './sound.mjs';

const SILENT_FRAMES = 60; // the last second of the run
const TICK_GAP = 5;       // src/shared/sfx.8bs: the least gap between two ticks, in frames

const PROBES = [
  { name: 'lose', program: 'slot3x3-lose', seed: 2026, spins: 3, frames: 2500 },
  { name: 'cherries', program: 'slot3x3-cherries', seed: 304, spins: 3, frames: 2500 },
  { name: 'lines', program: 'slot3x3-lines', seed: 145, spins: 1, frames: 1200 },
  { name: 'jackpot', program: 'slot3x3-jackpot', seed: 315, spins: 1, frames: 1200 },
];
// Programs that are only checked for the silence at the end (no sound to compare): the lobby (never
// sounds), a 5x5 spin that loses, and a 5x5 bonus round that runs to its end and then sits.
const QUIET_PROBES = [
  { name: 'lobby', program: 'main', frames: 700 },
  { name: 'slot5x5 loses and sits', program: 'slot5x5-lose', frames: 2500 },
  // The C64 finishes the bonus round's free spins around frame 6,400 and the VIC-20 around 11,000
  // (they compose their reels more slowly than the web does).
  { name: 'slot5x5 bonus ends and sits', program: 'slot5x5-bonus', frames: 7600, framesOn: { vic20: 11500 } },
];
// game.8bs: a pay of this many credits at the base bet or more is "big".
const BIG_WIN = 2000;

const table = loadTable();

// The sound the LAST spin's result calls for, from the odds oracle.
function expectedEffect(probe) {
  const last = play(table, probe.spins, { seed: probe.seed }).at(-1);
  if (last.jackpot) return 'jackpot';
  if (last.win === 0) return 'stop';
  return last.lines.reduce((a, b) => a + b, 0) >= BIG_WIN ? 'big' : 'win';
}

// The note a measured pitch is nearest to (C0 = 0, A4 = 57), for naming what was heard.
const nearestNote = (hz) => Math.round(57 + 12 * Math.log2(hz / 440));

// ---- the machines read note by note (the SID, the VIC-I, the web) ----------------------------

function checkTones(machine, tones, effect) {
  const { tolerance } = MACHINES[machine];
  const want = expectedFor(machine, effect);
  const lines = [];
  let bad = 0;
  if (tones.length < want.length + 1) return { lines: [`  FAIL heard ${tones.length} tones, wanted the ${effect} (${want.length}) after some reel sounds`], bad: 1 };
  const last = tones.slice(-want.length);
  const wrong = [];
  want.forEach((step, i) => {
    const error = Math.abs(cents(last[i].hz, noteHz(step.note)));
    if (error > tolerance) wrong.push(`${last[i].hz.toFixed(0)}/${noteHz(step.note).toFixed(0)} Hz (${error.toFixed(0)}c)`);
  });
  if (wrong.length > 0) bad += 1;
  lines.push(`  last sound: ${effect}  heard notes ${last.map((t) => nearestNote(t.hz)).join(' ')}  composed ${want.map((s) => s.note).join(' ')}${wrong.length ? `  FAIL ${wrong.join(', ')}` : '  ok'}`);
  // The reels were heard before it: the tick's note and the stop's note both occur in what came first.
  const tickNote = expectedFor(machine, 'tick')[0].note;
  const stopNote = expectedFor(machine, 'stop')[0].note;
  const before = tones.slice(0, -want.length);
  const ticks = before.filter((t) => nearestNote(t.hz) === tickNote);
  const stops = before.filter((t) => nearestNote(t.hz) === stopNote).length;
  // A one-bit speaker (the PET) plays no ticks at the low volume the games start at.
  const wantTicks = machine === 'pet' ? 0 : 5;
  if (ticks.length < wantTicks) { lines.push(`  FAIL only ${ticks.length} reel ticks were heard before it`); bad += 1; }
  if (effect !== 'stop' && stops < 1) { lines.push('  FAIL no reel stop was heard before it'); bad += 1; }
  // However many reels turn, ticks come no oftener than the gap.
  const closest = ticks.slice(1).reduce((least, t, i) => Math.min(least, t.at - ticks[i].at), Infinity);
  if (closest < TICK_GAP - 1) { lines.push(`  FAIL two ticks only ${closest.toFixed(1)} frames apart (the gap is ${TICK_GAP})`); bad += 1; }
  lines.push(`  before it: ${ticks.length} ticks${ticks.length > 1 ? ` (never closer than ${closest.toFixed(0)} frames)` : ''}, ${stops} stops, ${before.length} tones in all`);
  return { lines, bad };
}

// ---- the machines heard as recordings (the PET, the X16) --------------------------------------

function checkWav(machine, analysis, effect) {
  const { frameRate } = MACHINES[machine];
  const want = expectedFor(machine, effect);
  const lines = [];
  let bad = 0;
  const segments = analysis.segments;
  if (segments.length < 1) return { lines: [`  FAIL heard nothing, wanted reel sounds and then the ${effect}`], bad: 1 };
  const last = segments.at(-1);
  const total = want.reduce((end, s) => Math.max(end, (s.start + s.frames) / frameRate), 0);
  // Only a note of three frames or more can be seen in a recording; collapse repeats.
  const longEnough = want.filter((s) => s.frames >= 3);
  // (a sound whose notes are all shorter than that, the stop, is compared as it is)
  const wantNotes = (longEnough.length > 0 ? longEnough : want).map((s) => s.note).filter((n, i, all) => i === 0 || n !== all[i - 1]);
  const heard = plateaus(analysis, Math.max(0, last.end - total - 0.6), last.end + 0.02);
  const tail = heard.slice(-wantNotes.length);
  const same = tail.length === wantNotes.length && tail.every((n, i) => n === wantNotes[i]);
  if (!same) bad += 1;
  lines.push(`  last sound: ${effect}  heard notes ${tail.join(' ')}  composed ${wantNotes.join(' ')}  ${same ? 'ok' : 'FAIL'}`);
  // Reel sounds came before it: there was an earlier sound, or the last one is longer than the effect alone.
  const earlier = segments.length >= 2 || last.seconds > total + 0.3 || last.start > 0.5;
  if (!earlier) { lines.push('  FAIL no reel sounds before the last'); bad += 1; }
  lines.push(`  ${segments.length} separate sound${segments.length === 1 ? '' : 's'} in the run, the last ${last.seconds.toFixed(2)} s (the effect alone: ${total.toFixed(2)} s)`);
  return { lines, bad };
}

// ---- silence: how the run ENDS ------------------------------------------------------

// The SID's three gates (registers 4, 11, 18) and the VIC-I's four voice registers (10..13, on at 128
// and up): the last write to each must have turned it off, and long enough ago.
function chipSilence(machine, events, frames) {
  const { dump } = MACHINES[machine];
  const end = (frames + 300) * 17200;
  const quietFor = SILENT_FRAMES * 17200;
  const on = new Map();
  let lastOff = 0;
  for (const { clock, reg, value } of events) {
    if (dump === 'sid' && (reg === 4 || reg === 11 || reg === 18)) {
      if ((value & 1) !== 0) on.set(reg, clock); else { on.delete(reg); lastOff = clock; }
    }
    if (dump === 'vic' && reg >= 10 && reg <= 13) {
      if (value >= 128) on.set(reg, clock); else { on.delete(reg); lastOff = clock; }
    }
  }
  if (on.size > 0) return { bad: 1, text: `FAIL still sounding when the run ended (${dump === 'sid' ? 'SID gate' : 'VIC-I voice'} open on register${on.size > 1 ? 's' : ''} ${[...on.keys()].join(', ')}: a stuck tone)` };
  if (end - lastOff < quietFor && lastOff > 0) return { bad: 1, text: `FAIL the last sound ended ${((end - lastOff) / 17200).toFixed(0)} frames before the run ended (wanted ${SILENT_FRAMES} of silence)` };
  return { bad: 0, text: `silent for the last ${SILENT_FRAMES}+ frames` };
}

// A recording (the PET, the X16): the last sound must end at least a second before the recording does.
function waveSilence(analysis) {
  const last = analysis.segments.at(-1);
  if (!last) return { bad: 0, text: 'silent throughout' };
  const tail = analysis.seconds - last.end;
  if (tail < 1) return { bad: 1, text: `FAIL still sounding when the recording ended (the last sound ran ${last.start.toFixed(1)}..${last.end.toFixed(1)} s of ${analysis.seconds.toFixed(1)} s: a stuck tone)` };
  return { bad: 0, text: `silent for the last ${tail.toFixed(1)} s` };
}

// The web: the per-frame voice must be off for the last SILENT_FRAMES frames.
function webSilence(timeline) {
  const tail = timeline.slice(-SILENT_FRAMES);
  const on = tail.filter((frame) => frame.on).length;
  if (on > 0) return { bad: 1, text: `FAIL the voice was on in ${on} of the last ${tail.length} frames (a stuck tone)` };
  return { bad: 0, text: `voice off for the last ${tail.length} frames` };
}

function checkSilence(machine, recorded, frames) {
  const result = machine === 'web' ? webSilence(recorded.timeline)
    : MACHINES[machine].dump ? chipSilence(machine, recorded, frames)
      : waveSilence(recorded);
  return { bad: result.bad, line: `  at rest: ${result.text}` };
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
      const heard = MACHINES[machine].dump || machine === 'web' ? checkTones(machine, tonesOf(machine, recorded), effect) : checkWav(machine, recorded, effect);
      const quiet = checkSilence(machine, recorded, probe.frames);
      return { lines: [...heard.lines, quiet.line], bad: heard.bad + quiet.bad };
    });
  }
  for (const probe of QUIET_PROBES) {
    console.log(` ${probe.name}:`);
    problems += await attempt(async () => {
      build(machine, probe.program);
      const frames = probe.framesOn?.[machine] ?? probe.frames;
      const quiet = checkSilence(machine, await record(machine, probe.program, { frames }), frames);
      return { lines: [quiet.line], bad: quiet.bad };
    });
  }
  return problems;
});
console.log(failed === 0 ? 'slot-sound: every spin ends on the sound its result calls for, ticks keep their gap, and the machine falls silent' : `slot-sound: ${failed} problem(s)`);
process.exit(failed === 0 ? 0 : 1);
