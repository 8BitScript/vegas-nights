// The longest chain of screenshots whose reel positions only ever move down the strip: how the
// on-screen tests tell a reel that is really scrolling from a few unrelated pictures.

export /** The longest chain of captures whose candidate positions only ever move down the strip. */
function bestChain(shots, positions, perFrame) {
  const nodes = [];
  for (const shot of shots) {
    for (const p of shot.cands) {
      let best = { frame: shot.frame, p, len: 1, prev: null };
      for (const n of nodes) {
        if (n.frame >= shot.frame) continue;
        const limit = perFrame * (shot.frame - n.frame);
        if (((n.p - p + positions) % positions) <= limit && n.len + 1 > best.len) best = { frame: shot.frame, p, len: n.len + 1, prev: n };
      }
      nodes.push(best);
    }
  }
  let top = null;
  for (const n of nodes) if (top === null || n.len > top.len || (n.len === top.len && n.frame > top.frame)) top = n;
  const chain = [];
  for (let n = top; n; n = n.prev) chain.unshift({ frame: n.frame, p: n.p });
  return chain;
}
