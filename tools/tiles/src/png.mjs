// A small PNG codec: just enough to read artwork a designer saves from any
// tool (8-bit gray, gray+alpha, RGB, RGBA, or indexed at 1/2/4/8 bits, not
// interlaced) and to write RGBA previews and masters. No dependencies beyond
// node:zlib.
import { deflateSync, inflateSync, crc32 } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, check]);
}

/** Encode `rgba` (width*height*4 bytes) as an 8-bit RGBA PNG. */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error(`encodePng: ${rgba.length} bytes for ${width}x${height}`);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Decode a PNG into { width, height, rgba: Uint8Array }. */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header) throw new Error('PNG has no header');
  if (header.interlace !== 0) throw new Error('interlaced PNGs are not supported');
  const { width, height, depth, color } = header;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (channels === undefined) throw new Error(`unsupported PNG color type ${color}`);
  if (depth !== 8 && !(color === 3 || color === 0) ) throw new Error(`unsupported PNG bit depth ${depth}`);
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const raw = inflateSync(Buffer.concat(idat));
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? rows[y * stride + x - bpp] : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? rows[(y - 1) * stride + x - bpp] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      rows[y * stride + x] = value & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  const sample = (y, index) => {
    // the index-th sample of row y, at the file's bit depth
    if (depth === 8) return rows[y * stride + index];
    const perByte = 8 / depth;
    const byte = rows[y * stride + Math.floor(index / perByte)];
    const shift = 8 - depth * ((index % perByte) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (color === 6) {
        for (let k = 0; k < 4; k += 1) rgba[o + k] = sample(y, x * 4 + k);
      } else if (color === 2) {
        for (let k = 0; k < 3; k += 1) rgba[o + k] = sample(y, x * 3 + k);
        rgba[o + 3] = 255;
      } else if (color === 0) {
        const v = sample(y, x);
        const scaled = depth === 8 ? v : Math.round((v * 255) / ((1 << depth) - 1));
        rgba[o] = rgba[o + 1] = rgba[o + 2] = scaled;
        rgba[o + 3] = 255;
      } else if (color === 4) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = sample(y, x * 2);
        rgba[o + 3] = sample(y, x * 2 + 1);
      } else {
        const i = sample(y, x);
        if (!palette) throw new Error('indexed PNG without PLTE');
        rgba[o] = palette[i * 3];
        rgba[o + 1] = palette[i * 3 + 1];
        rgba[o + 2] = palette[i * 3 + 2];
        rgba[o + 3] = transparency && i < transparency.length ? transparency[i] : 255;
      }
    }
  }
  return { width, height, rgba };
}
