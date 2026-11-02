import { describe, expect, it } from 'vitest';
import { nativePieceHit, nativePieceNudge, pieceCenteredResize, pieceCornerResize, pieceResizeHandle, pieceSelectionOutline, pictureOverlapState, rectangleIntersection, rectangleUnionArea } from './pictureGeometry.js';

describe('native spelling mark interaction', () => {
  const mark = { id: 'breve', x: 100, y: 200, w: 40, h: 17.5, content: { kind: 'breve' } };
  it('keeps six screen pixels of clearance and a minimum 44px frame without enlarging the ink', () => {
    for (const piece of [mark, { ...mark, w: 180, h: 220, content: undefined }, { ...mark, content: { kind: 'text', text: 'mat' } }]) for (const scale of [0.4, 1, 3]) {
      const outline = pieceSelectionOutline(piece, scale);
      expect((piece.x - outline.x) * scale).toBeGreaterThanOrEqual(6 - 0.001);
      expect((piece.y - outline.y) * scale).toBeGreaterThanOrEqual(6 - 0.001);
      expect(outline.w * scale).toBeGreaterThanOrEqual(44 - 0.001);
      expect(outline.h * scale).toBeGreaterThanOrEqual(44 - 0.001);
      expect(outline.x + outline.w / 2).toBeCloseTo(piece.x + piece.w / 2);
      expect(outline.y + outline.h / 2).toBeCloseTo(piece.y + piece.h / 2);
    }
  });
  it('supports precise keyboard placement and keeps marks inside the board', () => {
    expect(nativePieceNudge(mark, 'ArrowRight')).toEqual({ x: 102, y: 200 });
    expect(nativePieceNudge(mark, 'ArrowUp', true)).toEqual({ x: 100, y: 190 });
    expect(nativePieceNudge({ ...mark, x: 24 }, 'ArrowLeft', true)).toEqual({ x: 24, y: 200 });
    expect(nativePieceNudge(mark, 'Tab')).toBeNull();
  });
  it('keeps a small breve usable with touch at the current zoom without enlarging its visible ink', () => {
    expect(nativePieceHit(mark, { x: 120, y: 180 }, 0.5, 'touch')).toBe(true);
    expect(nativePieceHit(mark, { x: 120, y: 180 }, 1, 'mouse')).toBe(false);
    expect(nativePieceHit(mark, { x: 30, y: 200 }, 0.5, 'touch')).toBe(false);
    expect(nativePieceHit({ ...mark, content: undefined }, { x: 120, y: 205 }, 1, 'mouse')).toBe(false);
  });
  it('does not label transparent teaching text or a spelling mark as an opaque covering photograph', () => {
    const states = pictureOverlapState([
      { id: 'picture', x: 90, y: 190, w: 100, h: 100, z: 1 },
      { ...mark, z: 2 },
      { id: 'word', x: 90, y: 190, w: 100, h: 100, z: 3, content: { kind: 'text', text: 'mat' } },
    ]);
    for (const state of states.values()) expect(state).toEqual({ above: [], below: [], coverage: 0, covered: false });
  });
});

describe('continuous proportional resizing', () => {
  const photo = { id: 'photo', x: 300, y: 300, w: 200, h: 100, crop: { x: 0, y: 0, w: 400, h: 200 } };
  it('keeps the opposite corner still in all four directions', () => {
    for (const corner of ['se', 'sw', 'ne', 'nw']) {
      const sx = corner.includes('w') ? -1 : 1, sy = corner.includes('n') ? -1 : 1;
      const resized = pieceCornerResize(photo, { x: 1, y: 2 }, { x: 1 + sx * 60, y: 2 + sy * 30 }, corner);
      expect(resized.w).toBe(260); expect(resized.h).toBe(130);
      expect(sx > 0 ? resized.x : resized.x + resized.w).toBe(sx > 0 ? photo.x : photo.x + photo.w);
      expect(sy > 0 ? resized.y : resized.y + resized.h).toBe(sy > 0 ? photo.y : photo.y + photo.h);
    }
  });
  it('preserves native ratios, min size and working-area edges without camera inputs', () => {
    const mark = { ...photo, w: 40, h: 17.5, content: { kind: 'breve' } };
    const smaller = pieceCornerResize(mark, { x: 0, y: 0 }, { x: -300, y: -300 });
    expect(smaller).toEqual({ x: 300, y: 300, w: 24, h: 10.5 });
    const bigger = pieceCornerResize(photo, { x: 0, y: 0 }, { x: 5000, y: 5000 });
    expect(bigger).toEqual({ x: 300, y: 300, w: 1276, h: 638 });
    expect(pieceCenteredResize(mark, 80)).toEqual({ x: 280, y: 291.3, w: 80, h: 35 });
  });
  it('keeps a 44px corner target outside tiny mark ink at fit and close zooms', () => {
    const mark = { ...photo, w: 24, h: 10.5, content: { kind: 'breve' } };
    for (const scale of [0.4, 1, 3]) {
      const handle = pieceResizeHandle(mark, { left: 0, top: 0, scale }, { width: 2000, height: 1500 });
      expect(handle.corner).toBe('se');
      expect(handle.left).toBeGreaterThan((mark.x + mark.w) * scale);
      expect(handle.top).toBeGreaterThan((mark.y + mark.h) * scale);
      expect(handle.left + 44).toBeLessThan(2000);
    }
    const edge = pieceResizeHandle({ ...mark, x: 400, y: 400 }, { left: 0, top: 0, scale: 1 }, { width: 450, height: 450 });
    expect(edge.corner).toBe('nw'); expect(edge.left).toBeGreaterThanOrEqual(4); expect(edge.top).toBeGreaterThanOrEqual(4);
  });
});

describe('picture frame overlap', () => {
  it('does not count touching edges or invalid pictures as overlaps', () => {
    expect(rectangleIntersection({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBeNull();
    expect(rectangleIntersection({ x: NaN, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toBeNull();
  });

  it('finds a fully covered lower picture using several higher pictures', () => {
    const states = pictureOverlapState([
      { id: 'hidden', x: 0, y: 0, w: 100, h: 100, z: 1 },
      { id: 'left', x: 0, y: 0, w: 60, h: 100, z: 2 },
      { id: 'right', x: 40, y: 0, w: 60, h: 100, z: 3 },
    ]);
    expect(states.get('hidden')).toEqual({ above: ['left', 'right'], below: [], coverage: 1, covered: true });
    expect(states.get('left').coverage).toBeCloseTo(1 / 3);
    expect(states.get('right').below).toEqual(['hidden', 'left']);
  });

  it('never sums overlapping covers twice or reports a tiny exposed strip as hidden', () => {
    expect(rectangleUnionArea([{ x: 0, y: 0, w: 60, h: 100 }, { x: 40, y: 0, w: 50, h: 100 }])).toBe(9000);
    const states = pictureOverlapState([
      { id: 'lower', x: 0, y: 0, w: 100, h: 100, z: 1 },
      { id: 'upper', x: 0, y: 0, w: 99.9, h: 100, z: 2 },
    ]);
    expect(states.get('lower').covered).toBe(false);
    expect(states.get('lower').coverage).toBeCloseTo(0.999);
  });

  it('matches stable SVG paint order for equal z values and changes after Front/Back', () => {
    const a = { id: 'a', x: 0, y: 0, w: 100, h: 100, z: 1 };
    const b = { ...a, id: 'b' };
    expect(pictureOverlapState([a, b]).get('a').covered).toBe(true);
    expect(pictureOverlapState([{ ...a, z: 3 }, b]).get('b').covered).toBe(true);
  });
});
