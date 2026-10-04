// Emit a resolved, analysed spec as an 8BitScript module of `export const` tables
// (program-image data, not RAM), and describe the random-number budget of a spin.
//
// Everything a 6502 needs at run time is a lookup: stop = byte & STOP_MASK picks a
// reel position with no bias (STOPS is a power of two), PAYS[symbol * PAY_WIDTH + n]
// is the pay for n of a symbol, and so on. The program does no probability maths.
import { sharedDraw } from './analyze.mjs';
import { bytesFor, pct } from './util.mjs';

const TYPE_BYTES = { utinyint: 1, usmallint: 2, uint: 4 };

/**
 * How many random bytes a spin uses and what each one means.
 * Reels first (one byte each), then the per-spin jackpot draw (if any), then - only if
 * the bonus symbols landed - one byte for the wheel. A free spin is just reels again.
 */
export function drawPlan(spec) {
  const items = [];
  for (let r = 0; r < spec.reels; r += 1) {
    items.push({ name: `reel ${r + 1}`, bytes: 1, use: `stop = byte & ${spec.stops - 1}` });
  }
  const spin = spec.progressives.filter((l) => l.via === 'spin');
  if (spin.length) {
    if (sharedDraw(spec)) {
      const den = spin[0].prob.den;
      let from = 0;
      const ranges = spin.map((l) => {
        const range = { id: l.id, from, to: from + l.prob.num };
        from += l.prob.num;
        return range;
      });
      items.push({
        name: 'jackpot draw', bytes: bytesFor(den), use: `value = little-endian bytes & ${den - 1}; ${ranges.map((r) => `${r.id} if ${r.from} <= value < ${r.to}`).join(', ')}`,
        ranges,
      });
    } else if (spin.length === 1) {
      const l = spin[0];
      items.push({ name: `${l.id} draw`, bytes: bytesFor(l.prob.den), use: `value = little-endian bytes & ${l.prob.den - 1}; hit if value < ${l.prob.num}`, ranges: [{ id: l.id, from: 0, to: l.prob.num }] });
    } else {
      throw new Error(`${spec.id}: emit supports one per-spin jackpot draw, or several that share a denominator`);
    }
  }
  const perSpin = items.reduce((a, i) => a + i.bytes, 0);
  const conditional = spec.bonus
    ? [{ name: 'bonus wheel', bytes: 1, use: `index = byte & ${spec.bonus.wheelTotal - 1}`, when: `bonus symbols >= ${spec.bonus.minCount}` }]
    : [];
  return {
    perBaseSpin: perSpin,
    perFreeSpin: spec.reels,
    items,
    conditional,
    maxPerBaseSpin: perSpin + conditional.reduce((a, c) => a + c.bytes, 0),
  };
}

function tableLines(values, perLine = 16) {
  const out = [];
  for (let i = 0; i < values.length; i += perLine) out.push(`    ${values.slice(i, i + perLine).join(', ')}`);
  return out.join(',\n');
}

