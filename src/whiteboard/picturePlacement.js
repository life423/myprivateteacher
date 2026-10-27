import { clampPiece, pieceSize, startingWidth } from '../../shared/pieces.js';

// Library cards with one useful cut-out (for example, a mouth photo) place that
// cut-out immediately. Worksheets and pictures without a single region stay whole.
export function defaultPictureCrop(picture) {
  if (!picture || !(picture.w > 0) || !(picture.h > 0)) return null;
  const region = picture.regions?.length === 1 ? picture.regions[0] : null;
  if (region && region.w > 0 && region.h > 0) {
    return { x: region.x, y: region.y, w: region.w, h: region.h, r: region.r || 0 };
  }
  return { x: 0, y: 0, w: picture.w, h: picture.h, r: 0 };
}

// Start near the part of the board the tutor can see. Repeated copies step aside
// a little so they do not disappear exactly underneath one another.
export function picturePlacement(picture, centre = { x: 800, y: 580 }, copy = 0) {
  const crop = defaultPictureCrop(picture);
  if (!picture?.id || !crop) return null;
  const size = pieceSize(crop, startingWidth(crop));
  const offset = (copy % 5) * 24;
  const at = clampPiece(size, centre.x - size.w / 2 + offset, centre.y - size.h / 2 + offset);
  if (!at) return null;
  return { pic: picture.id, crop, ...at, w: size.w };
}
