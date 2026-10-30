import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { TUTOR_GUIDE_WIDTH, canDockTutorGuide } from './guideLayout.js';

// A single mounted guide docks in the tutor's reserved desktop column and
// overlays smaller screens. It never locks the page or discards private drafts.
export default function TutorGuide({ open, onClose, returnFocusRef, children, actions, id = 'tutor-guide' }) {
  const [docked, setDocked] = useState(() => canDockTutorGuide(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const resize = () => setDocked(canDockTutorGuide(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const surface = useRef(null), closeButton = useRef(null), previousFocus = useRef(null);
  const latest = useRef({ onClose, returnFocusRef });
  latest.current = { onClose, returnFocusRef };
  const close = () => {
    latest.current.onClose();
    const target = latest.current.returnFocusRef?.current || previousFocus.current;
    if (target?.isConnected && !surface.current?.contains(target)) target.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open) return undefined;
    previousFocus.current = document.activeElement;
    const frame = requestAnimationFrame(() => closeButton.current?.focus({ preventScroll: true }));
    const escape = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // A separate dialog (for example a picture cropper) owns its own Escape.
      if (event.target.closest?.('[role="dialog"], [aria-modal="true"]') && !surface.current?.contains(event.target)) return;
      event.preventDefault(); close();
    };
    document.addEventListener('keydown', escape);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <aside
    ref={surface}
    id={id}
    aria-label='Tutor guide'
    aria-hidden={!open || undefined}
    inert={!open ? '' : undefined}
    data-tutor-guide
    data-state={open ? 'open' : 'closed'}
    data-docked={docked || undefined}
    style={{ '--tutor-guide-width': TUTOR_GUIDE_WIDTH }}
    className={`fixed ${docked ? 'bottom-4 right-4 top-20 w-[var(--tutor-guide-width)]' : 'bottom-2 right-2 top-2 w-[min(600px,calc(100vw-1rem))] sm:bottom-3 sm:right-3 sm:top-3'} z-40 flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-[transform,opacity,visibility] duration-[180ms] ease-out motion-reduce:transition-none ${open ? 'visible translate-x-0 opacity-100' : 'invisible translate-x-[calc(100%+1rem)] opacity-0 pointer-events-none'}`}
  >
    <header className='flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-violet-50/70 px-4 py-2'>
      <h2 className='text-base font-bold text-slate-900'>Tutor guide</h2>
      <div className='flex shrink-0 items-center gap-2'>{actions}<button ref={closeButton} type='button' aria-label='Close tutor guide' onClick={close} className='inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 motion-reduce:transition-none'><X className='h-5 w-5' aria-hidden='true' /><span>Close</span></button></div>
    </header>
    <div className='min-h-0 flex-1'>{children}</div>
  </aside>;
}
