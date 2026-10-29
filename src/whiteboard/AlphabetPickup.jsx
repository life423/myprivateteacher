import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Hand from './Hand.jsx';

// Local pickup feedback: no shared tile exists until the tutor releases over the paper.
// A portal keeps the fist visible when the pointer leaves the alphabet or the board.
export default function AlphabetPickup({ pickup }) {
  if (!pickup) return null;
  const left = Math.max(8, Math.min(window.innerWidth - 160, pickup.x - 80));
  const top = Math.max(8, Math.min(window.innerHeight - 180, pickup.y - 48));
  return createPortal(
    <div data-alphabet-pickup data-letter={pickup.text} data-drop-ready={pickup.onBoard ? 'true' : 'false'}
      className='pointer-events-none fixed z-[80] flex w-40 flex-col items-center' style={{ left, top }}>
      <svg viewBox='-60 -56 120 184' width='76' height='116' aria-hidden='true'>
        <rect x='-29' y='-51' width='58' height='69' rx='12' fill='white' stroke='#7c3aed' strokeWidth='4' />
        <text x='0' y='-16' textAnchor='middle' dominantBaseline='central' fill='#1e293b' fontSize='42' fontWeight='800'>{pickup.text}</text>
        <Hand x={0} y={-24} pose='grab' />
      </svg>
      <span role='status' className='rounded-lg border border-blue-200 bg-white px-2 py-1 text-center text-xs font-semibold leading-4 text-blue-900 shadow-sm'>
        {pickup.onBoard ? `Release to place ${pickup.text}` : `${pickup.text} grabbed · drag onto the board`}
      </span>
    </div>, document.body,
  );
}

// A second touch cancels pickup even when it lands in the other alphabet/board surface.
// Mark that same native event so it cannot immediately start ink or another pickup.
const cancelledTouches = new WeakSet();
export const isPickupCancellation = event => cancelledTouches.has(event.nativeEvent || event);

export function usePickupCancellation(pointerId, cancel) {
  const live = useRef(null);
  live.current = { pointerId, cancel };
  useEffect(() => {
    const cancelCurrent = () => { if (live.current.pointerId != null) live.current.cancel(); };
    const escape = event => {
      if (event.key === 'Escape' && live.current.pointerId != null) {
        event.preventDefault();
        cancelCurrent();
      }
    };
    const anotherTouch = event => {
      if (event.pointerType !== 'touch' || live.current.pointerId == null || event.pointerId === live.current.pointerId) return;
      cancelledTouches.add(event);
      event.preventDefault();
      cancelCurrent();
    };
    const hidden = () => { if (document.hidden) cancelCurrent(); };
    // Capture before menus or selection handlers can rerender and replace their listeners.
    document.addEventListener('keydown', escape, true);
    document.addEventListener('pointerdown', anotherTouch, { capture: true, passive: false });
    window.addEventListener('blur', cancelCurrent);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('pointerdown', anotherTouch, true);
      window.removeEventListener('blur', cancelCurrent);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
}
