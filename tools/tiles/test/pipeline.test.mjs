import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, crc32 } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng, decodePng } from '../src/png.mjs';
import { Art, rgb } from '../src/raster.mjs';
import { QUAD_CODE, resample, toPixelSymbol, toQuadSymbol, cellFromRows, quadCodeForCell } from '../src/convert.mjs';
import { MACHINES, nearest } from '../src/palettes.mjs';
import { reverseBits } from '../src/emit.mjs';
import { loadTheme, ROOT } from '../src/theme.mjs';
import { buildTheme, convertTheme } from '../src/build.mjs';
import { tileTestCells, expectedScreen } from '../src/layout.mjs';
import { compare } from '../src/shotcheck.mjs';
import { quadTables, pseudoPixels, emitQuadTables, QUAD_OUTPUTS } from '../src/quadtables.mjs';

// ---- png -------------------------------------------------------------------

test('a PNG written by encodePng reads back byte for byte', () => {
  const rgba = new Uint8Array(5 * 3 * 4).map((_, i) => (i * 37) & 255);
  const back = decodePng(encodePng(5, 3, rgba));
  assert.equal(back.width, 5);
  assert.equal(back.height, 3);
  assert.deepEqual([...back.rgba], [...rgba]);
});

test('decodePng reads an indexed 2-bit PNG with a transparent entry, and refuses a non-PNG', () => {
  // 4x2 indexed, depth 2, palette red/green/blue, entry 2 transparent; rows 0 1 2 1 / 2 2 0 0
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 2; ihdr[9] = 3;
  const rows = Buffer.from([0, 0b00_01_10_01 << 0, 0, 0b10_10_00_00]);
  const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('PLTE', Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255])), chunk('tRNS', Buffer.from([255, 255, 0])), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  const img = decodePng(png);
  assert.deepEqual([...img.rgba.subarray(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...img.rgba.subarray(4, 8)], [0, 255, 0, 255]);
  assert.equal(img.rgba[11], 0, 'palette entry 2 is transparent');
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /not a PNG/);
});

// ---- raster ----------------------------------------------------------------

test('a circle covers about pi r^2 of its pixels, and erase cuts a hole', () => {
  const a = new Art(48, 24, 4);
  a.circle('#ff0000', 12, 12, 8);
  let coverage = 0;
  const px = a.toRgba();
  for (let i = 3; i < px.length; i += 4) coverage += px[i] / 255;
  const area = coverage / (48 * 48 / (24 * 24)); // design-grid units squared
  assert.ok(Math.abs(area - Math.PI * 64) < 3, `area ${area}`);
  a.erase((x, y) => x < 12);
  const half = a.toRgba();
  assert.equal(half[(24 * 48 + 16) * 4 + 3], 0, 'the left half is gone');
  assert.equal(half[(24 * 48 + 32) * 4 + 3], 255, 'the right half is whole');
  assert.deepEqual(rgb('#102030'), [16, 32, 48]);
});

test('poly and line paint where they should, and erasePoly cuts', () => {
  const a = new Art(24, 24, 2);
  a.poly('#ffffff', [[2, 2], [10, 2], [10, 10], [2, 10]]);
  a.erasePoly([[4, 4], [8, 4], [8, 8], [4, 8]]);
  a.line('#00ff00', 12, 12, 22, 12, 2);
  const px = a.toRgba();
  assert.equal(px[(3 * 24 + 3) * 4 + 3], 255, 'inside the square');
  assert.equal(px[(5 * 24 + 5) * 4 + 3], 0, 'the erased hole');
  assert.equal(px[(5 * 24 + 15) * 4 + 3], 0, 'outside it');
  assert.deepEqual([...px.subarray((12 * 24 + 17) * 4, (12 * 24 + 17) * 4 + 3)], [0, 255, 0], 'on the line');
});

// ---- convert ---------------------------------------------------------------

