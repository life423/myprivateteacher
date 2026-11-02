// Picture-frame geometry shared by automatic placement and the layer indicators.
// Image alpha cannot be inferred from a frame: 'covered' describes picture frames.
import { clampPiece, pieceSize } from '../../shared/pieces.js';
import { WORK } from '../../shared/tiles.js';
const EPSILON = 0.001;
export const validRectangle = (r) => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0;

// Selection chrome is screen-sized, independently of the teaching ink and zoom.
// A small mark gets breathing room rather than a cluster of handles over its ink.
export function pieceSelectionOutline(piece, scale = 1) {
  const zoom = Math.max(0.01, scale);
  const w = Math.max(piece.w + 12 / zoom, 44 / zoom);
  const h = Math.max(piece.h + 12 / zoom, 44 / zoom);
  return { ...piece, x: piece.x + (piece.w - w) / 2, y: piece.y + (piece.h - h) / 2, w, h };
}

// One 44px target outside the frame. Prefer bottom-right, then another visible
// corner near viewport edges. Only an oversized object needs an inset handle.
export function pieceResizeHandle(piece, layout, viewport, corner = null) {
  const frame = pieceSelectionOutline(piece, layout.scale);
  const left = layout.left + frame.x * layout.scale, top = layout.top + frame.y * layout.scale;
  const right = left + frame.w * layout.scale, bottom = top + frame.h * layout.scale;
  const candidates = [
    { corner: 'se', left: right + 2, top: bottom + 2 },
    { corner: 'sw', left: left - 46, top: bottom + 2 },
    { corner: 'ne', left: right + 2, top: top - 46 },
    { corner: 'nw', left: left - 46, top: top - 46 },
  ];
  const fits = p => p.left >= 4 && p.top >= 4 && p.left + 44 <= viewport.width - 4 && p.top + 44 <= viewport.height - 4;
  if (corner) {
    const frozen = candidates.find(p => p.corner === corner) || candidates[0];
    return { ...frozen, left: Math.max(4, Math.min(frozen.left, viewport.width - 48)), top: Math.max(4, Math.min(frozen.top, viewport.height - 48)) };
  }
  const visible = candidates.find(fits);
  if (visible) return visible;
  const preferred = candidates[0];
  return { ...preferred, left: Math.max(4, Math.min(preferred.left, viewport.width - 48)), top: Math.max(4, Math.min(preferred.top, viewport.height - 48)) };
}

// Project pointer movement onto the original aspect-ratio diagonal. Always use
// the frozen gesture origin, so repeated samples cannot compound the size.
export function pieceCornerResize(origin, start, point, corner = 'se') {
  const sx = corner.includes('w') ? -1 : 1, sy = corner.includes('n') ? -1 : 1;
  const ratio = origin.h / origin.w;
  const delta = (sx * (point.x - start.x) + sy * ratio * (point.y - start.y)) / (1 + ratio * ratio);
  const anchorX = sx > 0 ? origin.x : origin.x + origin.w;
  const anchorY = sy > 0 ? origin.y : origin.y + origin.h;
  const maximum = Math.min(sx > 0 ? WORK.right - anchorX : anchorX - WORK.left, (sy > 0 ? WORK.bottom - anchorY : anchorY - WORK.top) / ratio);
  const size = pieceSize(origin.crop, Math.min(origin.w + delta, maximum), origin.content);
  const at = clampPiece(size, sx > 0 ? anchorX : anchorX - size.w, sy > 0 ? anchorY : anchorY - size.h);
  return { ...at, ...size };
}

export function pieceCenteredResize(origin, width) {
  const size = pieceSize(origin.crop, width, origin.content);
  return { ...clampPiece(size, origin.x + (origin.w - size.w) / 2, origin.y + (origin.h - size.h) / 2), ...size };
}

// The mark stays visually small. Its pointer target remains usable independently
// of the letter beneath it, without adding a visible box to the student's work.
export function nativePieceHit(piece, point, scale = 1, pointerType = 'mouse') {
  if (!piece?.content || !validRectangle(piece)) return false;
  const target = (pointerType === 'mouse' ? 24 : 44) / Math.max(0.01, scale);
  const dx = piece.content.kind === 'breve' ? Math.max(0, target - piece.w) / 2 : 0;
  const dy = piece.content.kind === 'breve' ? Math.max(0, target - piece.h) / 2 : 0;
  return point.x >= piece.x - dx && point.x <= piece.x + piece.w + dx && point.y >= piece.y - dy && point.y <= piece.y + piece.h + dy;
}

export function nativePieceNudge(piece, key, largerStep = false) {
  if (!piece?.content || !validRectangle(piece)) return null;
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (!direction) return null;
  const step = largerStep ? 10 : 2;
  return clampPiece(piece, piece.x + direction[0] * step, piece.y + direction[1] * step);
}

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
      // Native text and marks have transparent backgrounds; their rectangular
      // bounds do not cover the material behind them like a worksheet photograph.
      if (piece.content || higher.content) continue;
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
