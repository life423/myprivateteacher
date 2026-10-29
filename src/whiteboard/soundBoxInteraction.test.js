import { describe, expect, it } from 'vitest';
import { soundBoxes } from '../../shared/tiles.js';
import { soundBoxAt, soundBoxButtonRect, soundTapCanFinish } from './soundBoxInteraction.js';

const box = soundBoxes(3)[0];
const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
const tap = { index: 0, count: 3, epoch: 2, x: 100, y: 100 };
const event = { type: 'pointerup', clientX: 100, clientY: 100 };
const state = { canTap: true, tool: 'none', count: 3, epoch: 2, pinching: false, point, scale: 1 };

describe('sound box interaction geometry', () => {
  it('uses current shared geometry and nearest target at narrow scales', () => {
    expect(soundBoxAt(point, 3)?.index).toBe(0);
    const next = soundBoxes(3)[1];
    expect(soundBoxAt({ x: next.x + 1, y: point.y }, 3, .1)?.index).toBe(1);
    expect(soundBoxAt({ x: point.x, y: box.y - 20 }, 3, .2)?.index).toBe(0);
    expect(soundBoxAt(point, 0)).toBeNull();
    expect(soundBoxAt(null, 3)).toBeNull();
  });
  it('keeps keyboard focus targets at least44px and follows zoom/pan', () => {
    const rect = soundBoxButtonRect(box, { left: -120, top: 15, scale: .2 });
    expect(rect.w).toBe(44); expect(rect.h).toBe(44);
    expect(rect.x + rect.w / 2).toBeCloseTo(-120 + point.x * .2);
    expect(rect.y + rect.h / 2).toBeCloseTo(15 + point.y * .2);
  });
});
describe('a deliberate sound-box tap', () => {
  it('only completes within the movement threshold and same target', () => {
    expect(soundTapCanFinish(tap, event, state)).toBe(true);
    expect(soundTapCanFinish(tap, { ...event, clientX: 107 }, state)).toBe(false);
    expect(soundTapCanFinish(tap, event, { ...state, point: { x: 800, y: 580 } })).toBe(false);
  });
  it.each([{ count: 4 }, { epoch: 3 }, { canTap: false }, { tool: 'pen' }, { tool: 'eraser' }, { pinching: true }])('cancels when configuration, tools, or gesture changes: %o', (change) => {
    expect(soundTapCanFinish(tap, event, { ...state, ...change })).toBe(false);
  });
  it('never counts a cancelled pointer or synthetic pinch-ending event', () => {
    expect(soundTapCanFinish(tap, { ...event, type: 'pointercancel' }, state)).toBe(false);
    expect(soundTapCanFinish(tap, { pointerId: 1 }, state)).toBe(false);
  });
});
