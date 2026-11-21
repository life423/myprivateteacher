import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Plus, Trash2, X } from 'lucide-react';

const action = 'inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg px-2 text-xs font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500';
const control = `${action} text-slate-700 hover:bg-violet-100`;

export function BoardPageIndicator({ pages = [], pageId }) {
  const index = Math.max(0, pages.findIndex((page) => page.id === pageId));
  return <span data-board-page-indicator role='status' aria-label={`Page ${index + 1} of ${Math.max(1, pages.length)}`} className='whitespace-nowrap px-2 text-xs font-semibold text-slate-600'><span className='hidden sm:inline'>Page </span>{index + 1} / {Math.max(1, pages.length)}</span>;
}

// Page navigation shares the existing board footer. The larger chooser opens above
// it without resizing the board or requiring a horizontal thumbnail carousel.
export default function BoardPages({ pages = [], pageId, actions, ready = true, pending = false, error = null, onRetry }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const [target, setTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const button = useRef(null), panel = useRef(null);
  const returnToDelete = useRef(false);
  const restoreAfterDelete = useRef(false);
  const id = useId();
  const index = Math.max(0, pages.findIndex((page) => page.id === pageId));
  const disabled = !ready || pending;
  const positioned = place !== null;
  const dismiss = () => { setOpen(false); setPlace(null); setTarget(null); setDeleting(false); setDeleteError(''); returnToDelete.current = false; };
  const close = () => { dismiss(); button.current?.focus({ preventScroll: true }); };
  const cancelDelete = () => { returnToDelete.current = true; setTarget(null); setDeleteError(''); };
  const run = (action) => { if (disabled) return; action?.(); close(); };
  useLayoutEffect(() => () => {
    // A confirmed page change remounts Stage and this footer. Hand keyboard
    // focus to the new footer rather than the now-detached trigger.
    if (restoreAfterDelete.current) requestAnimationFrame(() => {
      document.querySelector('[data-board-pages] button[aria-haspopup="dialog"]')?.focus({ preventScroll: true });
    });
  }, []);
  useLayoutEffect(() => {
    if (!open || !button.current) return undefined;
    const position = () => {
      const r = button.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
      const width = Math.min(320, (viewport?.width ?? window.innerWidth) - 16);
      const bottomEdge = Math.min(r.top - 8, top + (viewport?.height ?? window.innerHeight) - 8);
      setPlace({ left: Math.max(left + 8, Math.min(r.left, left + (viewport?.width ?? window.innerWidth) - width - 8)), bottom: window.innerHeight - bottomEdge, width, maxHeight: Math.max(0, bottomEdge - top - 8) });
    };
    position();
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !positioned) return;
    panel.current?.querySelector(target ? '[data-cancel-delete-page]' : returnToDelete.current ? '[data-delete-page]' : '[aria-current="page"]')?.focus({ preventScroll: true });
    returnToDelete.current = false;
  }, [open, positioned, target]);
  useEffect(() => {
    if (!target) return;
    // Keep confirmation tied to its original page, even if a reconnect or
    // another page command changes the active page before the tutor confirms.
    if (pageId !== target.id || !pages.some(page => page.id === target.id)) close();
    else if (!pending && error) { setDeleting(false); restoreAfterDelete.current = false; }
  }, [pageId, pages, pending, error, target]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!panel.current?.contains(event.target) && !button.current?.contains(event.target)) dismiss(); };
    const escape = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation();
      if (target && !deleting) cancelDelete(); else close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open, target, deleting]);
  const requestDelete = () => {
    if (disabled || deleting || pages.length < 2 || !target || pageId !== target.id) return;
    if (actions.remove(target.id) === false) { setDeleteError('Reconnect before deleting this page.'); return; }
    restoreAfterDelete.current = true;
    setDeleting(true); setDeleteError('');
  };
  return <div data-board-pages className='flex shrink-0 items-center'>
    <button type='button' aria-label='Previous board page' disabled={disabled || index === 0} onClick={() => run(() => actions.switch(pages[index - 1].id))} className={`${control} hidden sm:inline-flex`}><ChevronLeft className='h-4 w-4' aria-hidden='true' /></button>
    <button ref={button} type='button' aria-label={`Board pages, page ${index + 1} of ${Math.max(1, pages.length)}`} aria-haspopup='dialog' aria-expanded={open} aria-controls={id} onClick={() => open ? close() : setOpen(true)} className={`${control} gap-1 text-violet-800`}>
      <span className='hidden sm:inline'>Page</span><span className='whitespace-nowrap tabular-nums'>{index + 1} / {Math.max(1, pages.length)}</span><ChevronDown className={`h-3 w-3 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden='true' />
    </button>
    <button type='button' aria-label='Next board page' disabled={disabled || index >= pages.length - 1} onClick={() => run(() => actions.switch(pages[index + 1].id))} className={`${control} hidden sm:inline-flex`}><ChevronRight className='h-4 w-4' aria-hidden='true' /></button>
    <button type='button' aria-label='Add blank board page' title='Add blank page' disabled={disabled || pages.length >= 24} onClick={() => run(actions.add)} className={`${control} hidden lg:inline-flex`}><Plus className='h-4 w-4' aria-hidden='true' /></button>
    <span role='status' className='sr-only'>{pending ? 'Changing board page…' : error || `Page ${index + 1} of ${Math.max(1, pages.length)}`}</span>
    {open && createPortal(<section ref={panel} id={id} role='dialog' aria-label={target ? `Delete “${target.title}”?` : 'Board pages'} onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      if (target && !deleting) cancelDelete(); else close();
    }} style={{ position: 'fixed', ...place, visibility: place ? 'visible' : 'hidden' }} className='lesson-controls-enter z-[80] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl'>
      <header className='flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-2'><h2 className='min-w-0 break-words text-base font-bold text-slate-900'>{target ? `Delete “${target.title}”?` : 'Board pages'}</h2><button type='button' aria-label='Close board pages' onClick={close} className={control}><X className='h-4 w-4' aria-hidden='true' /></button></header>
      {target ? <>
        <div className='min-h-0 overflow-y-auto px-4 py-3 text-sm leading-relaxed text-slate-600'>
          <p>This page and its board work will be deleted. This cannot be undone.</p>
          <p className='mt-2'>Saved lessons stay in your profile.</p>
        </div>
        <div className='grid shrink-0 grid-cols-2 gap-2 border-t border-slate-200 p-3'>
          <button data-cancel-delete-page type='button' disabled={deleting} onClick={cancelDelete} className={`${control} border border-slate-300 px-3`}>Cancel</button>
          <button type='button' disabled={disabled || deleting || pages.length < 2} onClick={requestDelete} className={`${action} bg-rose-600 px-3 text-white hover:bg-rose-700`}>{deleting ? 'Deleting…' : 'Delete page'}</button>
        </div>
      </> : <>
      <div className='min-h-0 overflow-y-auto p-2'>
        <p className='px-2 pb-2 text-xs leading-5 text-slate-500'>Your student follows the page you choose.</p>
        <ol className='space-y-1'>{pages.map((page, number) => <li key={page.id}><button type='button' aria-current={page.id === pageId ? 'page' : undefined} disabled={disabled} onClick={() => run(() => actions.switch(page.id))} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold disabled:opacity-40 ${page.id === pageId ? 'bg-violet-50 text-violet-800' : 'text-slate-700 hover:bg-slate-50'}`}><span className='flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-xs tabular-nums'>{number + 1}</span><span className='min-w-0 flex-1 truncate'>{page.title || `Page ${number + 1}`}</span>{page.id === pageId && <Check className='h-4 w-4 shrink-0' aria-hidden='true' />}</button></li>)}</ol>
      </div>
      <div className='grid shrink-0 grid-cols-2 gap-2 border-t border-slate-200 p-3'>
        <button type='button' disabled={disabled || pages.length >= 24} onClick={() => run(actions.add)} className={`${control} gap-1 border border-violet-200 bg-violet-50 text-violet-800`}><Plus className='h-4 w-4' aria-hidden='true' />Blank page</button>
        <button type='button' disabled={disabled || pages.length >= 24} onClick={() => run(() => actions.duplicate(pageId))} className={`${control} gap-1 border border-slate-200`}><Copy className='h-4 w-4' aria-hidden='true' />Duplicate</button>
        <button data-delete-page type='button' disabled={disabled || pages.length < 2} aria-describedby={pages.length < 2 ? `${id}-keep-page` : undefined} onClick={() => {
          if (disabled || pages.length < 2) return;
          setTarget({ id: pageId, title: pages[index]?.title || `Page ${index + 1}` });
        }} className={`${action} col-span-2 gap-2 text-rose-700 hover:bg-rose-50`}><Trash2 className='h-4 w-4' aria-hidden='true' />Delete page</button>
        {pages.length < 2 && <p id={`${id}-keep-page`} className='col-span-2 text-center text-xs text-slate-500'>Keep at least one page.</p>}
      </div>
      {pages.length >= 24 && <p className='px-4 pb-3 text-xs text-slate-500'>Up to 24 pages per lesson.</p>}
      </>}
      {(error || deleteError) && <div role='alert' className='px-4 pb-3 text-xs text-rose-700'><p>{deleteError || error}</p>{!ready && onRetry && <button type='button' onClick={onRetry} className={`${control} mt-2 border border-rose-200`}>Retry restoring pages</button>}</div>}
    </section>, document.body)}
  </div>;
}
