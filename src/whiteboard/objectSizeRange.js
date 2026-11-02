import { pieceSize } from '../../shared/pieces.js';

// A logarithmic track gives a small spelling mark the same useful precision as
// a large photograph. The slider value is local UI state, never shared geometry.
export const SIZE_TRACK_MAX = 1000;

export function objectSizeRange(piece) {
  if (!piece?.crop) return null;
  const min = pieceSize(piece.crop, 0, piece.content).w;
  const max = pieceSize(piece.crop, Number.MAX_VALUE, piece.content).w;
  return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > min ? { min, max } : null;
}

export function widthToSizeTrack(width, range) {
  if (!range || !Number.isFinite(width)) return 0;
  const bounded = Math.min(range.max, Math.max(range.min, width));
  return SIZE_TRACK_MAX * Math.log(bounded / range.min) / Math.log(range.max / range.min);
}

export function sizeTrackToWidth(value, range) {
  if (!range || !Number.isFinite(value)) return null;
  const track = Math.min(SIZE_TRACK_MAX, Math.max(0, value));
  return range.min * (range.max / range.min) ** (track / SIZE_TRACK_MAX);
}
