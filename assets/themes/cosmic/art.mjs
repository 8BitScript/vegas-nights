// Cosmic: the 5x5 grid's symbols — STAR MOON SUN COMET ORB RING BLANK WILD SCAT —
// in deep-space colours. Same rules as classic: a 24x24 design grid, one ink per
// 8x8 cell, detail from black gaps.
import { frameCells } from '../frame-kit.mjs';

const C = {
  white: '#ffffff', red: '#883932', lred: '#b86962', cyan: '#67b6bd', purple: '#8b3f96', green: '#55a049',
  lgreen: '#94e089', blue: '#40318d', lblue: '#7869c4', yellow: '#bfce72', orange: '#8b5429', grey: '#787878', lgrey: '#9f9f9f',
};

function star(cx, cy, outer, inner, points = 5, rotate = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotate + (i * Math.PI) / points;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

export default {
  size: 48,
  design: 24,
  colors: C,
  symbols: {
    STAR(a) {
      a.poly(C.yellow, star(12, 12.8, 11, 4.6));
      a.erase((x, y) => y >= 8 && y < 9 && x >= 10.5 && x < 13.5); // a glint at the top point
    },
    MOON(a) {
      a.circle(C.lgrey, 12, 12, 10);
      a.erase((x, y) => (x - 16.5) ** 2 + (y - 9) ** 2 <= 9.5 ** 2); // the crescent
      a.poly(C.yellow, star(18.5, 17.5, 2.6, 1.0));
    },
    SUN(a) {
      for (let i = 0; i < 8; i += 1) {
        const ang = (i * Math.PI) / 4;
        const tip = [12 + 11.5 * Math.cos(ang), 12 + 11.5 * Math.sin(ang)];
        const l = [12 + 6.5 * Math.cos(ang - 0.28), 12 + 6.5 * Math.sin(ang - 0.28)];
        const r = [12 + 6.5 * Math.cos(ang + 0.28), 12 + 6.5 * Math.sin(ang + 0.28)];
        a.poly(C.orange, [l, tip, r]);
      }
      a.circle(C.yellow, 12, 12, 6);
      a.erase((x, y) => (x - 10) ** 2 + (y - 10) ** 2 <= 1.6);
    },
    COMET(a) {
      a.poly(C.cyan, [[20, 3], [3, 18], [6.5, 21.5], [21, 6]]); // the tail
      a.erase((x, y) => Math.abs(x + y - 22.5) < 0.5 && x > 8 && x < 18);
      a.circle(C.white, 17, 7, 5.2); // the head
      a.erase((x, y) => (x - 15.5) ** 2 + (y - 5.5) ** 2 <= 1.4);
    },
    ORB(a) {
      a.circle(C.lblue, 12, 12, 10);
      a.erase((x, y) => (x - 8.5) ** 2 + (y - 8) ** 2 <= 9.5 && (x - 8.5) ** 2 + (y - 8) ** 2 >= 4.2); // a gloss ring
      a.circle(C.white, 8.6, 8.2, 1.6);
    },
    RING(a) {
      a.ellipse(C.purple, 12, 12, 11, 4.2); // the ring behind
      a.circle(C.lred, 12, 12, 6.2);
      a.erase((x, y) => ((x - 12) / 11) ** 2 + ((y - 12) / 4.2) ** 2 <= 1 && ((x - 12) / 9.6) ** 2 + ((y - 12) / 2.9) ** 2 >= 1 && y > 12);
    },
    BLANK(a) {
      a.fill(C.blue, (x, y) => (Math.abs(x - 12) + Math.abs(y - 12) < 2.2) || (Math.abs(x - 12) < 0.6 && Math.abs(y - 12) < 4.5) || (Math.abs(y - 12) < 0.6 && Math.abs(x - 12) < 4.5));
    },
    WILD(a) {
      for (const [x0, y0, x1, y1] of [[2.5, 4, 7.4, 20], [7.4, 20, 12, 9.5], [12, 9.5, 16.6, 20], [16.6, 20, 21.5, 4]]) a.line(C.lgreen, x0, y0, x1, y1, 3.4);
      a.poly(C.yellow, star(19.5, 4.5, 2.8, 1.1));
    },
    SCAT(a) {
      // a cut gem: the outline of a diamond, a gap, and a smaller diamond inside it
      const gem = (k) => [[12, 12 - 10.5 * k], [12 + 10 * k, 12 - 2 * k], [12, 12 + 10.5 * k], [12 - 10 * k, 12 - 2 * k]];
      a.poly(C.red, gem(1));
      a.erasePoly(gem(0.78));
      a.poly(C.red, gem(0.58));
      a.erase((x, y) => Math.abs(y - 10) < 0.5 && x > 8 && x < 16); // a facet glint
    },
  },
  overrides: {
    pet: {
      STAR: ['..##..', '######', '.####.', '.#..#.', '#....#', '......'],
      MOON: ['.###..', '##....', '##....', '##....', '.###..', '......'],
      SUN: ['#.##.#', '.####.', '######', '.####.', '#.##.#', '......'],
      COMET: ['....##', '...###', '..##..', '.##...', '##....', '......'],
      ORB: ['.####.', '######', '######', '######', '.####.', '......'],
      RING: ['......', '..##..', '######', '.####.', '..##..', '......'],
      BLANK: ['......', '......', '..##..', '..##..', '......', '......'],
      WILD: ['#....#', '#....#', '#.##.#', '#.##.#', '.#..#.', '......'],
      SCAT: ['.####.', '######', '.####.', '..##..', '......', '......'],
    },
  },
  frame: frameCells({ metal: 'cyan', divider: 'purple', arrow: 'yellow', panel: 'blue' }),
};
