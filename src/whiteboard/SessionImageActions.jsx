import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import { lessonControlsPosition } from './lessonControlsPosition.js';

const action = 'inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-40';

// Session cleanup is a secondary action, reachable from the pinned materials
// header without putting a destructive button beside every teaching material.
export default function SessionImageActions({ count = 0, onClear, label = 'Picture options', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [placement, setPlacement] = useState(null);
  const [error, setError] = useState('');
  const trigger = useRef(null), panel = useRef(null);
  const id = useId();
  const positioned = placement !== null;
  const close = (restore = false) => {
    setOpen(false); setConfirming(false); setError('');
    if (restore) trigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => { if (!count || disabled) close(); }, [count, disabled]);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return undefined;
    const position = () => {
      const viewport = window.visualViewport;
      setPlacement(lessonControlsPosition(trigger.current.getBoundingClientRect(), {
        left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
        width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight,
      }));
    };
    position();
    const observer = new ResizeObserver(position); observer.observe(trigger.current);
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position); window.visualViewport?.addEventListener('scroll', position);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position); window.visualViewport?.removeEventListener('scroll', position);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !positioned) return;
    // Wait for the initially hidden portal to become visible. Resizing the
    // viewport must not pull focus away from the user's current action.
    panel.current?.querySelector(confirming ? '[data-cancel-images]' : 'button')?.focus({ preventScroll: true });
  }, [open, confirming, positioned]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = event => {
      if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) close();
    };
    const escape = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation(); close(true);
    };
    // On confirmation, Cancel receives focus so a repeated Enter cannot remove
    // images after the first activation merely opened the confirmation.
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, confirming]);

  if (!count || !onClear) return null;
  return <>
    <button ref={trigger} type='button' aria-label={label} title={label} aria-haspopup='dialog' aria-expanded={open} aria-controls={id} disabled={disabled}
      onClick={() => open ? close(true) : setOpen(true)}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors duration-150 motion-reduce:transition-none hover:bg-violet-50 hover:text-violet-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500 disabled:opacity-40 ${open ? 'bg-violet-50 text-violet-800' : ''}`}>
      <MoreHorizontal className='h-5 w-5' aria-hidden='true' />
    </button>
    {open && createPortal(<section ref={panel} id={id} role='dialog' aria-label={confirming ? 'Remove this page’s images?' : label} data-session-image-actions
      style={{ position: 'fixed', ...placement, visibility: placement ? 'visible' : 'hidden' }}
      className='z-[70] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl'>
      {confirming ? <>
        <h3 className='px-2 pt-1 text-sm font-bold text-slate-900'>Remove this page’s images?</h3>
        <p className='px-2 py-2 text-sm leading-relaxed text-slate-600'>This page’s session images and their board pieces will be removed. Other pages, saved lessons and the picture library stay available.</p>
        {error && <p role='alert' className='px-2 pb-2 text-sm text-rose-700'>{error}</p>}
        <div className='flex justify-end gap-2'>
          <button data-cancel-images type='button' onClick={() => close(true)} className={`${action} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Cancel</button>
          <button type='button' disabled={disabled} onClick={() => {
            if (onClear() === false) { setError('Reconnect to your lesson, then try again.'); return; }
            const search = trigger.current?.closest('header')?.querySelector('input[type="search"]');
            close(!search);
            search?.focus({ preventScroll: true });
          }} className={`${action} bg-rose-600 text-white hover:bg-rose-700`}>Remove images</button>
        </div>
      </> : <button type='button' disabled={disabled} onClick={() => setConfirming(true)} className={`${action} w-full justify-start gap-2 text-rose-700 hover:bg-rose-50`}><Trash2 className='h-4 w-4 shrink-0' aria-hidden='true' />Remove all session images</button>}
    </section>, document.body)}
  </>;
}
