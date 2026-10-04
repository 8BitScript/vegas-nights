#!/usr/bin/env node
// tiles art <theme>      draw the theme's procedural art into symbols/*.png (only for themes that ship an art.mjs)
// tiles build <theme>    symbols + frame -> src/generated/tiles/<theme>*.8bs for every machine
// tiles check [theme]    fail if the committed tables are not what `build` would write now
// tiles preview <theme>  contact sheets into docs/tiles/
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTheme, themeDir, ROOT } from '../src/theme.mjs';
import { buildTheme } from '../src/build.mjs';
import { encodePng } from '../src/png.mjs';
import { Art } from '../src/raster.mjs';
import { renderPreviews } from '../src/preview.mjs';

const OUT = join(ROOT, 'src', 'generated', 'tiles');
const [command, name] = process.argv.slice(2);

function themes() {
  return readdirSync(join(ROOT, 'assets', 'themes'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}

async function art(themeName) {
  const dir = themeDir(themeName);
  const file = join(dir, 'art.mjs');
  if (!existsSync(file)) throw new Error(`theme ${themeName} has no art.mjs; its PNGs are hand-made`);
  const mod = (await import(pathToFileURL(file).href)).default;
  mkdirSync(join(dir, 'symbols'), { recursive: true });
  const size = mod.size ?? 48;
  for (const [id, draw] of Object.entries(mod.symbols)) {
    const a = new Art(size, mod.design ?? 24, 4);
    draw(a, mod.colors);
    writeFileSync(join(dir, 'symbols', `${id}.png`), encodePng(size, size, a.toRgba()));
  }
  if (mod.frame) writeFileSync(join(dir, 'frame.json'), JSON.stringify(mod.frame, null, 1) + '\n');
  for (const [machine, set] of Object.entries(mod.overrides ?? {})) {
    for (const [id, rows] of Object.entries(set)) {
      const h = rows.length, w = rows[0].length;
      const rgba = new Uint8Array(w * h * 4);
      rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') rgba.set([255, 255, 255, 255], (y * w + x) * 4); }));
      writeFileSync(join(dir, 'symbols', `${id}.${machine}.png`), encodePng(w, h, rgba));
    }
  }
  // Symbols drawn again on a machine's own, smaller design grid: where the master's
  // fine detail (a word, a thin line) resamples to a smudge. Rendered like the masters,
  // written as <ID>.<machine>.png, which the converter prefers for that machine.
  for (const [machine, variant] of Object.entries(mod.variants ?? {})) {
    for (const [id, draw] of Object.entries(variant.symbols)) {
      // a variant may render at its own size: a 32x32 design is drawn at 64 so the converter
      // averages exactly 2x2 samples to a pixel instead of resampling a 48x48 master
      const vsize = variant.size ?? size;
      const a = new Art(vsize, variant.design, 4);
      draw(a, mod.colors);
      writeFileSync(join(dir, 'symbols', `${id}.${machine}.png`), encodePng(vsize, vsize, a.toRgba()));
    }
  }
  console.log(`art: ${themeName}: ${Object.keys(mod.symbols).length} symbols`);
}

async function build(themeName, { write }) {
  const theme = await loadTheme(themeName);
  const { files, report } = buildTheme(theme);
  let stale = 0;
  mkdirSync(OUT, { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    const path = join(OUT, file);
    if (write) writeFileSync(path, text + '\n');
    else if (!existsSync(path) || readFileSync(path, 'utf8') !== text + '\n') { stale += 1; console.error(`stale: ${path}`); }
  }
  if (write) {
    for (const [machine, r] of Object.entries(report)) {
      console.log(`${themeName} ${machine.padEnd(5)} ${String(r.bytes).padStart(6)} bytes of source   ink ${r.ink}${r.clash ? `   colour clash ${r.clash} px` : ''}`);
    }
  }
  return stale;
}

try {
  if (command === 'art' && name) await art(name);
  else if (command === 'build' && name) await build(name, { write: true });
  else if (command === 'check') {
    let stale = 0;
    for (const t of name ? [name] : themes()) stale += await build(t, { write: false });
    if (stale) { console.error('tiles: committed tables are stale; run `node tools/tiles/bin/tiles.mjs build <theme>`'); process.exit(1); }
    console.log('tiles: tables are current');
  } else if (command === 'preview' && name) await renderPreviews(await loadTheme(name), join(ROOT, 'docs', 'tiles'));
  else { console.error('usage: tiles art|build|preview <theme> | tiles check [theme]'); process.exit(2); }
} catch (error) {
  console.error(`tiles: ${error.message}`);
  process.exit(1);
}
