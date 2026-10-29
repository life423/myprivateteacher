import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Copy, Maximize2, SlidersHorizontal, X } from 'lucide-react';
import { Link } from '../router.jsx';

// A stable, labelled entry keeps lesson controls discoverable at every width.
// The floating surface scrolls independently without taking space from the board.
export function TopBar({ back, title, children, menu, menuSummary, end }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const trigger = useRef(null), options = useRef(null), closeTimer = useRef(null);
  const optionsId = useId();
  const room = Boolean(menu || end);
  const expanded = open && !closing;
  const focusOptions = () => (options.current?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || options.current)?.focus({ preventScroll: true });
  const showOptions = () => {
    clearTimeout(closeTimer.current);
    setClosing(false);
    setOpen(true);
  };
  const closeOptions = (restoreFocus = false) => {
    clearTimeout(closeTimer.current);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setOpen(false);
      setClosing(false);
    } else {
      setClosing(true);
      closeTimer.current = setTimeout(() => { setOpen(false); setClosing(false); }, 140);
    }
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    else if (options.current?.contains(document.activeElement)) document.activeElement?.blur();
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!expanded) return undefined;
    const closeOutside = (event) => {
      if (!options.current?.contains(event.target) && !trigger.current?.contains(event.target)) closeOptions();
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      closeOptions(true);
    };
    focusOptions();
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <header data-whiteboard-topbar className={`relative z-40 flex items-center gap-2 bg-white px-2 py-2 shadow-sm sm:px-4 ${room ? 'flex-nowrap' : 'flex-wrap gap-x-4'}`}>
      {back && <Link to={back} aria-label='Back' className='rounded-full p-2 text-violet-700 hover:bg-violet-100'><ArrowLeft className='h-5 w-5' aria-hidden='true' /></Link>}
      <h1 className={`text-lg font-bold text-violet-800 sm:text-xl ${room ? 'min-w-0 truncate max-lg:sr-only' : 'shrink-0'}`}>{title}</h1>
      <div className={`flex items-center justify-end gap-1.5 sm:gap-3 ${room ? 'ml-auto shrink-0' : 'min-w-0 flex-1 flex-wrap'}`}>
        {children}
        {menu && <button
          ref={trigger}
          type='button'
          aria-haspopup='dialog'
          aria-expanded={expanded}
          aria-controls={optionsId}
          aria-label='Lesson controls'
          onClick={() => expanded ? closeOptions(true) : showOptions()}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown') return;
            event.preventDefault();
            if (expanded) focusOptions(); else showOptions();
          }}
          className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${expanded ? 'border-violet-300 bg-violet-50 text-violet-800' : 'border-slate-300 text-slate-700 hover:border-violet-300 hover:bg-violet-50'}`}
        >
          <SlidersHorizontal className='hidden h-4 w-4 shrink-0 sm:block' aria-hidden='true' />
          <span className='sm:hidden'>Controls</span><span className='hidden sm:inline'>Lesson controls</span>
          {menuSummary && <span className='hidden rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 xl:inline'>{menuSummary}</span>}
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} aria-hidden='true' />
        </button>}
        {end && <div className={`shrink-0 [&_button]:min-h-11 ${menu ? 'max-sm:hidden' : ''}`}>{end}</div>}
      </div>
      {menu && open && <div
        ref={options}
        id={optionsId}
        role='dialog'
        aria-label='Lesson controls'
        aria-hidden={closing || undefined}
        inert={closing ? '' : undefined}
        tabIndex={-1}
        data-lesson-controls
        data-state={closing ? 'closing' : 'open'}
        className={`absolute right-2 top-full z-40 mt-2 flex max-h-[calc(100dvh-5rem)] w-80 max-w-[calc(100vw-1rem)] origin-top-right flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl outline-none ${closing ? 'lesson-controls-exit' : 'lesson-controls-enter'}`}
      >
        <div className='flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-2'>
          <h2 className='text-base font-bold text-slate-900'>Lesson controls</h2>
          <button type='button' aria-label='Close lesson controls' onClick={() => closeOptions(true)} className='inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors duration-150 hover:bg-slate-100 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500'><X className='h-5 w-5' aria-hidden='true' /></button>
        </div>
        <div data-lesson-controls-body className='min-h-0 overflow-y-auto overscroll-contain p-4 [&_.hide-inline]:inline [&_button]:min-h-11 [&_[aria-label=Hands]]:w-auto [&_[aria-label=Hands]>div]:gap-2 [&_[aria-label=Hands]_button]:min-w-11'>{menu}</div>
        {end && <div className='shrink-0 border-t border-slate-200 px-4 py-3 sm:hidden [&_button]:min-h-11'>{end}</div>}
      </div>}
    </header>
  );
}

const TONES = {
  good: 'bg-emerald-100 text-emerald-800',
  wait: 'bg-amber-100 text-amber-900',
  bad: 'bg-rose-100 text-rose-800',
};

export function StatusPill({ tone, children }) {
  return (
    <span
      role='status'
      title={typeof children === 'string' ? children : undefined}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-2 text-sm font-semibold sm:px-3 sm:py-1 ${TONES[tone]}`}
    >
      <span className='h-2 w-2 rounded-full bg-current' aria-hidden='true' />
      {/* Compact headers keep the status words available to screen readers. */}
      <span className='max-xl:sr-only'>{children}</span>
    </span>
  );
}

