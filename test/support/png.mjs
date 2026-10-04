// A minimal PNG reader: 8-bit greyscale, RGB, palette and RGBA, no interlace —
// what the emulators' screenshot paths write.
import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  let offset = 8;
  let width = 0, height = 0, depth = 0, colorType = 0;
  let palette = null;
  const idat = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (depth !== 8) throw new Error(`png: expected 8-bit samples, got ${depth}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    const out = pixels.subarray(row * stride, (row + 1) * stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? out[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[i] = value & 0xff;
    }
    previous = out;
  }
  /** The pixel at (x, y) as one integer (RGB packed), whatever the colour type. */
  const at = (x, y) => {
    const i = y * stride + x * channels;
    if (colorType === 3) { const p = pixels[i] * 3; return (palette[p] << 16) | (palette[p + 1] << 8) | palette[p + 2]; }
    if (colorType === 0 || colorType === 4) return (pixels[i] << 16) | (pixels[i] << 8) | pixels[i];
    return (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
  };
  return { width, height, at };
}
