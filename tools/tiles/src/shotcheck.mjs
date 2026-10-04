// Compare a headless screenshot with an expected screen, exactly. No palette is
// assumed: ink must sit on exactly the expected pixels, paper must stay the
// screenshot's background colour, and every colour index must be drawn in one RGB
// (and no two indexes in the same one). `geometry` says where the text grid sits
// in the image: { left, top, sx } — the pixel offset of cell (0,0) and how many
// image pixels one machine pixel is across (the VIC-20's are doubled).

export function compare(png, expected, geometry) {
  const { left, top, sx = 1, sy = 1 } = geometry;
  const rgbAt = (x, y) => {
    const o = (y * png.width + x) * 4;
    return png.rgba[o] * 65536 + png.rgba[o + 1] * 256 + png.rgba[o + 2];
  };
  const paper = rgbAt(0, 0);
  const mapping = new Map(); // colour index -> rgb
  let wrongInk = 0, wrongPaper = 0, inconsistent = 0, inkSeen = 0;
  for (let y = 0; y < expected.h; y += 1) {
    for (let x = 0; x < expected.w; x += 1) {
      const e = expected.px[y * expected.w + x];
      // every image pixel this machine pixel covers must agree
      let seen = null, agree = true;
      for (let j = 0; j < sy; j += 1) for (let i = 0; i < sx; i += 1) {
        const px = left + x * sx + i, py = top + y * sy + j;
        if (px >= png.width || py >= png.height) { agree = false; continue; }
        const v = rgbAt(px, py);
        if (seen === null) seen = v; else if (seen !== v) agree = false;
      }
      if (seen === null || !agree) { if (e >= 0) wrongInk += 1; else wrongPaper += 1; continue; }
      if (e < 0) { if (seen !== paper) wrongPaper += 1; continue; }
      inkSeen += 1;
      if (seen === paper) { wrongInk += 1; continue; }
      if (!mapping.has(e)) mapping.set(e, seen); else if (mapping.get(e) !== seen) inconsistent += 1;
    }
  }
  const rgbs = [...mapping.values()];
  const collisions = rgbs.length - new Set(rgbs).size;
  return { wrongInk, wrongPaper, inconsistent, collisions, inkSeen, colours: mapping.size, mapping };
}

/** Try every offset in a window and return the best: used once to derive a machine's geometry. */
export function findOffset(png, expected, { sx = 1, sy = 1, range = 80 } = {}) {
  let best = null;
  for (let top = 0; top < range; top += 1) {
    for (let left = 0; left < range; left += 1) {
      const r = compare(png, expected, { left, top, sx, sy });
      const score = r.wrongInk + r.wrongPaper;
      if (!best || score < best.score) best = { left, top, score, r };
    }
  }
  return best;
}