// Focus mode: just the board, with everything else tucked away.
export function FocusButton({ onClick }) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label='Focus mode'
      title='Focus mode: just the board'
      className='inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-2.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50'
    >
      <Maximize2 className='h-4 w-4' aria-hidden='true' />
      <span className='hide-inline'>Focus mode</span>
    </button>
  );
}

// A message over the board. Its X closes it, and it stays closed until the message changes.
export function StageNotice({ children }) {
  const text = [].concat(children).join('');
  const [closed, setClosed] = useState(null);
  if (closed === text) return null;
  return (
    <div className='pointer-events-none absolute inset-x-0 top-[22%] z-10 flex justify-center px-3 sm:px-4 [main:has([data-object-toolbar])_&]:hidden [main:has([data-sound-box])_&]:hidden'>
      <div className='pointer-events-none relative max-w-md rounded-2xl bg-slate-900/85 px-9 py-3 text-center text-sm font-semibold leading-snug text-white shadow-lg backdrop-blur-sm sm:px-10 sm:text-base'>
        <p className='text-balance'>{children}</p>
        <button
          type='button'
          onClick={() => setClosed(text)}
          aria-label='Close this message'
          title='Close'
          className='pointer-events-auto absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/25 hover:text-white'
        >
          <X className='h-3.5 w-3.5' aria-hidden='true' />
        </button>
      </div>
    </div>
  );
}

export function CopyButton({ text, label = 'Copy lesson link', compact = false }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      clearTimeout(timer.current);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      clearTimeout(timer.current);
      setCopied(false);
      window.prompt('Copy this lesson link:', text);
    }
  };
  return (
    <button
      type='button'
      onClick={copy}
      aria-label={copied ? 'Copied lesson link' : label}
      title={copied ? 'Copied' : label}
      className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-violet-200 text-sm font-semibold text-violet-800 hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${compact ? 'w-11 px-0 md:w-auto md:px-3' : 'px-3'}`}
    >
      {copied ? <Check className='h-4 w-4 shrink-0' aria-hidden='true' /> : <Copy className='h-4 w-4 shrink-0' aria-hidden='true' />}
      <span className={`${compact ? 'hidden md:grid' : 'grid'} text-center`} aria-hidden='true'>
        <span className='invisible [grid-area:1/1]'>{label}</span>
        <span className='[grid-area:1/1]'>{copied ? 'Copied' : label}</span>
      </span>
      <span role='status' className='sr-only'>{copied ? 'Lesson link copied.' : ''}</span>
    </button>
  );
}

export function MessageScreen({ title, children }) {
  return (
    <div className='flex min-h-dvh items-center justify-center bg-gradient-to-b from-violet-50 to-sky-50 p-6'>
      <div className='max-w-md rounded-3xl bg-white p-8 text-center shadow-lg'>
        <h1 className='text-2xl font-bold text-slate-900'>{title}</h1>
        <p className='mt-3 text-base text-slate-600'>{children}</p>
        <Link to='/whiteboard' className='mt-6 inline-block rounded-full bg-violet-600 px-6 py-3 font-bold text-white hover:bg-violet-700'>
          Back to the whiteboard
        </Link>
      </div>
    </div>
  );
}