export function emit(spec, analysis) {
  const consts = []; // [name, type, value, comment]
  const arrays = []; // [name, type, values, comment]
  const sc = (name, type, value, comment) => consts.push([name, type, value, comment]);
  const arr = (name, type, values, comment) => arrays.push([name, type, values, comment]);

  sc('REELS', 'utinyint', spec.reels, 'reels across');
  sc('ROWS', 'utinyint', spec.rows, 'rows each reel shows');
  sc('STOPS', 'utinyint', spec.stops, 'stops on every reel (a power of two)');
  sc('STOP_MASK', 'utinyint', spec.stops - 1, 'random byte & STOP_MASK = an unbiased stop');
  sc('BET_CREDITS', 'usmallint', spec.betCredits, 'credits staked by the base bet; every pay below is in credits at the base bet');
  sc('SYMBOL_COUNT', 'utinyint', spec.symbols.length, 'symbols in STRIPS');
  for (const s of spec.symbols) sc(`SYM_${s.id}`, 'utinyint', s.index, `${s.kind} symbol`);
  if (spec.wildIndex >= 0) sc('WILD_SYMBOL', 'utinyint', spec.wildIndex, 'substitutes for every regular symbol');
  if (spec.scatterIndex >= 0) sc('SCATTER_SYMBOL', 'utinyint', spec.scatterIndex, 'pays anywhere on the grid');
  if (spec.bonusIndex >= 0) sc('BONUS_SYMBOL', 'utinyint', spec.bonusIndex, 'opens the bonus wheel');
  arr('STRIPS', 'utinyint', spec.strips.flat(), `reel-major: STRIPS[reel * STOPS + stop] is a symbol; a reel shows ROWS symbols from its stop, wrapping`);
  arr('BET_LEVELS', 'utinyint', spec.bets, 'bet multipliers of the base bet; pays scale linearly');

  const cells = spec.reels * spec.rows;
  if (spec.mode === 'line') {
    sc('LINE_COUNT', 'utinyint', spec.lines.length, 'paylines');
    arr('LINES', 'utinyint', spec.lines.flat(), 'line-major: LINES[line * REELS + reel] is the row that line crosses on that reel');
  }
  // PAYS: expand to a direct lookup by run length (line, ways) or cluster size.
  const width = spec.mode === 'cluster' ? cells + 1 : spec.reels + 1;
  sc('PAY_WIDTH', 'utinyint', width, spec.mode === 'cluster' ? 'cluster sizes 0..cells' : 'run lengths 0..REELS');
  sc('PAY_SYMBOLS', 'utinyint', spec.payingCount, 'symbols that can pay (regular and wild come first)');
  const pays = new Array(spec.payingCount * width).fill(0);
  for (let s = 0; s < spec.payingCount; s += 1) {
    const table = spec.paysByIndex[s] ?? {};
    const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
    for (let n = 0; n < width; n += 1) {
      if (spec.mode === 'cluster') {
        if (n < spec.cluster.min) continue;
        let best = 0;
        for (const k of keys) if (k <= n) best = table[k];
        pays[s * width + n] = best;
      } else pays[s * width + n] = table[n] ?? 0;
    }
  }
  arr('PAYS', 'usmallint', pays, spec.mode === 'ways'
    ? 'PAYS[symbol * PAY_WIDTH + run] credits PER WAY; multiply by the number of ways'
    : spec.mode === 'cluster' ? 'PAYS[symbol * PAY_WIDTH + size] credits for a cluster of that size' : 'PAYS[symbol * PAY_WIDTH + run] credits for that many from reel 1');
  if (spec.mode === 'cluster') sc('CLUSTER_MIN', 'utinyint', spec.cluster.min, 'smallest paying cluster');

  if (spec.scatter) {
    arr('SCATTER_PAYS', 'usmallint', Array.from({ length: cells + 1 }, (_, n) => spec.scatter.pays[n] ?? 0), 'credits for n scatters anywhere');
  }
  if (spec.freeSpins) {
    arr('FREE_SPIN_AWARD', 'utinyint', Array.from({ length: cells + 1 }, (_, n) => spec.scatter.freeSpins[n] ?? 0), 'free spins for n scatters');
    sc('FREE_SPIN_MULTIPLIER', 'utinyint', spec.freeSpins.multiplier, 'every win in a free spin is multiplied by this');
    sc('FREE_SPIN_CAP', 'utinyint', spec.freeSpins.cap, 'most free spins one session can grant, retriggers included');
    sc('FREE_SPIN_RETRIGGER', 'utinyint', spec.freeSpins.retrigger ? 1 : 0, '1 if scatters inside free spins award more');
  }
  if (spec.bonus) {
    const wheel = spec.bonus.wheel;
    const credits = [];
    const jackpot = [];
    const fallback = [];
    for (const seg of wheel) {
      for (let i = 0; i < seg.weight; i += 1) {
        credits.push(seg.jackpot ? 0 : seg.credits);
        jackpot.push(seg.jackpot ? spec.progressives.findIndex((p) => p.id === seg.jackpot) + 1 : 0);
        fallback.push(seg.jackpot ? seg.fallback ?? 0 : 0);
      }
    }
    sc('BONUS_MIN_COUNT', 'utinyint', spec.bonus.minCount, 'bonus symbols needed to open the wheel');
    sc('WHEEL_SIZE', 'utinyint', spec.bonus.wheelTotal === 256 ? 0 : spec.bonus.wheelTotal, spec.bonus.wheelTotal === 256 ? 'wheel segments (0 means 256)' : 'wheel segments');
    sc('WHEEL_MASK', 'utinyint', spec.bonus.wheelTotal - 1, 'random byte & WHEEL_MASK = an unbiased segment');
    arr('WHEEL_CREDITS', 'usmallint', credits, 'credits on each wheel segment (0 on a jackpot segment)');
    arr('WHEEL_JACKPOT', 'utinyint', jackpot, '0 = credits, else jackpot index + 1');
    arr('WHEEL_FALLBACK', 'usmallint', fallback, 'credits a jackpot segment pays if the bet has not opened that jackpot');
  }
  if (spec.progressives.length) {
    const q8 = spec.progressives.map((p) => (p.fixed ? 0 : Math.round((p.contribution.num / p.contribution.den) * spec.betCredits * 256)));
    if (q8.some((v) => v > 65535)) throw new Error(`${spec.id}: a jackpot contribution is too large for 8.8 fixed point`);
    sc('JACKPOT_COUNT', 'utinyint', spec.progressives.length, 'progressive or fixed-odds jackpots');
    const seedType = spec.progressives.some((p) => p.seed > 65535) ? 'uint' : 'usmallint';
    arr('JACKPOT_SEED', seedType, spec.progressives.map((p) => p.seed), `credits a meter resets to (or a fixed jackpot pays), at the base bet${seedType === 'uint' ? '; 32-bit because a seed exceeds 65535' : ''}`);
    arr('JACKPOT_CONTRIB_Q8', 'usmallint', q8, 'credits added to the meter per base-bet spin, x256 (8.8 fixed point); 0 = fixed odds');
    arr('JACKPOT_MIN_BET', 'utinyint', spec.progressives.map((p) => p.eligibleFromBet), 'smallest bet multiplier that can win it');
    const plan = drawPlan(spec);
    const draw = plan.items.find((i) => i.ranges);
    if (draw) {
      sc('JACKPOT_DRAW_BYTES', 'utinyint', draw.bytes, 'random bytes in the per-spin jackpot draw (little-endian)');
      const den = spec.progressives.find((p) => p.via === 'spin').prob.den;
      sc('JACKPOT_DRAW_MASK', 'usmallint', den - 1, 'draw value & JACKPOT_DRAW_MASK');
      arr('JACKPOT_RANGE_FROM', 'usmallint', spec.progressives.map((p) => draw.ranges.find((r) => r.id === p.id)?.from ?? 0), 'first draw value that hits it (per-spin jackpots only)');
      arr('JACKPOT_RANGE_TO', 'usmallint', spec.progressives.map((p) => draw.ranges.find((r) => r.id === p.id)?.to ?? 0), 'one past the last (0 = not a per-spin jackpot)');
    }
  }
  const plan = drawPlan(spec);
  sc('DRAW_BYTES_PER_SPIN', 'utinyint', plan.perBaseSpin, 'random bytes a base spin always uses (see the draw plan)');
  sc('DRAW_BYTES_PER_FREE_SPIN', 'utinyint', plan.perFreeSpin, 'random bytes a free spin uses: reels only');

  // ---- render
  const dataBytes = arrays.reduce((a, [, type, values]) => a + TYPE_BYTES[type] * values.length, 0);
  const lines = [];
  lines.push(`// GENERATED by tools/slotmath from tools/slotmath/specs/${spec.id}.mjs - do not edit.`);
  lines.push(`// Regenerate with: node tools/slotmath/bin/slotmath.mjs generate ${spec.id}`);
  lines.push(`// Game: ${spec.title}   mode: ${spec.mode}   ${spec.reels} reels x ${spec.rows} rows   ${spec.stops} stops   spec ${spec.hash}`);
  const a = analysis;
  if (a.method === 'exact') {
    lines.push(`// RTP ${pct(a.rtp, 4)} (exact)   hit frequency ${pct(a.hitFrequency, 3)} (1 in ${(1 / a.hitFrequency).toFixed(2)})   volatility ${a.sigma.toFixed(3)} bets/spin`);
  } else {
    lines.push(`// RTP ${pct(a.rtp, 3)} +/- ${pct(a.ci.half, 3)} (Monte Carlo estimate, ${a.ci.samples.toLocaleString('en-US')} spins, seed fixed)   hit frequency ${pct(a.hitFrequency, 3)}   volatility ${a.sigma.toFixed(3)} bets/spin`);
  }
  if (spec.tuning) lines.push(`// Tuned to ${pct(spec.tuning.target, 2)} +/- ${pct(spec.tuning.tolerance, 3)} in ${spec.tuning.moves} integer moves (see the PAR sheet).`);
  lines.push(`// Table data: ${dataBytes} bytes in the program image (const arrays are never in RAM).`);
  lines.push(`// Random bytes: ${plan.perBaseSpin} per base spin${plan.conditional.length ? `, +${plan.conditional.length} when the wheel opens` : ''}, ${plan.perFreeSpin} per free spin.`);
  lines.push('');
  for (const [name, type, value, comment] of consts) lines.push(`export const ${name}: ${type} = ${value}; // ${comment}`);
  for (const [name, type, values, comment] of arrays) {
    lines.push('');
    lines.push(`// ${comment}`);
    lines.push(`export const ${name}: array<${type}, ${values.length}> = [`);
    lines.push(tableLines(values));
    lines.push('];');
  }
  lines.push('');
  return { text: lines.join('\n'), dataBytes, plan, tables: arrays.map(([name, type, values]) => ({ name, type, length: values.length, bytes: TYPE_BYTES[type] * values.length })) };
}

