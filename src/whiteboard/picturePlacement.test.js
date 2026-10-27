import { describe, expect, it } from 'vitest';
import { WORK } from '../../shared/tiles.js';
import { defaultPictureCrop, picturePlacement } from './picturePlacement.js';

describe('direct picture placement', () => {
  it('puts the useful region of a library card on the board without its surrounding labels', () => {
    const mouth = { id: 'mouth', x: 20, y: 60, w: 200, h: 180, r: 12 };
    expect(defaultPictureCrop({ w: 300, h: 400, regions: [mouth] })).toEqual({ x: 20, y: 60, w: 200, h: 180, r: 12 });
  });

  it('keeps uploads and multi-part worksheets whole until the tutor chooses a part', () => {
    const whole = { x: 0, y: 0, w: 300, h: 400, r: 0 };
    expect(defaultPictureCrop({ w: 300, h: 400 })).toEqual(whole);
    expect(defaultPictureCrop({ w: 300, h: 400, regions: [{ w: 30, h: 30 }, { w: 30, h: 30 }] })).toEqual(whole);
    expect(defaultPictureCrop({ w: 0, h: 400 })).toBeNull();
  });

  it('centres on the visible board while keeping the original proportions', () => {
    const placed = picturePlacement({ id: 'photo', w: 600, h: 300 }, { x: 500, y: 400 });
    expect(placed.x + placed.w / 2).toBe(500);
    expect(placed.y + placed.w / 4).toBe(400);
  });

  it('offsets copies and keeps them inside the working area even near an edge', () => {
    const photo = { id: 'photo', w: 600, h: 300 };
    const first = picturePlacement(photo);
    const second = picturePlacement(photo, undefined, 1);
    expect(second.x - first.x).toBe(24);
    expect(second.y - first.y).toBe(24);
    const edge = picturePlacement(photo, { x: 9999, y: 9999 }, 4);
    expect(edge.x + edge.w).toBeLessThanOrEqual(WORK.right);
    expect(edge.y + edge.w / 2).toBeLessThanOrEqual(WORK.bottom);
  });
});
