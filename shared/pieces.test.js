import { describe, expect, it } from 'vitest';
import { WORK } from './tiles.js';
import { cleanCrop, cleanPieceContent, clampPiece, isFacePiece, isPictureId, nativePieceMetrics, pieceSize, startingWidth } from './pieces.js';

const pic = { w: 976, h: 974 };

describe('picture pieces', () => {
  it('only accepts crops inside the picture', () => {
    expect(cleanCrop({ x: 32, y: 246, w: 646, h: 698, r: 41 }, pic)).toEqual({ x: 32, y: 246, w: 646, h: 698, r: 41 });
    expect(cleanCrop({ x: 500, y: 0, w: 600, h: 100 }, pic)).toBeNull();
    expect(cleanCrop({ x: 0, y: 0, w: 4, h: 100 }, pic)).toBeNull();
    expect(cleanCrop({ x: 0, y: 0, w: 100, h: 60, r: 999 }, pic).r).toBe(30);
    expect(cleanCrop({ x: 'a', y: 0, w: 100, h: 60 }, pic)).toBeNull();
    expect(cleanCrop({ x: 0, y: 0, w: 100, h: 60 }, undefined)).toBeNull();
  });

  it('keeps a piece in its shape and within limits when resized', () => {
    const crop = { x: 0, y: 0, w: 200, h: 100 };
    expect(pieceSize(crop, 300)).toEqual({ w: 300, h: 150 });
    expect(pieceSize(crop, 10).h).toBe(48); // never tinier than the minimum
    expect(pieceSize(crop, 99999).w).toBeLessThanOrEqual(WORK.right - WORK.left);
    expect(pieceSize({ x: 0, y: 0, w: 100, h: 400 }, 99999).h).toBeLessThanOrEqual(WORK.bottom - WORK.top);
  });

  it('keeps pieces on the board', () => {
    const size = { w: 300, h: 200 };
    expect(clampPiece(size, -50, 5000)).toEqual({ x: WORK.left, y: WORK.bottom - 200 });
    expect(clampPiece(size, NaN, 0)).toBeNull();
  });

  it('starts new pieces at a comfortable size', () => {
    const w = startingWidth({ w: 646, h: 698 });
    expect(Math.round((w * 698) / 646)).toBe(220);
    expect(startingWidth({ w: 2400, h: 1200 })).toBe(220);
    expect(startingWidth({ w: 100, h: 100 })).toBe(120);
  });

  it('only accepts random picture ids', () => {
    expect(isPictureId('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isPictureId('../../etc/passwd')).toBe(false);
    expect(isPictureId('0123456789ABCDEF0123456789ABCDEF')).toBe(false);
  });
});

describe('native teaching pieces', () => {
  const crop = { x: 200, y: 300, w: 275, h: 146 };
  it('accepts bounded plain teaching text and marks without accepting markup or arbitrary object fields', () => {
    expect(cleanPieceContent({ kind: 'text', text: '  ma\u0306t  ', font: 'untrusted', answer: 'private' })).toEqual({ kind: 'text', text: 'măt' });
    expect(cleanPieceContent({ kind: 'breve', text: 'ignored' })).toEqual({ kind: 'breve' });
    for (const value of [{ kind: 'text', text: '<script>' }, { kind: 'text', text: 'a\nb' }, { kind: 'text', text: 'a'.repeat(129) }, { kind: 'text', text: '' }, { kind: 'html', text: 'a' }, null]) expect(cleanPieceContent(value)).toBeNull();
  });
  it('gives identical native text geometry regardless of source crop font or proportions', () => {
    const content = { kind: 'text', text: 'măt' };
    const metrics = nativePieceMetrics(content);
    expect(pieceSize(crop, metrics.w, content)).toEqual(metrics);
    expect(pieceSize({ w: 1000, h: 900 }, metrics.w, content)).toEqual(metrics);
    expect(pieceSize(crop, metrics.w / 2, content).h).toBe(48);
  });
  it('allows a native breve to fit over a letter without altering photo size limits', () => {
    const content = { kind: 'breve' };
    expect(pieceSize(crop, undefined, content)).toEqual({ w: 64, h: 28 });
    expect(pieceSize(crop, 24, content)).toEqual({ w: 24, h: 10.5 });
    expect(pieceSize(crop, 0, content)).toEqual({ w: 24, h: 10.5 });
    expect(pieceSize(crop, 24).h).toBe(48);
    expect(pieceSize(crop, 99999, content).w).toBeLessThanOrEqual(WORK.right - WORK.left);
  });
});


describe('library face identification', () => {
  const mouth = { id: 'mouth', x: 48, y: 300, w: 744, h: 852, r: 36 };
  const picture = { id: 'photo', library: 'card-id', w: 1200, h: 1200, regions: [mouth] };

  it('recognizes direct faces, copies and face subcrops independently of display size or rounding', () => {
    expect(isFacePiece({ crop: mouth, w: 220 }, picture)).toBe(true);
    expect(isFacePiece({ id: 'duplicate', crop: { ...mouth, r: 0 }, w: 600 }, picture)).toBe(true);
    expect(isFacePiece({ crop: { x: 90, y: 400, w: 120, h: 90, r: 4 } }, picture)).toBe(true);
  });

  it('does not treat uploads, complete cards, titles or diagrams as faces', () => {
    expect(isFacePiece({ crop: mouth }, { ...picture, library: undefined })).toBe(false);
    expect(isFacePiece({ crop: mouth }, { ...picture, regions: [{ ...mouth, id: 'diagram' }] })).toBe(false);
    for (const crop of [
      { x: 0, y: 0, w: 1200, h: 1200 },
      { x: 30, y: 30, w: 1140, h: 230 },
      { x: 845, y: 548, w: 320, h: 320 },
      { x: 0, y: 300, w: 792, h: 852 },
    ]) expect(isFacePiece({ crop }, picture)).toBe(false);
  });

  it('requires valid source bounds and trusted mouth metadata', () => {
    expect(isFacePiece({ crop: mouth }, undefined)).toBe(false);
    expect(isFacePiece({ crop: { x: NaN, y: 300, w: 744, h: 852 } }, picture)).toBe(false);
    expect(isFacePiece({ crop: mouth }, { ...picture, regions: [{ ...mouth, w: 2000 }] })).toBe(false);
  });
});
