import { describe, expect, it } from 'vitest';
import { objectToolbarPosition } from './objectToolbarPosition.js';
const layout = { left: 0, top: 0, scale: 1 };
const viewport = { width: 400, height: 500 };
const toolbar = { width: 240, height: 52 };
describe('contextual board controls', () => {
  it('anchors above the selection, and clamps both horizontal edges', () => {
    expect(objectToolbarPosition({ x: 100, y: 200, w: 100, h: 100 }, layout, viewport, toolbar)).toEqual({ left: 30, top: 138 });
    expect(objectToolbarPosition({ x: -200, y: 200, w: 20, h: 100 }, layout, viewport, toolbar).left).toBe(8);
    expect(objectToolbarPosition({ x: 390, y: 200, w: 100, h: 100 }, layout, viewport, toolbar).left).toBe(152);
  });
  it('stays inside the visible writing area near top and bottom', () => {
    const at = objectToolbarPosition({ x: 100, y: 0, w: 100, h: 60 }, layout, viewport, toolbar, { topInset: 100 });
    expect(at.top).toBeGreaterThanOrEqual(100);
    expect(at.top + toolbar.height).toBeLessThanOrEqual(492);
  });
  it('accounts for zoom/pan and avoids the Layers button', () => {
    const at = objectToolbarPosition({ x: 100, y: 200, w: 100, h: 100 }, { left: -50, top: -100, scale: 2 }, viewport, toolbar, { reserved: [{ x: 8, y: 230, w: 150, h: 44 }] });
    expect(at.top).toBe(282);
  });
});