test('the sixteen quadrant codes are distinct and match the character ROMs where VICE ships them', () => {
  assert.equal(new Set(QUAD_CODE).size, 16);
  const rom = '/opt/homebrew/share/vice/C64/chargen-901225-01.bin';
  if (!existsSync(rom)) return;
  const buf = readFileSync(rom);
  QUAD_CODE.forEach((code, pattern) => {
    const rows = [...buf.subarray(code * 8, code * 8 + 8)];
    const want = [(pattern >> 3) & 1, (pattern >> 2) & 1, (pattern >> 1) & 1, pattern & 1];
    const got = [[0, 0], [0, 4], [4, 0], [4, 4]].map(([r0, c0]) => {
      let on = 0;
      for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) on += (rows[r0 + r] >> (7 - (c0 + c))) & 1;
      return on === 16 ? 1 : on === 0 ? 0 : -1;
    });
    assert.deepEqual(got, want, `screen code ${code} is pattern ${pattern.toString(2).padStart(4, '0')}`);
  });
});

test('resample averages by area and keeps colour where there is coverage', () => {
  const rgba = new Uint8Array(2 * 2 * 4);
  rgba.set([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 255]);
  const s = resample({ width: 2, height: 2, rgba }, 1, 1);
  assert.equal(s.cover[0], 0.5);
  assert.equal(Math.round(s.red[0]), 255);
});

test('a pixel symbol keeps its ink where the art has it and gives each cell one colour', () => {
  // 8x8 image: left half red, right half cyan, all opaque -> one cell, ink everywhere
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) rgba.set(x < 5 ? [136, 57, 50, 255] : [103, 182, 189, 255], (y * 8 + x) * 4);
  const s = toPixelSymbol({ width: 8, height: 8, rgba }, 'c64', 1, 1);
  assert.deepEqual([...s.bitmap], Array(8).fill(255));
  assert.equal(s.colors[0], 2, 'the majority colour (C64 red) wins the cell');
  assert.equal(s.clash, 24, 'the 3x8 cyan pixels are the clash');
  // the VIC-20 can only ink with colours 0-7
  const v = toPixelSymbol({ width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4).map((_, i) => (i % 4 === 3 ? 255 : [170, 116, 73][i % 4])) }, 'vic20', 1, 1);
  assert.ok(v.colors[0] < 8);
});

test('a quadrant symbol is cellsW*2 by cellsH*2 pseudo-pixels, and cells map to the right ROM code', () => {
  const rgba = new Uint8Array(6 * 6 * 4);
  for (let x = 0; x < 6; x += 1) rgba.set([255, 255, 255, 255], x * 4); // top row only
  const q = toQuadSymbol({ width: 6, height: 6, rgba }, 3, 3);
  assert.equal(q.rows.length, 6);
  assert.equal(q.rows[0], 0b11111100);
  assert.equal(q.rows[1], 0);
  assert.throws(() => toQuadSymbol({ width: 10, height: 10, rgba: new Uint8Array(400) }, 5, 5), /4 cells wide/);
  assert.equal(quadCodeForCell(cellFromRows(['########', '########', '########', '########', '........', '........', '........', '........'])), QUAD_CODE[0b1100]);
  assert.equal(quadCodeForCell(cellFromRows(Array(8).fill('........'))), 32);
  assert.throws(() => cellFromRows(['########']), /8 rows/);
  assert.equal(reverseBits(0b10110000), 0b00001101);
});

test('nearest picks within the allowed set only', () => {
  assert.equal(nearest(MACHINES.c64.palette, [255, 255, 255]), 1);
  assert.ok(nearest(MACHINES.vic20.palette, [191, 206, 114], MACHINES.vic20.fg) < 8);
});

// ---- the classic theme ---------------------------------------------------

const theme = await loadTheme('classic');

test('the classic theme lists the engine\'s symbols in the engine\'s order, and the odds file agrees', () => {
  const odds = readFileSync(join(ROOT, 'src', 'generated', 'classic3x3.8bs'), 'utf8');
  const count = Number(/export const SYMBOL_COUNT: utinyint = (\d+)/.exec(odds)[1]);
  assert.equal(theme.symbols.length, count);
  theme.symbols.forEach((s, i) => assert.match(odds, new RegExp(`export const SYM_${s.id}: utinyint = ${i};`), `${s.id} is symbol ${i} in the odds`));
});

