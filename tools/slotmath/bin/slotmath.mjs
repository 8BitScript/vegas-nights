#!/usr/bin/env node
// slotmath - design and verify slot machines, and emit their tables for 8BitScript.
//
//   slotmath list
//   slotmath report <game> [--json] [--method mc] [--samples N]
//   slotmath tune <game>
//   slotmath generate [game ...]     write src/generated/<game>.8bs and docs/par/<game>.md
//   slotmath check [game ...]        exit 1 if a committed output is stale
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { build, listSpecs, REPO_ROOT } from '../src/index.mjs';
import { pct } from '../src/util.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.slice(2).split('=');
  return [k, v ?? true];
}));
const names = rest.filter((a) => !a.startsWith('--'));
const targets = names.length ? names : listSpecs();

const outPaths = (id) => ({
  table: join(REPO_ROOT, 'src', 'generated', `${id}.8bs`),
  par: join(REPO_ROOT, 'docs', 'par', `${id}.md`),
});

async function main() {
  if (cmd === 'list') {
    console.log(listSpecs().join('\n'));
  } else if (cmd === 'report') {
    const opts = {};
    if (flags.method) opts.method = flags.method;
    if (flags.samples) opts.samples = Number(flags.samples);
    const r = await build(names[0], opts);
    console.log(flags.json ? JSON.stringify(r.json, null, 2) : r.markdown);
  } else if (cmd === 'tune') {
    const r = await build(names[0]);
    const t = r.spec.tuning;
    if (!t) { console.log(`${names[0]} has no tune block`); return; }
    console.log(`target ${pct(t.target, 2)} +/- ${pct(t.tolerance, 3)}; reached ${pct(t.rtp, 4)} in ${t.moves} moves`);
    for (const s of t.steps) console.log(`  ${s.move} x${s.times} -> ${pct(s.after, 4)}`);
  } else if (cmd === 'generate' || cmd === 'check') {
    let stale = 0;
    for (const id of targets) {
      const r = await build(id);
      const p = outPaths(id);
      for (const [file, text] of [[p.table, r.emitted.text], [p.par, r.markdown]]) {
        if (cmd === 'generate') {
          mkdirSync(join(file, '..'), { recursive: true });
          writeFileSync(file, text);
        } else if (!existsSync(file) || readFileSync(file, 'utf8') !== text) {
          console.error(`STALE ${file}`);
          stale += 1;
        }
      }
      const a = r.analysis;
      console.log(`${id.padEnd(12)} RTP ${pct(a.rtp, 3)}${a.method === 'mc' ? ` +/- ${pct(a.ci.half, 3)} (MC)` : ' (exact)'}  hit 1 in ${(1 / a.hitFrequency).toFixed(2)}  sigma ${a.sigma.toFixed(2)}  ${r.emitted.dataBytes} data bytes  ${r.emitted.plan.perBaseSpin}+ random bytes/spin`);
    }
    if (stale) { console.error(`${stale} stale output(s): run "node tools/slotmath/bin/slotmath.mjs generate"`); process.exit(1); }
  } else {
    console.error('usage: slotmath list | report <game> [--json] | tune <game> | generate [game...] | check [game...]');
    process.exit(2);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
