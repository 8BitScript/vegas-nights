// A small RGBA canvas for the mocks and sheets (the tile tool's preview keeps its own, unexported).
import { encodePng } from '../tiles/src/png.mjs';

// 5x7 label font, one 5-bit row per line.
const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 27, 17], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0], '-': [0, 0, 0, 31, 0, 0, 0], ':': [0, 4, 0, 0, 0, 4, 0], '.': [0, 0, 0, 0, 0, 12, 12], '/': [1, 1, 2, 4, 8, 16, 16],
};

export class Image {
  constructor(w, h, bg = [0, 0, 0]) { this.w = w; this.h = h; this.rgba = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i += 1) this.rgba.set([...bg, 255], i * 4); }
  px(x, y, c) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.rgba.set([c[0], c[1], c[2], 255], (y * this.w + x) * 4); }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) this.px(x + i, y + j, c); }
  text(x, y, s, c = [230, 230, 230], scale = 1) {
    [...String(s).toUpperCase()].forEach((ch, k) => {
      const g = FONT[ch] ?? FONT[' '];
      g.forEach((row, j) => { for (let i = 0; i < 5; i += 1) if ((row >> (4 - i)) & 1) this.rect(x + (k * 6 + i) * scale, y + j * scale, scale, scale, c); });
    });
  }
  /** An 8x8 character cell from eight row bytes (bit 7 = leftmost). */
  cell(x, y, rows, ink, paper) {
    this.rect(x, y, 8, 8, paper);
    rows.forEach((byte, r) => { for (let c = 0; c < 8; c += 1) if ((byte >> (7 - c)) & 1) this.px(x + c, y + r, ink); });
  }
  /** Nearest-neighbour upscale by an integer factor. */
  scaled(k) {
    const out = new Image(this.w * k, this.h * k);
    for (let y = 0; y < out.h; y += 1) for (let x = 0; x < out.w; x += 1) {
      const o = (Math.floor(y / k) * this.w + Math.floor(x / k)) * 4;
      out.rgba.set(this.rgba.subarray(o, o + 4), (y * out.w + x) * 4);
    }
    return out;
  }
  png() { return encodePng(this.w, this.h, this.rgba); }
}