test('every machine gets a file, each symbol has ink, and the sizes follow the theme', () => {
  const { files, report } = buildTheme(theme);
  assert.deepEqual(Object.keys(files).sort(), ['classic.8bs', 'classic.cx16.8bs', 'classic.pet.8bs', 'classic.quad.8bs', 'classic.quad.vic20.8bs', 'classic.quad.web.8bs', 'classic.vic20.8bs', 'classic.web.8bs']);
  for (const [machine, r] of Object.entries(report)) {
    assert.ok(r.bytes > 1000, machine);
    r.data.symbols.forEach((s) => assert.ok((s.ink ?? 1) > 0, `${machine} ${s.id} has ink`));
  }
  assert.match(files['classic.pet.8bs'], /export const QUAD_CODE: array<utinyint, 16>/);
  // the C64's classic symbols are 4x4 cells (32x32 pixels, 128 bytes each), the other pixel machines' 3x3 or 2x2
  assert.match(files['classic.8bs'], /export const SYMBOL_BITMAP: array<utinyint, 768>/);
  assert.match(files['classic.cx16.8bs'], /export const SYMBOL_BITMAP: array<utinyint, 432>/);
  assert.match(files['classic.8bs'], /BIT0_IS_LEFT: bool = false/);
  assert.match(files['classic.web.8bs'], /BIT0_IS_LEFT: bool = true/);
});

test('the web twin is the C64 file with every bitmap byte mirrored, given the same cells; the committed web art is 2x2 cells', () => {
  // Given the C64's cell size, nothing differs but the bit order…
  // (minus the symbols the web and the C64 draw on their own grids, which differ by design: see the next tests)
  const same = { ...theme, cells: { default: [3, 3] }, symbols: theme.symbols.map((s) => ({ ...s, overrides: { ...s.overrides, web: undefined, c64: undefined } })) };
  const c64 = convertTheme(same, 'c64'), web = convertTheme(same, 'web');
  c64.symbols.forEach((s, i) => {
    assert.deepEqual([...web.symbols[i].bitmap], [...s.bitmap], 'same bitmaps before the emitter mirrors them');
    assert.deepEqual([...web.symbols[i].colors], [...s.colors]);
  });
  const bytes = (text, name) => /array<utinyint, \d+> = \[([^\]]+)\]/.exec(text.slice(text.indexOf(`export const ${name}`)))[1].split(',').map(Number);
  const full = buildTheme(same).files;
  assert.deepEqual(bytes(full['classic.web.8bs'], 'SYMBOL_BITMAP'), bytes(full['classic.8bs'], 'SYMBOL_BITMAP').map(reverseBits));
  assert.deepEqual(bytes(full['classic.web.8bs'], 'SYMBOL_COLOR'), bytes(full['classic.8bs'], 'SYMBOL_COLOR'));
  // …and the theme itself asks the web for 16x16 symbols, so the composer fits the 80-glyph table.
  const { files } = buildTheme(theme);
  assert.match(files['classic.web.8bs'], /SYMBOL_CELLS_W: utinyint = 2;/);
  assert.match(files['classic.web.8bs'], /SYMBOL_CELLS_H: utinyint = 2;/);
  assert.match(files['classic.8bs'], /SYMBOL_CELLS_W: utinyint = 4;/); // the C64's own 32x32 art (next test)
  assert.match(files['classic.cx16.8bs'], /SYMBOL_CELLS_W: utinyint = 3;/);
  // The frame does not depend on the symbols' size.
  assert.deepEqual(bytes(files['classic.web.8bs'], 'FRAME_BITMAP'), bytes(files['classic.8bs'], 'FRAME_BITMAP').map(reverseBits));
  assert.deepEqual(bytes(files['classic.web.8bs'], 'FRAME_COLOR'), bytes(files['classic.8bs'], 'FRAME_COLOR'));
});

