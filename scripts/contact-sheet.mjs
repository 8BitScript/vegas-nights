// Stitch crops of headless screenshots into one PNG, for the README.
//
//   node scripts/contact-sheet.mjs out.png --scale 3 --gap 8 \
//        shots/a.png:x0,y0,x1,y1  shots/b.png:x0,y0,x1,y1 ...
//
// Each input is a PNG path and the pixel rectangle to keep (x0,y0 inclusive, x1,y1
// exclusive; omit the rectangle for the whole picture). Crops are laid left to
// right, scaled up by whole pixels, with a grey gap between.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { decodePng } from '../test/support/png.mjs';

const args = process.argv.slice(2);
const out = args.shift();
let scale = 3;
let gap = 8;
const inputs = [];
while (args.length) {
  const a = args.shift();
  if (a === '--scale') scale = Number(args.shift());
  else if (a === '--gap') gap = Number(args.shift());
  else inputs.push(a);
}
const crops = inputs.map((spec) => {
  const [file, rect] = spec.split(':');
  const png = decodePng(readFileSync(file));
  const [x0, y0, x1, y1] = rect ? rect.split(',').map(Number) : [0, 0, png.width, png.height];
  return { png, x0, y0, w: x1 - x0, h: y1 - y0 };
});
const height = Math.max(...crops.map((c) => c.h)) * scale;
const width = crops.reduce((sum, c) => sum + c.w * scale, 0) + gap * (crops.length - 1);
const rows = [];
for (let y = 0; y < height; y += 1) {
  const row = Buffer.alloc(1 + width * 3);
  let x = 1;
  crops.forEach((c, i) => {
    for (let px = 0; px < c.w * scale; px += 1) {
      const sy = Math.floor(y / scale);
      const v = sy < c.h ? c.png.at(c.x0 + Math.floor(px / scale), c.y0 + sy) : 0;
      row[x++] = (v >> 16) & 255; row[x++] = (v >> 8) & 255; row[x++] = v & 255;
    }
    if (i < crops.length - 1) for (let g = 0; g < gap * 3; g += 1) row[x++] = 70;
  });
  rows.push(row);
}
const crc = (() => {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  return (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body));
  return Buffer.concat([head, body, tail]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]));
console.log(`${out}: ${width}x${height}`);
