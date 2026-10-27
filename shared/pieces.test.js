import { describe, expect, it } from 'vitest';
import { WORK } from './tiles.js';
import { cleanCrop, clampPiece, isPictureId, pieceSize, startingWidth } from './pieces.js';

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
