import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Plus, X } from 'lucide-react';

const control = 'inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg px-2 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500';

export function BoardPageIndicator({ pages = [], pageId }) {
  const index = Math.max(0, pages.findIndex((page) => page.id === pageId));
  return <span data-board-page-indicator role='status' aria-label={`Page ${index + 1} of ${Math.max(1, pages.length)}`} className='whitespace-nowrap px-2 text-xs font-semibold text-slate-600'><span className='hidden sm:inline'>Page </span>{index + 1} / {Math.max(1, pages.length)}</span>;
}

// Page navigation shares the existing board footer. The larger chooser opens above
// it without resizing the board or requiring a horizontal thumbnail carousel.
export default function BoardPages({ pages = [], pageId, actions, ready = true, pending = false, error = null, onRetry }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const button = useRef(null), panel = useRef(null);
  const id = useId();
  const index = Math.max(0, pages.findIndex((page) => page.id === pageId));
  const disabled = !ready || pending;
  const close = () => { setOpen(false); button.current?.focus({ preventScroll: true }); };
  const run = (action) => { if (disabled) return; action?.(); close(); };
  useLayoutEffect(() => {
    if (!open || !button.current) return undefined;
    const position = () => {
      const r = button.current.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 16);
      setPlace({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), bottom: Math.max(8, window.innerHeight - r.top + 8), width, maxHeight: Math.max(100, r.top - 16) });
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!panel.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    panel.current?.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div data-board-pages className='flex shrink-0 items-center'>
    <button type='button' aria-label='Previous board page' disabled={disabled || index === 0} onClick={() => run(() => actions.switch(pages[index - 1].id))} className={`${control} hidden sm:inline-flex`}><ChevronLeft className='h-4 w-4' aria-hidden='true' /></button>
    <button ref={button} type='button' aria-label={`Board pages, page ${index + 1} of ${Math.max(1, pages.length)}`} aria-haspopup='dialog' aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className={`${control} gap-1 text-violet-800`}>
      <span className='hidden sm:inline'>Page</span><span className='whitespace-nowrap tabular-nums'>{index + 1} / {Math.max(1, pages.length)}</span><ChevronDown className={`h-3 w-3 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden='true' />
    </button>
    <button type='button' aria-label='Next board page' disabled={disabled || index >= pages.length - 1} onClick={() => run(() => actions.switch(pages[index + 1].id))} className={`${control} hidden sm:inline-flex`}><ChevronRight className='h-4 w-4' aria-hidden='true' /></button>
    <button type='button' aria-label='Add blank board page' title='Add blank page' disabled={disabled || pages.length >= 24} onClick={() => run(actions.add)} className={`${control} hidden lg:inline-flex`}><Plus className='h-4 w-4' aria-hidden='true' /></button>
    <span role='status' className='sr-only'>{pending ? 'Changing board page…' : error || `Page ${index + 1} of ${Math.max(1, pages.length)}`}</span>
    {open && createPortal(<section ref={panel} id={id} role='dialog' aria-label='Board pages' style={{ position: 'fixed', ...place, visibility: place ? 'visible' : 'hidden' }} className='lesson-controls-enter z-[80] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl'>
      <header className='flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-2'><h2 className='text-base font-bold text-slate-900'>Board pages</h2><button type='button' aria-label='Close board pages' onClick={close} className={control}><X className='h-4 w-4' aria-hidden='true' /></button></header>
      <div className='min-h-0 overflow-y-auto p-2'>
        <p className='px-2 pb-2 text-xs leading-5 text-slate-500'>Your student follows the page you choose.</p>
        <ol className='space-y-1'>{pages.map((page, number) => <li key={page.id}><button type='button' aria-current={page.id === pageId ? 'page' : undefined} disabled={disabled} onClick={() => run(() => actions.switch(page.id))} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold disabled:opacity-40 ${page.id === pageId ? 'bg-violet-50 text-violet-800' : 'text-slate-700 hover:bg-slate-50'}`}><span className='flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-xs tabular-nums'>{number + 1}</span><span className='min-w-0 flex-1 truncate'>{page.title || `Page ${number + 1}`}</span>{page.id === pageId && <Check className='h-4 w-4 shrink-0' aria-hidden='true' />}</button></li>)}</ol>
      </div>
      <div className='grid shrink-0 grid-cols-2 gap-2 border-t border-slate-200 p-3'>
        <button type='button' disabled={disabled || pages.length >= 24} onClick={() => run(actions.add)} className={`${control} gap-1 border border-violet-200 bg-violet-50 text-violet-800`}><Plus className='h-4 w-4' aria-hidden='true' />Blank page</button>
        <button type='button' disabled={disabled || pages.length >= 24} onClick={() => run(() => actions.duplicate(pageId))} className={`${control} gap-1 border border-slate-200`}><Copy className='h-4 w-4' aria-hidden='true' />Duplicate</button>
      </div>
      {error && <div role='alert' className='px-4 pb-3 text-xs text-rose-700'><p>{error}</p>{!ready && onRetry && <button type='button' onClick={onRetry} className={`${control} mt-2 border border-rose-200`}>Retry restoring pages</button>}</div>}
      {pages.length >= 24 && <p className='px-4 pb-3 text-xs text-slate-500'>Up to 24 pages per lesson.</p>}
    </section>, document.body)}
  </div>;
}
