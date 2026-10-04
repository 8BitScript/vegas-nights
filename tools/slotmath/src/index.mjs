// The library entry: load a spec by id, resolve (tune + normalize) it, analyse it, and
// render its outputs. The CLI and the tests both go through here.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from './tune.mjs';
import { analyze } from './analyze.mjs';
import { emit } from './emit.mjs';
import { toMarkdown, toJson } from './report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SPEC_DIR = join(HERE, '..', 'specs');
export const REPO_ROOT = join(HERE, '..', '..', '..');

/** Settings that make a Monte Carlo figure reproducible: the shipped outputs use exactly these. */
export const MC_DEFAULTS = { samples: 4_000_000, seed: 20261003, batches: 20 };

export const listSpecs = () => readdirSync(SPEC_DIR).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, '')).sort();

export async function loadRaw(id) {
  if (!listSpecs().includes(id)) throw new Error(`no spec "${id}" (have: ${listSpecs().join(', ')})`);
  const mod = await import(pathToFileURL(join(SPEC_DIR, `${id}.mjs`)).href);
  return structuredClone(mod.default);
}

/** Resolve, analyse, emit and render one game. */
export async function build(id, opts = {}) {
  const raw = typeof id === 'string' ? await loadRaw(id) : id;
  const spec = resolve(raw);
  const analysis = analyze(spec, { ...(spec.mode === 'cluster' ? MC_DEFAULTS : {}), ...opts });
  const emitted = emit(spec, analysis);
  return { spec, analysis, emitted, markdown: toMarkdown(spec, analysis, emitted), json: toJson(analysis, { dataBytes: emitted.dataBytes, drawPlan: emitted.plan, tuning: spec.tuning }) };
}
