// Classic: a neon-on-black fruit machine. Every symbol is drawn on a 24x24
// design grid (y down) and rendered at 48x48 for the PNG masters. Colours are
// the C64 palette so the art means the same thing on every machine; the VIC-20
// maps them to its nearest of eight.
//
// A cell holds ONE ink colour (8x8 pixels), so detail is carried by shape and by
// black gaps (erase) rather than by a second colour inside a cell.
import { frameCells } from '../frame-kit.mjs';

const C = {
  white: '#ffffff', red: '#883932', lred: '#b86962', cyan: '#67b6bd', purple: '#8b3f96', green: '#55a049',
  lgreen: '#94e089', blue: '#40318d', lblue: '#7869c4', yellow: '#bfce72', orange: '#8b5429', grey: '#787878', lgrey: '#9f9f9f',
};

// 3x5 letters for the word BAR cut into the single bar.
const LETTER = { B: ['11.', '1.1', '11.', '1.1', '11.'], A: ['.1.', '1.1', '111', '1.1', '1.1'], R: ['11.', '1.1', '11.', '1.1', '1.1'] };
function word(a, text, x0, y0, color, erase) {
  [...text].forEach((ch, k) => LETTER[ch].forEach((row, j) => [...row].forEach((v, i) => {
    if (v === '1') { const x = x0 + k * 4 + i, y = y0 + j; if (erase) a.erase((px, py) => px >= x && px < x + 1 && py >= y && py < y + 1); else a.rect(color, x, y, x + 1, y + 1); }
  })));
}

function bar(a, y0, y1, color, shine = true) {
  a.rrect(color, 2, y0, 22, y1, 1.6);
  if (shine) a.erase((x, y) => y >= y0 + 1 && y < y0 + 2 && x >= 4 && x < 20); // a black glint along the top edge
}

export default {
  size: 48,
  design: 24,
  colors: C,
  symbols: {
    SEVEN(a) {
      a.rrect(C.yellow, 2.5, 2, 21.5, 9, 1.4); // the bar of the 7, lit yellow
      a.poly(C.red, [[21.5, 7], [14.6, 7], [5.2, 22.5], [12.2, 22.5]]); // the stem, red
      a.erase((x, y) => y >= 4 && y < 5 && x >= 5 && x < 19.5); // glint on the bar
      a.erase((x, y) => y >= 11 && y < 20 && Math.abs((x - 12.6) + (y - 11) * 0.62) < 0.55); // glint on the stem
    },
    BAR3(a) {
      bar(a, 2.5, 8.5, C.purple, false);
      bar(a, 9, 15, C.purple, false);
      bar(a, 15.5, 21.5, C.purple, false);
      for (const y of [4.2, 10.7, 17.2]) a.erase((x, yy) => yy >= y && yy < y + 1 && x >= 4 && x < 20);
    },
    BAR2(a) {
      bar(a, 3, 11, C.green);
      bar(a, 13, 21, C.green);
    },
    BAR1(a) {
      bar(a, 6, 17, C.cyan, false);
      word(a, 'BAR', 7, 9, null, true);
    },
    CHERRY(a) {
      a.line(C.green, 12.6, 3.5, 7.5, 15, 1.5);
      a.line(C.green, 12.6, 3.5, 16.5, 14.5, 1.5);
      a.ellipse(C.green, 16, 4.6, 4, 1.8); // the leaf
      a.circle(C.red, 7.5, 17.4, 4.9);
      a.circle(C.red, 16.5, 17, 4.9);
      a.erase((x, y) => (x - 5.9) ** 2 + (y - 15.4) ** 2 <= 1.3);
      a.erase((x, y) => (x - 14.9) ** 2 + (y - 15) ** 2 <= 1.3);
    },
    BLANK(a) {
      // a faint four-point sparkle, so a reel of mostly blanks still reads as a reel
      a.fill(C.blue, (x, y) => (Math.abs(x - 12) + Math.abs(y - 12) < 2.6) || (Math.abs(x - 12) < 0.7 && Math.abs(y - 12) < 5) || (Math.abs(y - 12) < 0.7 && Math.abs(x - 12) < 5));
    },
  },
  // hand-tuned art at the PET's resolution: 6x6 pseudo-pixels (a quadrant glyph is a pseudo-pixel pair)
  overrides: {
    // Hand-drawn on the quadrant machines' 12x12 pseudo-pixel grid (6x6 cells of 2x2 blocks): the master's
    // word BAR and its fine detail resample to a smudge there, so the three BAR symbols are told apart by how
    // many bars they have, and the 7 and the cherries are set pixel by pixel.
    quad6: {
      SEVEN: ['............', '.##########.', '.##########.', '.##########.', '.........##.', '........##..', '.......##...', '......##....', '......##....', '.....##.....', '.....##.....', '............'],
      BAR3: ['............', '.##########.', '.##########.', '............', '............', '.##########.', '.##########.', '............', '............', '.##########.', '.##########.', '............'],
      BAR2: ['............', '............', '.##########.', '.##########.', '.##########.', '............', '............', '.##########.', '.##########.', '.##########.', '............', '............'],
      BAR1: ['............', '............', '............', '............', '.##########.', '.##########.', '.##########.', '.##########.', '............', '............', '............', '............'],
      CHERRY: ['........##..', '.......#.##.', '......#...#.', '.....#....#.', '....#.....#.', '.####...####', '######.#####', '######.#####', '######.#####', '.####...####', '............', '............'],
      BLANK: ['............', '............', '............', '............', '.....##.....', '....####....', '....####....', '.....##.....', '............', '............', '............', '............'],
    },
    pet: {
      SEVEN: ['######', '.....#', '....##', '...##.', '..##..', '..#...'],
      BAR3: ['######', '......', '######', '......', '######', '......'],
      BAR2: ['######', '######', '......', '######', '######', '......'],
      BAR1: ['......', '......', '######', '######', '......', '......'],
      CHERRY: ['...##.', '..#.#.', '.#...#', '.#...#', '##..##', '##..##'],
      BLANK: ['......', '......', '..##..', '..##..', '......', '......'],
    },
  },
  // Drawn again on the web's own 16x16 grid (its symbols are 2x2 cells, 16x16 pixels):
  // the master's 3x5 letters resample to smudges at that size, so the word is set here
  // at one letter pixel to one real pixel. The other symbols resample well.
  variants: {
    web: {
      design: 16,
      symbols: {
        BAR1(a) {
          a.rrect(C.cyan, 1, 3, 15, 13, 1.2);
          word(a, 'BAR', 3, 5, null, true);
        },
      },
    },
  },
  // the cells every reel window is built from (assets/themes/frame-kit.mjs)
  frame: frameCells({ metal: 'yellow', divider: 'orange', arrow: 'red', panel: 'blue' }),
};
