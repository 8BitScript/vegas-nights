// The comparison sheets of docs/reel-size.md: one per game, a row a machine, today beside what is proposed, every
// screen drawn at the same height so how much of it the reels fill can be judged by eye.
//   node tools/size/sheet.mjs   ->  docs/reel-size/sheet-3x3.png, sheet-5x5.png   (needs rsvg-convert)
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { decodePng, encodePng } from '../tiles/src/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC = join(ROOT, 'docs', 'reel-size');
// rsvg-convert from a fixed install location, not whatever $PATH names (Homebrew on Apple silicon and Intel, the system bin).
const RSVG = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].map((dir) => join(dir, 'rsvg-convert')).find((file) => existsSync(file));
if (!RSVG) throw new Error('sheet: rsvg-convert not found (brew install librsvg)');
const H = 230;                 // every screen is drawn this tall
const COL_W = 400, LABEL_W = 96, GAP = 12, ROW_H = H + 74, TOP = 84;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The PNG scaled to height H by area averaging (down) or nearest (up), as a data URI. */
function embed(file) {
  const { width, height, rgba } = decodePng(readFileSync(file));
  const scale = Math.min(H / height, COL_W / width);   // the same height, unless the capture is wider than its column
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const x0 = x / scale, x1 = (x + 1) / scale, y0 = y / scale, y1 = (y + 1) / scale;
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = Math.floor(y0); sy < Math.min(height, Math.max(Math.ceil(y1), Math.floor(y0) + 1)); sy += 1) {
      for (let sx = Math.floor(x0); sx < Math.min(width, Math.max(Math.ceil(x1), Math.floor(x0) + 1)); sx += 1) {
        const o = (sy * width + sx) * 4; r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; n += 1;
      }
    }
    out.set([Math.round(r / n), Math.round(g / n), Math.round(b / n), 255], (y * w + x) * 4);
  }
  return { w, h, uri: `data:image/png;base64,${Buffer.from(encodePng(w, h, out)).toString('base64')}` };
}

