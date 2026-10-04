// The reel window every theme is built from: a metal ring with a bevelled inside edge,
// dividers between reels, payline arrows, and a panel texture. A theme picks the colours
// (and may replace any cell by writing its own frame.json). `pet` is the quadrant pattern
// (top-left, top-right, bottom-left, bottom-right) or ROM screen code the PET prints, since
// a cell can only be a 2x2 block there.
export function frameCells({ metal, divider, arrow, panel }) {
  const grid = (f) => Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => (f(x, y) ? '#' : '.')).join(''));
  const dither = (x, y) => (x + y) % 2 === 0;
  const top = (x, y) => (y < 6 ? true : y === 6 ? dither(x, y) : false);
  const flipX = (f) => (x, y) => f(7 - x, y);
  const flipY = (f) => (x, y) => f(x, 7 - y);
  const left = (x, y) => (x < 6 ? true : x === 6 ? dither(x, y) : false);
  const corner = (x, y) => (x + y < 2 ? false : x < 6 || y < 6 ? true : (x === 6 && y >= 6) || (y === 6 && x >= 6) ? dither(x, y) : false);
  const div = (x, y) => (x >= 2 && x <= 5) || (x === 1 && y % 2 === 0) || (x === 6 && y % 2 === 1);
  return {
    cells: {
      TL: { rows: grid(corner), color: metal, pet: '1110' },
      T: { rows: grid(top), color: metal, pet: '1100' },
      TR: { rows: grid(flipX(corner)), color: metal, pet: '1101' },
      L: { rows: grid(left), color: metal, pet: '1010' },
      R: { rows: grid(flipX(left)), color: metal, pet: '0101' },
      BL: { rows: grid(flipY(corner)), color: metal, pet: '1011' },
      B: { rows: grid(flipY(top)), color: metal, pet: '0011' },
      BR: { rows: grid(flipX(flipY(corner))), color: metal, pet: '0111' },
      DIV: { rows: grid(div), color: divider, pet: '1010' },
      DIVT: { rows: grid((x, y) => top(x, y) || (y >= 6 && div(x, y))), color: metal, pet: '1110' },
      DIVB: { rows: grid((x, y) => flipY(top)(x, y) || (y < 2 && div(x, y))), color: metal, pet: '1011' },
      ARROW_L: { rows: ['..#.....', '..##....', '..###...', '..####..', '..####..', '..###...', '..##....', '..#.....'], color: arrow, pet: 160 },
      ARROW_R: { rows: ['.....#..', '....##..', '...###..', '..####..', '..####..', '...###..', '....##..', '.....#..'], color: arrow, pet: 160 },
      PANEL: { rows: ['#.#.#.#.', '.#.#.#.#', '#.#.#.#.', '.#.#.#.#', '#.#.#.#.', '.#.#.#.#', '#.#.#.#.', '.#.#.#.#'], color: panel, pet: 32 },
    },
  };
}
