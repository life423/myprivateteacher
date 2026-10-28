// Picture-frame geometry shared by automatic placement and the layer indicators.
// Image alpha cannot be inferred from a frame: 'covered' describes picture frames.
const EPSILON = 0.001;
export const validRectangle = (r) => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0;

export function rectangleIntersection(a, b) {
  if (!validRectangle(a) || !validRectangle(b)) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return right - x > EPSILON && bottom - y > EPSILON ? { x, y, w: right - x, h: bottom - y } : null;
}

// Sweep vertical strips so two overlapping covers never count the same area twice.
export function rectangleUnionArea(rectangles) {
  const rects = rectangles.filter(validRectangle);
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const left = xs[i - 1];
    const right = xs[i];
    const spans = rects.filter((r) => r.x < right && r.x + r.w > left).map((r) => [r.y, r.y + r.h]).sort((a, b) => a[0] - b[0]);
    let height = 0;
    let end = -Infinity;
    for (const [top, bottom] of spans) {
      height += Math.max(0, bottom - Math.max(top, end));
      end = Math.max(end, bottom);
    }
    area += (right - left) * height;
  }
  return area;
}

export function pictureOverlapState(pieces) {
  // Stable sorting matches the SVG paint order even if a pending piece shares z.
  const ordered = pieces.filter(validRectangle).map((piece, index) => ({ piece, index }))
    .sort((a, b) => (a.piece.z || 0) - (b.piece.z || 0) || a.index - b.index).map(({ piece }) => piece);
  const states = new Map(ordered.map((piece) => [piece.id, { above: [], below: [], coverage: 0, covered: false }]));
  for (let i = 0; i < ordered.length; i++) {
    const piece = ordered[i];
    const state = states.get(piece.id);
    const covers = [];
    for (let j = i + 1; j < ordered.length; j++) {
      const higher = ordered[j];
      const overlap = rectangleIntersection(piece, higher);
      if (!overlap) continue;
      state.above.push(higher.id);
      states.get(higher.id).below.push(piece.id);
      covers.push(overlap);
    }
    state.coverage = Math.min(1, rectangleUnionArea(covers) / (piece.w * piece.h));
    state.covered = state.coverage >= 1 - EPSILON / (piece.w * piece.h);
  }
  return states;
}
