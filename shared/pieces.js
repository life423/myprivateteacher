// Picture pieces on the whiteboard, shared by the browser and the server.
//
// A picture is an image the tutor added for this session only: the server keeps it in
// memory and forgets it when the room closes. A piece is a window onto a picture (the
// crop, in the picture's own pixels, with its corner rounding) placed on the board. Magic
// Select makes pieces; the picture itself is never changed, so it can be copied again.
import { WORK } from './tiles.js';

export const MAX_PICTURES = 8; // per room
export const MAX_PIECES = 40; // per room
export const MAX_OFFERS = 20; // parts the tutor has given the student, per room
export const MAX_PICTURE_BYTES = 1_500_000; // after the browser shrinks it, usually far less
export const MAX_PICTURE_SIDE = 4096;
export const PIECE_MIN = 48; // the short side of a piece never gets smaller than this

// Only deliberately selected, known teaching content becomes native board ink.
// Source/crop authorization is still required; this is never an OCR result.
export function cleanPieceContent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.kind === 'breve') return { kind: 'breve' };
  if (value.kind !== 'text' || typeof value.text !== 'string' || value.text.length > 256) return null;
  const text = value.text.normalize('NFC').trim();
  if (!text || text.length > 128 || !/^[A-Za-zĀāĂăĒēĔĕĪīĬĭŌōŎŏŪūŬŭ .,!?;:'’"()\-]+$/.test(text)) return null;
  return { kind: 'text', text };
}

// A common 64px teaching face, independent of each source image's typography.
// These generous advances leave room for the inherited font and its accents.
export function nativePieceMetrics(value) {
  const content = cleanPieceContent(value);
  if (!content) return null;
  if (content.kind === 'breve') return { w: 64, h: 28 };
  const advance = character => {
    if (character === ' ') return 20;
    if ('ilI.,!;:\'’'.includes(character)) return 20;
    if ('tfjr()'.includes(character)) return 28;
    if ('mwMW'.includes(character)) return 64;
    return 42;
  };
  return { w: 16 + [...content.text].reduce((width, character) => width + advance(character), 0), h: 96 };
}

const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// Pictures get random 128-bit ids, so a picture's address can't be guessed.
export const isPictureId = (value) =>
  typeof value === 'string' && value.length === 32 && [...value].every((c) => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'));

// A crop inside the picture, in whole pixels, at least 8 x 8. Rounding can't exceed half the short side.
export function cleanCrop(crop, pic) {
  if (!crop || !pic) return null;
  const [x, y, w, h] = [crop.x, crop.y, crop.w, crop.h].map((n) => (Number.isFinite(n) ? Math.round(n) : NaN));
  if ([x, y, w, h].some(Number.isNaN)) return null;
  if (x < 0 || y < 0 || w < 8 || h < 8 || x + w > pic.w || y + h > pic.h) return null;
  const r = Number.isFinite(crop.r) ? clamp(Math.round(crop.r), 0, Math.floor(Math.min(w, h) / 2)) : 0;
  return { x, y, w, h, r };
}

// A face is a crop inside a library card's trusted mouth-photo region. Display
// size and corner rounding do not identify the content, so neither can be used
// to turn a face into a resizable piece. Uploads and other card parts stay separate.
export function isFacePiece(piece, picture) {
  if (typeof picture?.library !== 'string' || !picture.library || !Array.isArray(picture.regions)) return false;
  const crop = cleanCrop(piece?.crop, picture);
  if (!crop) return false;
  return picture.regions.some((region) => {
    if (region?.id !== 'mouth') return false;
    const face = cleanCrop(region, picture);
    return Boolean(face && crop.x >= face.x && crop.y >= face.y &&
      crop.x + crop.w <= face.x + face.w && crop.y + crop.h <= face.y + face.h);
  });
}

// A piece keeps its crop's shape: the width is chosen and the height follows. It stays
// between PIECE_MIN on its short side and the size of the working area.
export function pieceSize(crop, width, value) {
  const content = cleanPieceContent(value);
  const native = nativePieceMetrics(content);
  const ratio = native ? native.h / native.w : crop.h / crop.w;
  const maxW = Math.min(WORK.right - WORK.left, (WORK.bottom - WORK.top) / ratio);
  // A floating spelling mark must fit above a letter. Its touch target is a
  // separate interaction concern, not an opaque 48px-tall photo rectangle.
  const minW = Math.min(maxW, content?.kind === 'breve' ? 24 : Math.max(PIECE_MIN, PIECE_MIN / ratio));
  const w = clamp(Number.isFinite(width) ? width : native?.w ?? 320, minW, maxW);
  return { w: round1(w), h: round1(w * ratio) };
}

// Keeps a piece of the given size inside the working area.
export function clampPiece(size, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: round1(clamp(x, WORK.left, WORK.right - size.w)),
    y: round1(clamp(y, WORK.top, WORK.bottom - size.h)),
  };
}

// How big a new piece starts: about 60% of its size in the picture, long side 120 to 220 so several pictures fit beside the lesson work.
export function startingWidth(crop) {
  const long = clamp(Math.max(crop.w, crop.h) * 0.6, 120, 220);
  return crop.w >= crop.h ? long : (long * crop.w) / crop.h;
}
