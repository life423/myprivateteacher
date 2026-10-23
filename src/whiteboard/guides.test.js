import { describe, expect, it } from 'vitest';
import { guideRows } from './guides.js';
import { BOARD, OPEN_BOARD } from './stage.js';

const inside = (rect, rows) => rows.every((r) => r.top > rect.y + 40 && r.base < rect.y + rect.height - 40);

describe('handwriting lines', () => {
  it('fits 2, 3 or 4 rows by size, under the alphabet strip', () => {
    expect(guideRows(BOARD, 'big')).toHaveLength(2);
    expect(guideRows(BOARD, 'medium')).toHaveLength(3);
    expect(guideRows(BOARD, 'small')).toHaveLength(4);
    for (const size of ['big', 'medium', 'small']) expect(inside(BOARD, guideRows(BOARD, size))).toBe(true);
  });

  it('uses the taller open board when the strip is off', () => {
    expect(guideRows(OPEN_BOARD, 'small')).toHaveLength(5);
    expect(inside(OPEN_BOARD, guideRows(OPEN_BOARD, 'small'))).toBe(true);
  });

  it('keeps paper proportions: midline halfway, a half-height skip space between rows', () => {
    const [a, b] = guideRows(BOARD, 'medium');
    expect(a.mid - a.top).toBe(a.base - a.mid);
    expect(b.top - a.base).toBe((a.base - a.top) / 2);
  });

  it('draws nothing when off', () => {
    expect(guideRows(BOARD, 'off')).toEqual([]);
  });
});