test('the web draws BAR1 on its own 16x16 grid, so the word on the bar stays legible', () => {
  const bar1 = theme.symbols.find((s) => s.id === 'BAR1');
  assert.ok(bar1.overrides.web, 'classic ships a web variant of BAR1 (art.mjs `variants`)');
  assert.equal(bar1.overrides.web.width, 48);
  // The same symbol resampled from the 24x24 master instead: the letters smudge, and the bitmap differs.
  const plain = { ...theme, symbols: theme.symbols.map((s) => (s.id === 'BAR1' ? { ...s, overrides: {} } : s)) };
  const withVariant = convertTheme(theme, 'web').symbols.find((s) => s.id === 'BAR1');
  const resampled = convertTheme(plain, 'web').symbols.find((s) => s.id === 'BAR1');
  assert.notDeepEqual([...withVariant.bitmap], [...resampled.bitmap]);
  // BAR is three 3x5 letters set at one pixel to the pixel: the lit bar has black holes for the letters (B A R
  // across the bar's middle rows), so the inside of the bar is not a solid slab.
  const holes = [...withVariant.bitmap].reduce((n, byte) => n + (8 - byte.toString(2).split('1').length + 1), 0);
  assert.ok(holes > 0);
  const inks = (b) => [...b.bitmap].reduce((n, byte) => n + byte.toString(2).replace(/0/g, '').length, 0);
  assert.ok(inks(withVariant) < inks(resampled) + 40, 'the word is cut out of a bar of similar weight');
});

test('the VIC-20 only inks with colours 0-7, every colour is in its machine\'s palette, and the PET has no colour table', () => {
  const { files } = buildTheme(theme);
  const colours = (text, name) => /array<utinyint, \d+> = \[([^\]]+)\]/.exec(text.slice(text.indexOf(`export const ${name}`)))[1].split(',').map(Number);
  assert.ok(colours(files['classic.vic20.8bs'], 'SYMBOL_COLOR').every((c) => c < 8));
  assert.ok(colours(files['classic.vic20.8bs'], 'FRAME_COLOR').every((c) => c < 8));
  assert.ok(colours(files['classic.cx16.8bs'], 'SYMBOL_COLOR').every((c) => c < 16));
  assert.doesNotMatch(files['classic.pet.8bs'], /SYMBOL_COLOR/);
});

test('every frame cell the lab draws exists in the theme, and an explicit PET pattern wins over the automatic one', () => {
  const data = convertTheme(theme, 'pet');
  for (const cell of tileTestCells(data)) if (cell.frame) assert.ok(data.frame.names.includes(cell.frame), cell.frame);
  assert.equal(data.frame.codes[data.frame.names.indexOf('T')], QUAD_CODE[0b1100]);
  assert.equal(data.frame.codes[data.frame.names.indexOf('ARROW_L')], 160);
});

test('the committed tables are what the pipeline writes now (a stale file fails here)', async () => {
  const { files } = buildTheme(theme);
  for (const [name, text] of Object.entries(files)) {
    assert.equal(readFileSync(join(ROOT, 'src', 'generated', 'tiles', name), 'utf8'), text + '\n', `${name} is current`);
  }
});

// ---- the comparison itself -----------------------------------------------

test('compare passes an exact image, and fails when one ink pixel moves or a colour changes', () => {
  const data = convertTheme(theme, 'c64');
  const e = expectedScreen('c64', data, 40, 25);
  // paint the expected image as an RGBA screenshot at offset (3, 5)
  const W = e.w + 10, H = e.h + 10;
  const palette = MACHINES.c64.palette;
  const png = { width: W, height: H, rgba: new Uint8Array(W * H * 4) };
  for (let i = 0; i < W * H; i += 1) png.rgba[i * 4 + 3] = 255;
  for (let y = 0; y < e.h; y += 1) for (let x = 0; x < e.w; x += 1) {
    const k = e.px[y * e.w + x];
    if (k >= 0) png.rgba.set([...palette[k], 255], ((y + 5) * W + x + 3) * 4);
  }
  const ok = compare(png, e, { left: 3, top: 5 });
  assert.equal(ok.wrongInk + ok.wrongPaper + ok.inconsistent + ok.collisions, 0);
  assert.ok(ok.inkSeen > 5000);
  const off = compare(png, e, { left: 4, top: 5 });
  assert.ok(off.wrongInk + off.wrongPaper > 100, 'a one-pixel shift is caught');
  // recolour one pixel of an ink colour: the mapping becomes inconsistent
  const first = e.px.findIndex((v) => v >= 0);
  const fx = first % e.w, fy = Math.floor(first / e.w);
  png.rgba.set([1, 2, 3, 255], ((fy + 5) * W + fx + 3) * 4);
  assert.ok(compare(png, e, { left: 3, top: 5 }).inconsistent > 0);
});


