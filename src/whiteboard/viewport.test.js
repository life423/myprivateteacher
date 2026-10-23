import { describe, expect, it } from 'vitest';
import { fillView, frame, viewAt, viewBoxOf } from './viewport.js';

describe('the whiteboard viewport', () => {
  it('fits the whole board in the middle by default', () => {
    expect(frame(800, 800, null)).toMatchObject({ scale: 0.5, width: 800, height: 500, left: 0, top: 150 });
    expect(viewBoxOf(frame(1600, 1000, null), 1600, 1000)).toBe('0 0 1600 1000');
  });

  it('can sit the board at the bottom of a taller box, leaving the room on top', () => {
    expect(frame(700, 675, null, 'end')).toMatchObject({ width: 700, height: 437.5, left: 0, top: 675 - 437.5 });
  });

  it('fills an upright phone from the left edge of the board', () => {
    const f = frame(393, 700, fillView(393, 700));
    expect(f).toMatchObject({ scale: 0.7, height: 700, top: 0, left: 0, width: 1120 });
  });

  it('can start below the alphabet strip, for phones that show it in their own bar', () => {
    const f = frame(393, 600, fillView(393, 600, 168));
    expect(f.scale).toBeCloseTo(600 / 832);
    expect(f.top).toBeCloseTo(-168 * f.scale);
    expect(f.left).toBe(0);
  });

  it('keeps the spot between the fingers under the fingers', () => {
    const f = frame(393, 700, viewAt(393, 700, 1.2, 800, 500, 200, 300));
    expect(f.left + 800 * 1.2).toBeCloseTo(200);
    expect(f.top + 500 * 1.2).toBeCloseTo(300);
  });

  it('never pans past the edge of the board', () => {
    const f = frame(393, 700, { scale: 1, cx: -500, cy: 5000 });
    expect(f.left).toBe(0);
    expect(f.top).toBe(700 - 1000);
  });

  it('never zooms out past the whole board, or in past four times filling the screen', () => {
    const tiny = frame(393, 700, { scale: 0.01, cx: 800, cy: 500 });
    expect(tiny.scale).toBe(tiny.fit);
    const huge = frame(393, 700, { scale: 99, cx: 800, cy: 500 });
    expect(huge.scale).toBeCloseTo(0.7 * 4);
  });
});

describe('a phone with its own alphabet bar', () => {
  it('never shows the board strip, at any zoom, pan or fit', () => {
    const fit = frame(393, 600, null, 'center', 168);
    expect(-fit.top / fit.scale).toBeCloseTo(168, 5); // the fit view starts just below the strip, at the top
    const panned = frame(393, 600, { scale: 1.2, cx: 300, cy: 0 }, 'center', 168); // asked to look at the very top
    expect(-panned.top / panned.scale).toBeCloseTo(168, 5);
    const normal = frame(393, 600, { scale: 1.2, cx: 300, cy: 0 }); // without a bar the strip can show
    expect(Math.abs(normal.top)).toBe(0); // the very top (0 or -0)
  });
});
