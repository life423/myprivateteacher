import { describe, expect, it } from 'vitest';
import { pieceSize } from '../../shared/pieces.js';
import { objectSizeRange, SIZE_TRACK_MAX, sizeTrackToWidth, widthToSizeTrack } from './objectSizeRange.js';

describe('shared logarithmic object size track', () => {
  const crop = { x: 0, y: 0, w: 180, h: 220, r: 0 };
  const pieces = [{ crop }, { crop, content: { kind: 'breve' } }, { crop, content: { kind: 'text', text: 'mat' } }];
  it('uses the same legal geometry limits for photographs, words and tiny marks', () => {
    for (const piece of pieces) {
      const range = objectSizeRange(piece);
      expect(sizeTrackToWidth(0, range)).toBeCloseTo(pieceSize(crop, 0, piece.content).w);
      expect(sizeTrackToWidth(SIZE_TRACK_MAX, range)).toBeCloseTo(pieceSize(crop, Number.MAX_VALUE, piece.content).w);
    }
    expect(objectSizeRange(pieces[1]).min).toBe(24);
  });
  it('round-trips arbitrary intermediate sizes and clamps out-of-track input', () => {
    for (const piece of pieces) {
      const range = objectSizeRange(piece);
      for (const ratio of [0, 0.01, 0.3, 0.7, 1]) {
        const width = range.min + (range.max - range.min) * ratio;
        expect(sizeTrackToWidth(widthToSizeTrack(width, range), range)).toBeCloseTo(width);
      }
      expect(sizeTrackToWidth(-300, range)).toBeCloseTo(range.min);
      expect(sizeTrackToWidth(SIZE_TRACK_MAX + 300, range)).toBeCloseTo(range.max);
      expect(widthToSizeTrack(range.max * 2, range)).toBeCloseTo(SIZE_TRACK_MAX);
    }
  });
  it('gives small marks fine adjustment without restricting the large end of the track', () => {
    const range = objectSizeRange(pieces[1]);
    const at = widthToSizeTrack(40, range);
    expect(sizeTrackToWidth(at + 1, range) - 40).toBeGreaterThan(0);
    expect(sizeTrackToWidth(at + 1, range) - 40).toBeLessThan(0.25);
    expect(sizeTrackToWidth(500, range)).toBeCloseTo(Math.sqrt(range.min * range.max));
  });
  it('rejects unavailable or invalid source geometry', () => {
    expect(objectSizeRange(null)).toBeNull();
    expect(objectSizeRange({ crop: { w: 0, h: 0 } })).toBeNull();
    expect(sizeTrackToWidth(NaN, objectSizeRange(pieces[0]))).toBeNull();
  });
});
