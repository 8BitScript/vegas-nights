// The colours each machine can show, as the runtime paints them. C64 and web
// share a palette (packages/cli/src/web-layout.mjs: "a color number means the
// same thing on every machine"); the X16's first 16 palette entries follow the
// C64's; the VIC-20 and PET differ. `fg` lists the colour numbers a cell's ink
// may use (the VIC-20's colour RAM holds only 0-7 in hires mode).
import { rgb } from './raster.mjs';

const C64 = [
  '#000000', '#ffffff', '#883932', '#67b6bd', '#8b3f96', '#55a049', '#40318d', '#bfce72',
  '#8b5429', '#574200', '#b86962', '#505050', '#787878', '#94e089', '#7869c4', '#9f9f9f',
];
const VIC20 = [
  '#000000', '#ffffff', '#782922', '#87d6dd', '#aa5fb6', '#55a049', '#40318d', '#bfce72',
  '#aa7449', '#e99d7f', '#de7c6b', '#c9ffff', '#e99df5', '#94e089', '#8071cc', '#fffffe',
];

export const MACHINES = {
  c64: { label: 'Commodore 64', palette: C64.map(rgb), fg: range(16), mode: 'pixels', gridW: 40, gridH: 25 },
  vic20: { label: 'VIC-20', palette: VIC20.map(rgb), fg: range(8), mode: 'pixels', gridW: 22, gridH: 23 },
  cx16: { label: 'Commander X16', palette: C64.map(rgb), fg: range(16), mode: 'pixels', gridW: 76, gridH: 56 },
  web: { label: 'Web', palette: C64.map(rgb), fg: range(16), mode: 'pixels', gridW: 40, gridH: 25 },
  pet: { label: 'Commodore PET', palette: [[0, 0, 0], rgb('#55ff55')], fg: [1], mode: 'quadrants', gridW: 40, gridH: 25 },
};

export const MACHINE_IDS = Object.keys(MACHINES);

function range(n) { return Array.from({ length: n }, (_, i) => i); }

/** Index of the palette entry nearest `color`, among `allowed` indices. */
export function nearest(palette, color, allowed = range(palette.length)) {
  let best = allowed[0], bestD = Infinity;
  for (const i of allowed) {
    const p = palette[i];
    // a light perceptual weighting: green counts most, blue least
    const d = 2 * (p[0] - color[0]) ** 2 + 4 * (p[1] - color[1]) ** 2 + 3 * (p[2] - color[2]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function luma(color) { return 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]; }
