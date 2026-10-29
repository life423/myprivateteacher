import { useEffect, useRef } from 'react';
import { clampPiece, pieceSize } from '../../shared/pieces.js';

// The same termination path serves captured input and the window fallback. Remove a
// pointer before calling its owner: releasePointerCapture can synchronously report loss.
export function createPointerLifecycle({ move, finish }) {
  const active = new Map();
  const end = (event, reason = event.type === 'pointerup' ? 'up' : 'cancel') => {
    const pointer = active.get(event.pointerId);
    if (!pointer) return false;
    active.delete(event.pointerId);
    finish({ pointerId: event.pointerId, pointerType: pointer.pointerType,
      type: reason === 'up' ? 'pointerup' : 'pointercancel', clientX: event.clientX, clientY: event.clientY, reason });
    try { if (pointer.element?.hasPointerCapture?.(event.pointerId)) pointer.element.releasePointerCapture(event.pointerId); } catch {}
    return true;
  };
  return {
    start(event) {
      if (active.has(event.pointerId)) end(event, 'restart');
      active.set(event.pointerId, { element: event.currentTarget, pointerType: event.pointerType });
    },
    capture(event) {
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Window listeners carry the gesture instead. */ }
    },
    end,
    cancel(pointerId, reason = 'cancel') { return end({ pointerId }, reason); },
    cancelAll(reason = 'cancel') { for (const pointerId of [...active.keys()]) end({ pointerId }, reason); },
    move(event) {
      const pointer = active.get(event.pointerId);
      if (!pointer) return;
      if (pointer.pointerType === 'mouse' && event.buttons === 0) { end(event, 'buttons-lost'); return; }
      // Events inside the original surface continue through its React handler exactly once.
      if (!pointer.element?.contains?.(event.target)) move(event);
    },
  };
}

export function usePointerLifecycle(onMove, onFinish) {
  const live = useRef(null);
  live.current = { onMove, onFinish };
  const controller = useRef(null);
  if (!controller.current) controller.current = createPointerLifecycle({
    move: event => live.current.onMove(event), finish: event => live.current.onFinish(event),
  });
  useEffect(() => {
    const pointers = controller.current;
    const up = event => pointers.end(event);
    const move = event => pointers.move(event);
    const blur = () => pointers.cancelAll('blur');
    const hidden = () => { if (document.hidden) pointers.cancelAll('hidden'); };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
      pointers.cancelAll('unmount');
    };
  }, []);
  return controller.current;
}

// Reuse the pointer-move calculation at release, including a final resize sample.
export function pictureDragPosition(drag, point) {
  if (drag.mode === 'move') return clampPiece({ w: drag.w, h: drag.h }, point.x + drag.dx, point.y + drag.dy);
  const ratio = drag.crop.h / drag.crop.w;
  const dx = Math.abs(point.x - drag.ax), dy = Math.abs(point.y - drag.ay) / ratio;
  const size = pieceSize(drag.crop, drag.hx && drag.hy ? Math.max(dx, dy) : drag.hx ? dx : dy);
  const x = drag.hx === 1 ? drag.ax : drag.hx === -1 ? drag.ax - size.w : drag.ax - size.w / 2;
  const y = drag.hy === 1 ? drag.ay : drag.hy === -1 ? drag.ay - size.h : drag.ay - size.h / 2;
  return { ...clampPiece(size, x, y), w: size.w };
}
