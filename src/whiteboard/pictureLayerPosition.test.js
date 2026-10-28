import { describe, expect, it } from 'vitest';
import { frame } from './viewport.js';
import { BOARD, STRIP } from './stage.js';
import { pictureLayersTop } from './pictureLayerPosition.js';

describe('floating picture layers position', () => {
  it('keeps the control below every internal alphabet letter at desktop and compact fitted sizes', () => {
    for (const [width, height, align] of [[1600, 1000], [1440, 900], [852, 240], [393, 600, 'end']]) {
      const layout = frame(width, height, null, align);
      const alphabetBottom = layout.top + (STRIP.y + STRIP.height) * layout.scale;
      const paperTop = layout.top + BOARD.y * layout.scale;
      const top = pictureLayersTop(layout);
      expect(top).toBeGreaterThan(alphabetBottom);
      expect(top).toBeGreaterThanOrEqual(paperTop + 8);
      expect(top + 44).toBeLessThan(height);
    }
  });

  it('follows zoom and pan while the paper moves behind the floating control', () => {
    for (const cy of [220, 400, 600]) {
      const layout = frame(1000, 650, { scale: 1.2, cx: 800, cy });
      const alphabetBottom = layout.top + (STRIP.y + STRIP.height) * layout.scale;
      expect(pictureLayersTop(layout)).toBeGreaterThan(alphabetBottom);
      expect(pictureLayersTop(layout)).toBe(Math.max(8, layout.top + BOARD.y * layout.scale + 8));
    }
  });

  it('clears the compact landscape Tools trigger while preserving alphabet clearance', () => {
    const layout = frame(852, 240, null);
    expect(pictureLayersTop(layout, { externalAlphabet: true, floatingTools: true })).toBe(68);
    expect(pictureLayersTop(layout, { strip: false, floatingTools: true })).toBe(68);
    expect(pictureLayersTop(layout, { floatingTools: true })).toBeGreaterThanOrEqual(68);
  });

  it('does not add space when the alphabet is hidden or lives in the mobile bar', () => {
    const layout = frame(393, 600, null);
    expect(pictureLayersTop(layout, { strip: false })).toBe(8);
    expect(pictureLayersTop(layout, { externalAlphabet: true })).toBe(8);
    expect(pictureLayersTop({ scale: 0, top: 0 })).toBe(8);
  });
});