function sheet(name, title, subtitle, rows) {
  const cols = Math.max(...rows.map((r) => r.cells.length));
  const width = LABEL_W + cols * (COL_W + GAP) + GAP;
  const height = TOP + rows.length * ROW_H + 16;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" font-family="Helvetica, Arial, sans-serif">
<rect width="100%" height="100%" fill="#141418"/>
<text x="16" y="30" fill="#ffffff" font-size="20" font-weight="bold">${esc(title)}</text>
${subtitle.split('|').map((line, n) => `<text x="16" y="${50 + n * 15}" fill="#9aa0aa" font-size="12">${esc(line.trim())}</text>`).join('')}`;
  rows.forEach((row, i) => {
    const y = TOP + i * ROW_H;
    const [name, grid] = row.label.split('\n');
    svg += `<text x="16" y="${y + H / 2 - 4}" fill="#e8c46a" font-size="17" font-weight="bold">${esc(name)}</text><text x="16" y="${y + H / 2 + 14}" fill="#8a8f99" font-size="11">${esc(grid ?? '')}</text>`;
    row.cells.forEach((cell, j) => {
      const x = LABEL_W + GAP + j * (COL_W + GAP);
      if (!cell) return;
      const { w, h, uri } = embed(cell.file);
      const dx = x + Math.max(0, (COL_W - w) / 2);
      const dy = y + (H - h) / 2;
      svg += `<rect x="${x}" y="${y - 2}" width="${COL_W}" height="${H + 4}" fill="#000" stroke="${cell.real ? '#3a6' : '#a83'}" stroke-width="1.5"/>`;
      svg += `<image x="${dx}" y="${dy}" width="${w}" height="${h}" xlink:href="${uri}"/>`;
      svg += `<text x="${x}" y="${y + H + 18}" fill="${cell.today ? '#cfd3da' : '#ffffff'}" font-size="12.5" font-weight="bold">${esc(cell.head)}</text>`;
      cell.lines.forEach((line, k) => { svg += `<text x="${x}" y="${y + H + 33 + k * 14}" fill="#9aa0aa" font-size="11">${esc(line)}</text>`; });
    });
  });
  svg += `</svg>`;
  const svgFile = join(DOC, `${name}.svg`);
  writeFileSync(svgFile, svg);
  execFileSync(RSVG, ['-o', join(DOC, `${name}.png`), svgFile]);
  unlinkSync(svgFile); // the SVG embeds every screen as a data URI: an intermediate, not a deliverable
  console.log(`${name}.png  ${width}x${height}`);
}

const t = (g, m) => join(DOC, 'today', `${g}-${m}.png`);
const p = (f) => join(DOC, 'proto', f);
const k = (f) => join(DOC, 'mock', f);

sheet('sheet-3x3', 'Vegas Nights 3x3: how much of the screen the reels fill', 'Green border = a real capture of a built prototype. Amber border = a mock drawn from the real tile conversion. | Every screen is drawn at the same height (the wide VIC-20 captures are fitted to their column). Screen % = the frame block over the machine\'s text grid.', [
  { label: 'PET\n40x25', cells: [
    { file: t('slot3x3', 'pet'), today: true, real: true, head: 'Today (real capture)', lines: ['block 13x11 cells = 104x88 px', '14% of the screen, symbols 3x3 cells (24 px)'] },
    { file: p('pet-quad-3x3-rest.png'), real: true, head: 'Proposed: 6x6-cell symbols (real prototype)', lines: ['block 22x20 cells = 176x160 px', '44% of the screen, symbols 48 px, 12x12 pseudo-pixels'] } ] },
  { label: 'VIC-20\n22x23', cells: [
    { file: t('slot3x3', 'vic20'), today: true, real: true, head: 'Today (real capture)', lines: ['block 13x11 cells = 104x88 px', '28% of the screen'] },
    { file: p('vic20-quad-3x3-rest.png'), real: true, head: 'Proposed: 6x6-cell symbols, coloured (real prototype)', lines: ['block 22x20 cells = the full 22 columns', '87% of the screen'] } ] },
  { label: 'C64\n40x25', cells: [
    { file: t('slot3x3', 'c64'), today: true, real: true, head: 'Today (real capture)', lines: ['block 13x11 cells, 24x24 art in 95 glyphs', '14% of the screen'] },
    { file: k('c64-glyph32-3x3.png'), real: false, head: 'A: 32x32 art, composed glyphs (mock)', lines: ['block 16x14 cells = 128x112 px, 22%', '158 glyph codes (127 free today: needs 31 more)'] },
    { file: k('c64-sprite-3x3.png'), real: false, head: 'B: hardware-sprite reels, 2x2 expanded (mock)', lines: ['block 22x18 cells = 176x144 px, 40%', '12 virtual sprites; multiplexer + raster changes'] } ] },
  { label: 'X16\n76x56', cells: [
    { file: t('slot3x3', 'cx16'), today: true, real: true, head: 'Today (real capture)', lines: ['block 13x11 cells = 104x88 px', '3% of the screen (143 of 4,256 cells)'] },
    { file: p('x16-3x3-rest.png'), real: true, head: 'A: VERA sprite reels, 48 px symbols (real prototype)', lines: ['block 26x22 cells = 208x176 px, 13% of the text grid', '12 sprites, 12 KB of sprite art, no composer'] },
    { file: p('x16-3x3-2x-rest.png'), real: true, head: 'B: the same at VERA 2x scale (real prototype)', lines: ['block 208x176 virtual = 416x352 px on screen', '48% of the display; text becomes 38x28 cells'] } ] },
  { label: 'Web\n48x27', cells: [
    { file: t('slot3x3', 'web'), today: true, real: true, head: 'Today (real capture)', lines: ['block 10x8 cells = 80x64 px (16x16 art)', '6% of the screen'] },
    { file: k('web-quad-3x3.png'), real: false, head: 'A: bigger quadrant blocks, S=6 (mock; no runtime change)', lines: ['block 22x20 cells = 176x160 px, 34%', 'the PET prototype\'s composer, coloured'] },
    { file: k('web-sprite-3x3.png'), real: false, head: 'B: a sprite layer, 48 px symbols (mock)', lines: ['block 26x22 cells = 208x176 px, 44%', 'a new runtime feature (roadmap item 7)'] } ] },
]);

sheet('sheet-5x5', 'Vegas Nights 5x5: how much of the screen the reels fill', 'Green border = a real capture of a built prototype. Amber border = a mock drawn from the real tile conversion. | Every screen is drawn at the same height (the wide VIC-20 captures are fitted to their column).', [
  { label: 'PET\n40x25', cells: [
    { file: t('slot5x5', 'pet'), today: true, real: true, head: 'Today (real capture)', lines: ['block 21x17 cells = 168x136 px', '36% of the screen, symbols 3x3 cells'] },
    { file: p('pet-quad-5x5-rest.png'), real: true, head: 'Proposed: 4x4-cell symbols (real prototype)', lines: ['block 26x22 cells = 208x176 px', '57% of the screen, symbols 32 px'] } ] },
  { label: 'VIC-20\n22x23', cells: [
    { file: t('slot5x5', 'vic20'), today: true, real: true, head: 'Today (real capture)', lines: ['block 21x17 cells = 168x136 px', '71% of the screen: width-capped, 22 columns', 'no larger layout fits (5 reels x 4 cells + 6 = 26)'] } ] },
  { label: 'C64\n40x25', cells: [
    { file: t('slot5x5', 'c64'), today: true, real: true, head: 'Today (real capture)', lines: ['block 16x12 cells = 128x96 px, 19%, 16x16 art', '100 reel glyphs + 14 frame; 24x24 needs 239', 'sprite reels need 30 virtual sprites; max is 24'] } ] },
  { label: 'X16\n76x56', cells: [
    { file: t('slot5x5', 'cx16'), today: true, real: true, head: 'Today (real capture)', lines: ['block 16x12 cells = 128x96 px', '4.5% of the text grid'] },
    { file: p('x16-5x5-rest.png'), real: true, head: 'Proposed: VERA sprite reels, 48 px (real prototype)', lines: ['block 42x34 cells = 336x272 px, 34% of the text grid', '30 sprites, 18 KB of sprite art, no composer'] } ] },
  { label: 'Web\n48x27', cells: [
    { file: t('slot5x5', 'web'), today: true, real: true, head: 'Today (real capture)', lines: ['block 21x17 cells = 168x136 px', '28% of the screen, 3x3-cell blocks'] },
    { file: k('web-quad-5x5.png'), real: false, head: 'A: 4x4-cell quadrant blocks (mock; no runtime change)', lines: ['block 26x22 cells = 208x176 px, 44%', 'the PET prototype\'s composer, coloured'] } ] },
]);
