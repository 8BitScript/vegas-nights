// A tiny supersampling vector rasteriser, so symbol art is described once, in
// a 24x24 design grid, and rendered cleanly at any size: 48x48 for the PNG
// masters a designer can open, 24x24 for the pixel machines, 6x6 for the PET's
// pseudo-pixels. Shapes paint in order (later over earlier); `erase` cuts
// holes. Colours are [r, g, b] or '#rrggbb'.

export function rgb(color) {
  if (Array.isArray(color)) return color;
  const hex = String(color).replace('#', '');
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

export class Art {
  /** @param size output pixels per side; @param design design-grid units per side; @param ss samples per output pixel per axis */
  constructor(size = 48, design = 24, ss = 4) {
    this.size = size;
    this.design = design;
    this.ss = ss;
    this.hi = size * ss;
    this.samples = new Int32Array(this.hi * this.hi).fill(-1); // packed 0xRRGGBB, or -1 = nothing
    this.unit = design / this.hi; // design units per sample
  }

  /** Paint every sample whose design-grid centre satisfies `test(x, y)`. */
  fill(color, test) {
    const [r, g, b] = rgb(color);
    const packed = (r << 16) | (g << 8) | b;
    const { hi, unit, samples } = this;
    for (let j = 0; j < hi; j += 1) {
      const y = (j + 0.5) * unit;
      for (let i = 0; i < hi; i += 1) {
        if (test((i + 0.5) * unit, y)) samples[j * hi + i] = packed;
      }
    }
    return this;
  }

  erase(test) {
    const { hi, unit, samples } = this;
    for (let j = 0; j < hi; j += 1) {
      const y = (j + 0.5) * unit;
      for (let i = 0; i < hi; i += 1) {
        if (test((i + 0.5) * unit, y)) samples[j * hi + i] = -1;
      }
    }
    return this;
  }

  rect(color, x0, y0, x1, y1) { return this.fill(color, (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1); }
  circle(color, cx, cy, r) { return this.fill(color, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r); }
  ellipse(color, cx, cy, rx, ry) { return this.fill(color, (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1); }
  ring(color, cx, cy, r0, r1) { return this.fill(color, (x, y) => { const d = (x - cx) ** 2 + (y - cy) ** 2; return d >= r0 * r0 && d <= r1 * r1; }); }
  rrect(color, x0, y0, x1, y1, r) {
    return this.fill(color, (x, y) => {
      if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
      const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
      const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
      return dx * dx + dy * dy <= r * r;
    });
  }
  poly(color, points) { return this.fill(color, (x, y) => inside(points, x, y)); }
  line(color, x0, y0, x1, y1, width) {
    return this.fill(color, (x, y) => distanceToSegment(x, y, x0, y0, x1, y1) <= width / 2);
  }

  /** The art as RGBA at `size` x `size`: alpha = coverage, rgb = mean of the covered samples. */
  toRgba() {
    const { size, ss, hi, samples } = this;
    const out = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let n = 0, r = 0, g = 0, b = 0;
        for (let j = 0; j < ss; j += 1) {
          for (let i = 0; i < ss; i += 1) {
            const s = samples[(y * ss + j) * hi + (x * ss + i)];
            if (s < 0) continue;
            n += 1; r += (s >> 16) & 255; g += (s >> 8) & 255; b += s & 255;
          }
        }
        const o = (y * size + x) * 4;
        if (n > 0) { out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); }
        out[o + 3] = Math.round((n / (ss * ss)) * 255);
      }
    }
    return out;
  }
}

function inside(points, x, y) {
  let on = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) on = !on;
  }
  return on;
}

function distanceToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}
