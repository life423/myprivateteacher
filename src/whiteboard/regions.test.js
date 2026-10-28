import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { findRegions, mergePictureRegions, regionAt } from './regions.js';

// The first real worksheet: the Lip Biter card, in a small copy (the browser analyses up to 400px).
const card = jpeg.decode(readFileSync(new URL('./fixtures/lip-biter-240.jpg', import.meta.url)), { useTArray: true });
const regions = findRegions({ width: card.width, height: card.height, data: card.data });
const near = (actual, expected, slack = 3) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(slack);

function blank(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}
function paint(image, x, y, w, h, [r, g, b]) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = (yy * image.width + xx) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
    }
  }
  return image;
}

describe('Magic Select on the Lip Biter card', () => {
  const photo = regionAt(regions, 81, 138); // tapping the teeth

  it('selects the whole mouth photo, wherever it is tapped', () => {
    expect(photo.kind).toBe('picture');
    near(photo.x, 8);
    near(photo.y, 61);
    near(photo.w, 159);
    near(photo.h, 172);
    for (const [x, y] of [[60, 78], [72, 216], [13, 66]]) expect(regionAt(regions, x, y)).toBe(photo); // nose, chin, corner
  });

  it('keeps the title, the drawing and the instructions out of it', () => {
    const title = regionAt(regions, 120, 30);
    const drawing = regionAt(regions, 204, 138);
    const words = regionAt(regions, 198, 78);
    expect(title.kind).toBe('picture');
    expect(drawing.kind).toBe('picture');
    expect(words.kind).toBe('text');
    for (const other of [title, drawing, words]) expect(other).not.toBe(photo);
    expect(photo.x + photo.w).toBeLessThan(drawing.x);
    expect(photo.y).toBeGreaterThan(title.y + title.h);
  });

  it('copies the photo with its rounded corners', () => {
    expect(photo.radius).toBeGreaterThan(5);
  });

  it('ignores the dark frame around the screenshot', () => {
    expect(regions.some((r) => r.w > card.width * 0.95 && r.h > card.height * 0.95)).toBe(false);
  });
});

describe('Magic Select regions', () => {
  it('keeps two pictures apart when they do not touch', () => {
    const image = blank(200, 120);
    paint(image, 20, 30, 60, 60, [40, 90, 160]);
    paint(image, 83, 30, 60, 60, [160, 60, 40]); // 3px of paper between them
    expect(findRegions(image).filter((r) => r.kind === 'picture')).toHaveLength(2);
  });

  it('treats pictures that touch as one', () => {
    const image = blank(200, 120);
    paint(image, 20, 30, 60, 60, [40, 90, 160]);
    paint(image, 80, 30, 60, 60, [160, 60, 40]);
    expect(findRegions(image).filter((r) => r.kind === 'picture')).toHaveLength(1);
  });

  it('finds nothing to pick on a blank page', () => {
    expect(findRegions(blank(120, 90))).toEqual([]);
  });
});


describe('curated photo regions alongside automatic tutor selection', () => {
  const photo = { id: 'mouth', label: 'Mouth', x: 8, y: 61, w: 159, h: 172, r: 9 };
  const combined = mergePictureRegions(regions, [photo]);

  it('keeps every other real card part available while using the exact photo crop', () => {
    expect(regionAt(combined, 81, 138)).toEqual({ ...photo, kind: 'picture' });
    for (const [x, y] of [[120, 30], [204, 138], [198, 78], [199, 208]]) {
      const selected = regionAt(combined, x, y);
      expect(selected).toBeTruthy();
      expect(selected).toBe(regionAt(regions, x, y));
      expect(selected.id).not.toBe('mouth');
    }
  });

  it('removes photo fragments and enclosing frames so they cannot shadow the curated crop', () => {
    const title = { x: 0, y: 0, w: 120, h: 20, kind: 'text' };
    const fragment = { x: 20, y: 80, w: 50, h: 50, kind: 'picture' };
    const frame = { x: 0, y: 0, w: 240, h: 240, kind: 'picture' };
    expect(mergePictureRegions([title, fragment, frame], [photo])).toEqual([title, { ...photo, kind: 'picture' }]);
  });

  it('does not discard adjacent non-photo regions or change uncurated worksheet detection', () => {
    const adjacent = { x: 167, y: 61, w: 60, h: 100, kind: 'picture' };
    expect(mergePictureRegions([adjacent], [photo])[0]).toBe(adjacent);
    expect(mergePictureRegions(regions)).toEqual(regions);
    expect(mergePictureRegions(regions, [{ x: NaN, y: 0, w: 50, h: 50 }])).toEqual(regions);
  });
});