// ---- quadrant tables ---------------------------------------------------------------------------------------------

const fileTables = (text) => {
  const out = {};
  for (const m of text.matchAll(/^export const (\w+): (?:\w+) = (\d+|true|false);/gm)) out[m[1]] = m[2] === 'true' ? true : m[2] === 'false' ? false : Number(m[2]);
  for (const m of text.matchAll(/^export const (\w+): array<\w+, \d+> = \[([^\]]*)\];/gm)) out[m[1]] = m[2].split(',').map((v) => Number(v.trim()));
  return out;
};

test('quadrant files exist for the PET, the VIC-20 and the web, at the sizes the theme names, and only the colour machines carry ink', () => {
  const { files } = buildTheme(theme);
  const pet = fileTables(files['classic.quad.8bs']);
  const vic = fileTables(files['classic.quad.vic20.8bs']);
  const web = fileTables(files['classic.quad.web.8bs']);
  for (const t of [pet, vic, web]) {
    assert.equal(t.QUAD_S, 6, 'classic is 6x6 cells on the quadrant machines');
    assert.equal(t.QUAD_P, 12);
    assert.equal(t.QUAD_C0.length, 6 * 6 * 6);
    assert.equal(t.QUAD_C1.length, 6 * 5 * 6);
    assert.equal(t.QUAD_CX.length, 6 * 6 * 6);
  }
  assert.equal(pet.QUAD_COLORED, false);
  assert.deepEqual(pet.QUAD_K, [0], 'no ink table on a machine with no colour');
  assert.equal(vic.QUAD_K.length, 6 * 6 * 6);
  assert.ok(vic.QUAD_K.every((v) => v >= 0 && v <= 7), "the VIC-20's ink is a number 0-7");
  assert.ok(web.QUAD_C0.every((v) => v >= 128 && v <= 143), "the web's blocks are the host font's codes 128-143");
  assert.ok(pet.QUAD_C0.every((v) => QUAD_CODE.includes(v)), "the PET's blocks are the sixteen codes of its character ROM");
});

test('quadrant tables round-trip: C0 decodes back to the symbols\' pseudo-pixels, C1 and CX cover exactly the rows they say', () => {
  const S = 6, P = 12;
  const images = theme.symbols.map((sym) => sym.overrides[`quad${S}`] ?? sym.img);
  const t = quadTables(images, S, QUAD_CODE, null);
  const decode = (code) => { const p = QUAD_CODE.indexOf(code); return [(p >> 3) & 1, (p >> 2) & 1, (p >> 1) & 1, p & 1]; };
  images.forEach((img, sym) => {
    const want = pseudoPixels(img, S);
    for (let k = 0; k < S; k += 1) for (let c = 0; c < S; c += 1) {
      const [a, b, d, e] = decode(t.C0[(sym * S + k) * S + c]);
      assert.deepEqual([want[2 * k][2 * c], want[2 * k][2 * c + 1], want[2 * k + 1][2 * c], want[2 * k + 1][2 * c + 1]], [a, b, d, e], `C0 symbol ${sym} cell ${k},${c}`);
    }
    // C1: the pair that starts on an odd row (rows 2k+1 and 2k+2)
    for (let k = 0; k < S - 1; k += 1) for (let c = 0; c < S; c += 1) {
      const [a, b, d, e] = decode(t.C1[(sym * (S - 1) + k) * S + c]);
      assert.deepEqual([want[2 * k + 1][2 * c], want[2 * k + 1][2 * c + 1], want[2 * k + 2][2 * c], want[2 * k + 2][2 * c + 1]], [a, b, d, e], `C1 symbol ${sym} cell ${k},${c}`);
    }
    // CX: this symbol's last row over every other symbol's first
    images.forEach((other, next) => {
      const w2 = pseudoPixels(other, S);
      for (let c = 0; c < S; c += 1) {
        const [a, b, d, e] = decode(t.CX[(sym * images.length + next) * S + c]);
        assert.deepEqual([want[P - 1][2 * c], want[P - 1][2 * c + 1], w2[0][2 * c], w2[0][2 * c + 1]], [a, b, d, e], `CX ${sym} over ${next} column ${c}`);
      }
    });
  });
});

