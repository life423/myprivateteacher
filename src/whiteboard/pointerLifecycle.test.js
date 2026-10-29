import { describe, expect, it, vi } from 'vitest';
import { createPointerLifecycle, pictureDragPosition } from './pointerLifecycle.js';

function fixture() {
  const move = vi.fn(), finish = vi.fn();
  const element = { contains: target => target === element, setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
  const lifecycle = createPointerLifecycle({ move, finish });
  const down = (pointerId = 1, pointerType = 'mouse') => ({ pointerId, pointerType, currentTarget: element });
  return { lifecycle, move, finish, element, down };
}

describe('pointer lifecycle across board and browser boundaries', () => {
  it('uses window movement and release if capture fails, with one final callback', () => {
    const { lifecycle, element, down, move, finish } = fixture();
    element.setPointerCapture.mockImplementation(() => { throw new Error('Capture unavailable'); });
    lifecycle.start(down()); lifecycle.capture(down());
    const outside = { pointerId: 1, buttons: 1, clientX: 400, clientY: 300, target: {} };
    lifecycle.move(outside);
    expect(move).toHaveBeenCalledExactlyOnceWith(outside);
    lifecycle.end({ ...outside, type: 'pointerup' });
    lifecycle.end({ ...outside, type: 'pointerup' }); // native fallback and React bubbling
    lifecycle.cancel(1, 'capture-lost'); // implicit capture loss following release
    expect(finish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pointerId: 1, type: 'pointerup', clientX: 400, clientY: 300 }));
  });

  it('leaves inside-surface movement to React rather than dispatching it twice', () => {
    const { lifecycle, element, down, move } = fixture();
    lifecycle.start(down()); lifecycle.move({ pointerId: 1, buttons: 1, target: element });
    expect(move).not.toHaveBeenCalled();
  });

  it('ends a lost mouse release before hover can move or erase anything', () => {
    const { lifecycle, down, move, finish, element } = fixture();
    lifecycle.start(down());
    lifecycle.move({ pointerId: 1, buttons: 0, target: element, clientX: 900, clientY: 700 });
    lifecycle.move({ pointerId: 1, buttons: 0, target: {} });
    expect(move).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'pointercancel', reason: 'buttons-lost' }));
  });

  it('cancels all fingers idempotently for blur, authority loss, or effect cleanup', () => {
    const { lifecycle, down, finish } = fixture();
    lifecycle.start(down(2, 'touch')); lifecycle.start(down(3, 'touch'));
    lifecycle.cancelAll('blur'); lifecycle.cancelAll('unmount');
    expect(finish.mock.calls.map(([event]) => [event.pointerId, event.reason])).toEqual([[2, 'blur'], [3, 'blur']]);
    lifecycle.start(down()); lifecycle.cancelAll('authority');
    expect(finish.mock.calls.at(-1)[0]).toMatchObject({ pointerId: 1, type: 'pointercancel', reason: 'authority' });
  });

  it('removes tracking before releasing capture, so reentrant loss cannot finalize twice', () => {
    const { lifecycle, element, down, finish } = fixture();
    element.releasePointerCapture.mockImplementation(pointerId => lifecycle.cancel(pointerId, 'capture-lost'));
    lifecycle.start(down()); lifecycle.end({ pointerId: 1, type: 'pointerup' });
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('does not mistake touch button state for a lost mouse release', () => {
    const { lifecycle, down, move, finish } = fixture();
    lifecycle.start(down(2, 'touch'));
    lifecycle.move({ pointerId: 2, buttons: 0, target: {} });
    expect(move).toHaveBeenCalledTimes(1); expect(finish).not.toHaveBeenCalled();
  });
});

describe('picture release positions', () => {
  it('samples a final move point that was never delivered as pointermove', () => {
    const drag = { mode: 'move', x: 200, y: 300, w: 200, h: 100, dx: -40, dy: -25 };
    expect(pictureDragPosition(drag, { x: 800, y: 600 })).toEqual({ x: 760, y: 575 });
    expect(pictureDragPosition(drag, { x: 2000, y: 2000 })).toEqual({ x: 1376, y: 876 });
  });

  it('samples final corner and edge resizing while preserving the crop ratio and anchors', () => {
    const drag = { mode: 'resize', crop: { w: 400, h: 200 }, ax: 100, ay: 200, hx: 1, hy: 1 };
    expect(pictureDragPosition(drag, { x: 500, y: 400 })).toEqual({ x: 100, y: 200, w: 400 });
    expect(pictureDragPosition({ ...drag, hx: -1, hy: 0, ax: 800, ay: 400 }, { x: 400, y: 400 })).toEqual({ x: 400, y: 300, w: 400 });
  });
});
