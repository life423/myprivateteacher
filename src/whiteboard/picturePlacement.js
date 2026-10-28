import { cleanCrop, clampPiece, pieceSize, startingWidth } from '../../shared/pieces.js';
import { WORK } from '../../shared/tiles.js';
import { BOARD } from './stage.js';
import { rectangleIntersection, rectangleUnionArea, validRectangle } from './pictureGeometry.js';

const GAP = 12;
const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const work = { x: WORK.left, y: WORK.top, w: WORK.right - WORK.left, h: WORK.bottom - WORK.top };
const defaultBounds = { x: BOARD.x, y: BOARD.y, w: BOARD.width, h: BOARD.height };

// Reserve sent-but-unacknowledged additions during the same frame or network round trip.
// A denied/disconnected send must not leave invisible obstacles forever. Server snapshots
// clear the queue, and stale reservations expire before another placement is computed.
export const PICTURE_RESERVATION_MS = 10000;
export function picturePlacementObstacles(confirmed, pending, now = Date.now()) {
  const existing = new Map(confirmed.map((piece) => [piece.id, piece]));
  for (const [id, reservation] of pending) {
    if (existing.has(id) || reservation.expiresAt <= now) pending.delete(id);
    else existing.set(id, reservation.piece);
  }
  return [...existing.values()];
}

// Add picture always adds the complete teaching card. Crops require an explicit
// Magic Select or drawn selection, so instructions and diagrams are never lost.
export function defaultPictureCrop(picture) {
  return picture && picture.w > 0 && picture.h > 0
    ? { x: 0, y: 0, w: picture.w, h: picture.h, r: 0 }
    : null;
}

export function picturePlacementBounds(bounds) {
  return rectangleIntersection(validRectangle(bounds) ? bounds : defaultBounds, work) || defaultBounds;
}

// Every free rectangle has a closest point whose x/y is the desired point, a
// board edge, or an obstacle edge. Testing those finite combinations finds a free
// position without a coarse grid missing narrow gaps. MAX_PIECES is40.
export function findPicturePlacement(size, centre, { pieces = [], bounds } = {}) {
  if (!size || !Number.isFinite(size.w) || !Number.isFinite(size.h) || size.w <= 0 || size.h <= 0) return null;
  const area = picturePlacementBounds(bounds);
  const cx = Number.isFinite(centre?.x) ? centre.x : area.x + area.w / 2;
  const cy = Number.isFinite(centre?.y) ? centre.y : area.y + area.h / 2;
  const obstacles = [...pieces].filter(validRectangle);
  const fits = size.w <= area.w + 0.001 && size.h <= area.h + 0.001;
  if (!fits) {
    const at = clampPiece(size, cx - size.w / 2, cy - size.h / 2);
    if (!at) return null;
    const overlaps = obstacles.filter((piece) => rectangleIntersection({ ...at, ...size }, piece)).length;
    return { ...at, overlaps, crowded: Boolean(overlaps), visible: false };
  }
  const maxX = area.x + area.w - size.w;
  const maxY = area.y + area.h - size.h;
  const target = { x: clamp(cx - size.w / 2, area.x, maxX), y: clamp(cy - size.h / 2, area.y, maxY) };
  const coordinates = (axis, span, gap) => {
    const low = axis === 'x' ? area.x : area.y;
    const high = axis === 'x' ? maxX : maxY;
    return [...new Set([target[axis], low, high, ...obstacles.flatMap((piece) => [piece[axis] - size[span] - gap, piece[axis] + piece[span] + gap])]
      .filter((value) => value >= low - 0.001 && value <= high + 0.001).map((value) => round1(clamp(value, low, high))))];
  };
  let fallback = null;
  for (const gap of [GAP, 0]) {
    let best = null;
    for (const x of coordinates('x', 'w', gap)) for (const y of coordinates('y', 'h', gap)) {
      const candidate = { x, y, ...size };
      const distance = (x - target.x) ** 2 + (y - target.y) ** 2;
      const intersections = obstacles.map((piece) => rectangleIntersection(candidate, piece)).filter(Boolean);
      if (!intersections.length) {
        const padded = gap ? { x: x - gap, y: y - gap, w: size.w + gap * 2, h: size.h + gap * 2 } : candidate;
        if (gap && obstacles.some((piece) => rectangleIntersection(padded, piece))) continue;
        if (!best || distance < best.distance) best = { x, y, distance };
      } else if (!gap) {
        const covered = rectangleUnionArea(intersections);
        if (!fallback || covered < fallback.covered - 0.001 || (Math.abs(covered - fallback.covered) < 0.001 && distance < fallback.distance)) {
          fallback = { x, y, overlaps: intersections.length, covered, distance };
        }
      }
    }
    if (best) return { x: best.x, y: best.y, overlaps: 0, crowded: false, visible: true };
  }
  return fallback ? { x: fallback.x, y: fallback.y, overlaps: fallback.overlaps, crowded: true, visible: true } : null;
}

export function picturePlacement(picture, centre, { pieces = [], bounds, crop: chosenCrop } = {}) {
  const crop = cleanCrop(chosenCrop || defaultPictureCrop(picture), picture);
  if (!picture?.id || !crop) return null;
  const area = picturePlacementBounds(bounds);
  const width = Math.min(startingWidth(crop), area.w, area.h * crop.w / crop.h);
  const size = pieceSize(crop, width);
  const placed = findPicturePlacement(size, centre, { pieces, bounds: area });
  if (!placed) return null;
  const { x, y, overlaps, crowded, visible } = placed;
  return { pic: picture.id, crop, x, y, w: size.w, placement: { overlaps, crowded, visible } };
}
