import { describe, expect, it } from 'vitest';
import { pictureOverlapState, rectangleIntersection, rectangleUnionArea } from './pictureGeometry.js';

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
