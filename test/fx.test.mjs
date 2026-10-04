// The bonus-round look (src/shared/fx.8bs and its machine twins), held to one shape — with no
// emulator, so this runs in CI.
//
// Every machine that does better than nothing replaces fx.8bs whole with fx.<machine>.8bs, and
// the game calls the same four names on all of them. Each machine's effect is written by a
// different hand (docs/fx.md), so the surface they share is pinned here: a twin that adds, drops,
// renames or retypes a member fails this test before it fails a build on some other machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './support/table.mjs';

const SHARED = join(ROOT, 'src', 'shared');
const MACHINES = ['pet', 'vic20', 'c64', 'cx16', 'web'];

// The portable surface, exactly as fx.8bs declares it (the stub is the definition).
const SURFACE = [
  'const RASTER: bool',
  'function begin(): void',
  'function frame(tick: utinyint): void',
  'function end(): void',
];

/** Strip // comments and string literals; the language has no block comments. */
const code = (text) => text.split('\n').map((line) => line.replace(/\/\/.*$/, '').replace(/"(?:[^"\\]|\\.)*"/g, '""')).join('\n');

/**
 * The members of `export namespace fx { … }`: the declarations at brace depth 1 inside it, with
 * function bodies elided, one string each (`const RASTER: bool = false;`, `function begin(): void {}`).
 */
function members(text) {
  const body = code(text);
  const open = /export\s+namespace\s+fx\s*\{/.exec(body);
  assert.ok(open, 'no `export namespace fx { … }`');
  let depth = 1;
  let top = '';
  for (const ch of body.slice(open.index + open[0].length)) {
    if (ch === '{') {
      depth += 1;
      if (depth === 2) top += '{';
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) break;
      if (depth === 1) top += '}';
    } else if (depth === 1) {
      top += ch;
    }
  }
  return top.split(/(?<=[;}])/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** `const RASTER: bool = …` -> `const RASTER: bool`; `function f(a: t): void { … }` -> the header. */
const signature = (s) => {
  const c = /^const (\w+): (\w+)\b/.exec(s);
  if (c) return `const ${c[1]}: ${c[2]}`;
  const f = /^function (\w+)\(([^)]*)\): (\w+)/.exec(s);
  if (f) return `function ${f[1]}(${f[2].trim()}): ${f[3]}`;
  return s;
};

const files = readdirSync(SHARED).filter((f) => /^fx(\.\w+)?\.8bs$/.test(f)).sort();

test('fx.8bs exists, and the only twins are the five machines the release builds', () => {
  assert.ok(files.includes('fx.8bs'), 'src/shared/fx.8bs is the portable stub');
  for (const file of files) {
    const machine = /^fx\.(\w+)\.8bs$/.exec(file)?.[1];
    if (machine) assert.ok(MACHINES.includes(machine), `${file}: ${machine} is not one of ${MACHINES.join(', ')}`);
  }
});

for (const file of files) {
  test(`${file} exports exactly the portable surface, nothing more`, () => {
    const found = members(readFileSync(join(SHARED, file), 'utf8')).map(signature);
    assert.deepEqual([...found].sort(), [...SURFACE].sort(), `${file}: ${found.join(' | ')}`);
  });
}

test('the portable stub has RASTER false and empty bodies, so the game pays nothing for it', () => {
  const text = code(readFileSync(join(SHARED, 'fx.8bs'), 'utf8'));
  assert.match(text, /const RASTER: bool = false;/);
  for (const name of ['begin', 'frame', 'end']) {
    assert.match(text, new RegExp(`function ${name}\\([^)]*\\): void \\{\\s*\\}`), `${name} is empty`);
  }
});

test('the 5x5 calls the hooks where the bonus round starts and ends, and frame() only when RASTER', () => {
  const game = readFileSync(join(ROOT, 'src', 'labs', 'slot5x5', 'game.8bs'), 'utf8');
  assert.match(game, /import \{ fx \} from "@shared\/fx\.8bs";/);
  assert.match(game, /banner\(true\);\s*fx\.begin\(\);/, 'fx.begin() right after the FREE SPINS banner goes up');
  assert.match(game, /banner\(false\);\s*fx\.end\(\);/, 'fx.end() right after the banner comes down');
  assert.match(game, /if \(fx\.RASTER\) \{\s*if \(inBonus\) \{\s*fxTick = fxTick \+ 1;\s*fx\.frame\(fxTick\);/, 'frame() once a frame, inside RASTER and inBonus');
  assert.match(game, /waitFrame\(\);[\s\S]*?frameFx\(\);/, 'frameFx() runs in the main loop after waitFrame()');
});

test('docs/fx.md names every twin file the repo has', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'fx.md'), 'utf8');
  for (const file of files) assert.ok(doc.includes(file), `docs/fx.md does not mention ${file}`);
  for (const machine of MACHINES) assert.ok(doc.includes(`fx.${machine}.8bs`), `docs/fx.md does not name fx.${machine}.8bs`);
});
