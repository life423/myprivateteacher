import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

// Native modal semantics keep keyboard focus and screen-reader navigation inside.
export default function LandingDialog({ open, onClose, onOpen, title, children, wide = false, returnFocusRef, keepMounted = false }) {
  const element = useRef(null);
  const callback = useRef(onOpen);
  callback.current = onOpen;
  const titleId = useId();
  useEffect(() => {
    const dialog = element.current;
    if (!open) {
      if (dialog.open) dialog.close();
      return undefined;
    }
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    callback.current?.();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      const target = returnFocusRef?.current || previous;
      if (target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
    };
  }, [open, returnFocusRef]);
  return (
    <dialog ref={element} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll('button, a[href], input, select, textarea, summary, video[controls], [tabindex="0"]')].filter((control) => !control.disabled && control.getClientRects().length && !control.closest('[inert]'));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }} className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/55 ${wide ? 'sm:max-w-4xl' : ''}`}>
      <div className='sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 sm:px-6 sm:py-3'>
        <h2 id={titleId} className='text-base font-bold sm:text-lg'>{title}</h2>
        <button type='button' onClick={onClose} aria-label={`Close ${title.toLowerCase()}`} className='-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600'><X className='h-5 w-5' aria-hidden='true' /></button>
      </div>
      {(open || keepMounted) && children}
    </dialog>
  );
}
