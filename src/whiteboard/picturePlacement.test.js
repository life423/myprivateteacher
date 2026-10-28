import { describe, expect, it } from 'vitest';
import { WORK } from '../../shared/tiles.js';
import { defaultPictureCrop, findPicturePlacement, picturePlacement, picturePlacementObstacles, PICTURE_RESERVATION_MS } from './picturePlacement.js';
import { rectangleIntersection } from './pictureGeometry.js';

describe('direct picture placement', () => {
  const bounds = { x: 100, y: 200, w: 900, h: 600 };
  const centre = { x: 550, y: 500 };

  it('adds the complete teaching card, even when it has one mouth region', () => {
    const picture = { id: 'card', w: 1200, h: 1200, regions: [{ x: 48, y: 300, w: 744, h: 852, r: 36 }] };
    expect(defaultPictureCrop(picture)).toEqual({ x: 0, y: 0, w: 1200, h: 1200, r: 0 });
    expect(picturePlacement(picture, centre).crop).toEqual(defaultPictureCrop(picture));
    expect(picturePlacement(picture, centre, { crop: picture.regions[0] }).crop).toEqual(picture.regions[0]);
  });

  it('centres the first picture and preserves proportions across wide and tall crops', () => {
    for (const [w, h] of [[600, 300], [300, 600], [100, 800], [800, 100]]) {
      const placed = picturePlacement({ id: 'photo', w, h }, centre, { bounds });
      expect(placed.x + placed.w / 2).toBeCloseTo(centre.x, 0);
      expect(placed.y + placed.w * h / w / 2).toBeCloseTo(centre.y, 0);
      expect(placed.placement.crowded).toBe(false);
    }
  });

  it('uses every different picture and pending rapid addition as an obstacle', () => {
    const pieces = [];
    for (let i = 0; i < 8; i++) {
      const picture = { id: `photo-${i}`, w: i % 2 ? 300 : 600, h: i % 2 ? 600 : 300 };
      const placed = picturePlacement(picture, centre, { pieces, bounds });
      const piece = { ...placed, h: placed.w * picture.h / picture.w };
      expect(pieces.every((existing) => !rectangleIntersection(piece, existing))).toBe(true);
      expect(piece.x).toBeGreaterThanOrEqual(bounds.x);
      expect(piece.y).toBeGreaterThanOrEqual(bounds.y);
      expect(piece.x + piece.w).toBeLessThanOrEqual(bounds.x + bounds.w + 0.1);
      expect(piece.y + piece.h).toBeLessThanOrEqual(bounds.y + bounds.h + 0.1);
      pieces.push(piece);
    }
  });

  it('finds the nearest free obstacle edge and does not miss a narrow exact gap', () => {
    const placed = findPicturePlacement({ w: 100, h: 100 }, { x: 300, y: 400 }, { bounds: { x: 100, y: 200, w: 400, h: 400 }, pieces: [{ x: 250, y: 350, w: 100, h: 100 }] });
    expect(Math.hypot(placed.x - 250, placed.y - 350)).toBe(112);
    const exact = findPicturePlacement({ w: 100, h: 100 }, centre, { bounds: { x: 100, y: 200, w: 300, h: 100 }, pieces: [{ x: 100, y: 200, w: 100, h: 100 }, { x: 300, y: 200, w: 100, h: 100 }] });
    expect(exact).toEqual({ x: 200, y: 200, overlaps: 0, crowded: false, visible: true });
  });

  it('keeps pictures in the visible working area near board edges', () => {
    const placed = picturePlacement({ id: 'photo', w: 600, h: 300 }, { x: 9999, y: 9999 }, { bounds: { x: 1400, y: 850, w: 500, h: 500 } });
    expect(placed.x + placed.w).toBeLessThanOrEqual(WORK.right + 0.1);
    expect(placed.y + placed.w / 2).toBeLessThanOrEqual(WORK.bottom + 0.1);
    expect(placed.x).toBeGreaterThanOrEqual(1400);
    expect(placed.y).toBeGreaterThanOrEqual(850);
  });

  it('reports unavoidable overlap honestly on a saturated board instead of placing offscreen', () => {
    const full = { x: 100, y: 200, w: 200, h: 200 };
    const placed = findPicturePlacement({ w: 100, h: 100 }, centre, { bounds: full, pieces: [full] });
    expect(placed.crowded).toBe(true);
    expect(placed.overlaps).toBe(1);
    expect(placed.visible).toBe(true);
    expect(placed.x).toBeGreaterThanOrEqual(full.x);
    expect(placed.y).toBeGreaterThanOrEqual(full.y);
    expect(placed.x + 100).toBeLessThanOrEqual(full.x + full.w);
    expect(placed.y + 100).toBeLessThanOrEqual(full.y + full.h);
  });

  it('reports when the unchanged size of a duplicate cannot fit a zoomed viewport', () => {
    const placed = findPicturePlacement({ w: 220, h: 220 }, { x: 500, y: 500 }, { bounds: { x: 450, y: 450, w: 100, h: 100 } });
    expect(placed.visible).toBe(false);
    expect(placed.x + 110).toBe(500);
    expect(placed.y + 110).toBe(500);
  });
});


describe('pending picture placement reservations', () => {
  const piece = { id: 'sent', x: 100, y: 200, w: 220, h: 220 };

  it('avoids sent-but-unacknowledged pieces and replaces them with server geometry on acknowledgement', () => {
    const pending = new Map([['sent', { piece, expiresAt: 1000 + PICTURE_RESERVATION_MS }]]);
    const obstacles = picturePlacementObstacles([], pending, 1000);
    const next = findPicturePlacement({ w: 220, h: 220 }, { x: 210, y: 310 }, { pieces: obstacles });
    expect(rectangleIntersection(piece, { ...next, w: 220, h: 220 })).toBeNull();
    const confirmed = { ...piece, x: 150 };
    expect(picturePlacementObstacles([confirmed], pending, 1001)).toEqual([confirmed]);
    expect(pending.size).toBe(0);
  });

  it('releases denied or disconnected additions rather than leaving invisible obstacles forever', () => {
    const pending = new Map([['sent', { piece, expiresAt: 1000 + PICTURE_RESERVATION_MS }]]);
    expect(picturePlacementObstacles([], pending, 1000 + PICTURE_RESERVATION_MS)).toEqual([]);
    expect(pending.size).toBe(0);
    const next = findPicturePlacement({ w: 220, h: 220 }, { x: 210, y: 310 });
    expect(next.x).toBe(100);
    expect(next.y).toBe(200);
  });
});