test('a symbol hand-drawn on the quadrant grid (<ID>.quad6.png) is the shape the tables are cut from; the colour master supplies only the ink', () => {
  const bar1 = theme.symbols.find((sym) => sym.id === 'BAR1');
  assert.ok(bar1.overrides.quad6, 'the committed classic theme draws BAR1 on the 12x12 grid');
  const drawn = pseudoPixels(bar1.overrides.quad6, 6);
  assert.equal(drawn.flat().reduce((n, v) => n + v, 0), 10 * 4, 'BAR1 is one bar, ten pseudo-pixels wide and four tall');
  const out = QUAD_OUTPUTS.find((o) => o.machine === 'vic20');
  const text = emitQuadTables(theme, out, 6);
  const { QUAD_K } = fileTables(text);
  const master = toPixelSymbol(bar1.img, 'vic20', 6, 6).colors;
  const index = theme.symbols.indexOf(bar1);
  assert.deepEqual(QUAD_K.slice(index * 36, index * 36 + 36), [...master].map((v) => v & 7), 'the ink of BAR1 is the master\'s');
});

test('the three BAR symbols are told apart by how many bars they have on every quadrant machine', () => {
  const rowsWithInk = (id) => {
    const sym = theme.symbols.find((x) => x.id === id);
    return pseudoPixels(sym.overrides.quad6 ?? sym.img, 6).filter((row) => row.some(Boolean)).length;
  };
  const bars = (id) => {
    const sym = theme.symbols.find((x) => x.id === id);
    const px = pseudoPixels(sym.overrides.quad6 ?? sym.img, 6);
    let runs = 0, inRun = false;
    for (const row of px) { const on = row.some(Boolean); if (on && !inRun) runs += 1; inRun = on; }
    return runs;
  };
  assert.deepEqual([bars('BAR1'), bars('BAR2'), bars('BAR3')], [1, 2, 3]);
  assert.ok(rowsWithInk('BAR1') > 0);
});

test('the C64 draws its classic symbols on a 4x4-cell (32x32) grid of their own, and the table says so', () => {
  assert.deepEqual(theme.cells.c64, [4, 4]);
  const c64 = convertTheme(theme, 'c64');
  assert.equal(c64.cellsW, 4);
  assert.equal(c64.cellsH, 4);
  c64.symbols.forEach((s) => {
    assert.equal(s.bitmap.length, 4 * 4 * 8, `${s.id}: sixteen cells of eight bytes`);
    assert.equal(s.colors.length, 16, `${s.id}: a colour a cell`);
  });
  // every symbol is drawn at the C64's own grid (a <ID>.c64.png master), not squeezed from the 24x24 art
  theme.symbols.forEach((s) => assert.ok(s.overrides.c64, `${s.id} has a 32x32 master`));
  const text = buildTheme(theme).files['classic.8bs'];
  assert.match(text, /SYMBOL_CELLS_W: utinyint = 4;/);
  assert.match(text, /SYMBOL_CELLS_H: utinyint = 4;/);
  assert.match(text, /SYMBOL_BYTES: usmallint = 128;/);
});
