import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Copy, Maximize2, X } from 'lucide-react';
import { Link } from '../router.jsx';

// The header. `children` are the essentials, always shown. `menu` holds the session controls:
// in the bar whenever everything fits on one line, behind a menu button when it doesn't. That's
// measured from the bar itself, not guessed from the screen size. `end` (End session, Leave) sits
// at the far right; on phones it moves into the menu to leave room for the title.
export function TopBar({ back, title, children, menu, end }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const ref = useRef(null);
  const trigger = useRef(null);
  const options = useRef(null);
  const optionsId = useId();
  const focusOptions = () => (options.current?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || options.current)?.focus({ preventScroll: true });
  const needed = useRef(0); // how wide the bar must be to show everything on one line
  const room = Boolean(menu || end);
  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!options.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
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
  }, [open]);
  useLayoutEffect(() => {
    if (!menu) return undefined;
    const bar = ref.current;
    const check = () =>
      setCollapsed((was) => {
        if (!was && bar.scrollWidth > bar.clientWidth + 1) {
          needed.current = bar.scrollWidth;
          return true;
        }
        if (was && bar.clientWidth >= needed.current) return false;
        return was;
      });
    check();
    const observer = new ResizeObserver(check);
    observer.observe(bar);
    for (const part of bar.children) observer.observe(part);
    return () => observer.disconnect();
  }, [Boolean(menu)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!collapsed) setOpen(false);
  }, [collapsed]);
  return (
    <header
      ref={ref}
      data-whiteboard-topbar
      data-collapsed={collapsed}
      className={`group/topbar relative z-40 flex items-center gap-x-2 gap-y-2 bg-white px-2 py-2 shadow-sm sm:px-4 ${room ? 'flex-nowrap sm:gap-x-4' : 'flex-wrap gap-x-4'}`}
    >
      {back && (
        <Link to={back} aria-label='Back' className='rounded-full p-2 text-violet-700 hover:bg-violet-100'>
          <ArrowLeft className='h-5 w-5' aria-hidden='true' />
        </Link>
      )}
      <h1 className={`text-lg font-bold text-violet-800 sm:text-xl ${room && collapsed ? 'min-w-0 truncate max-sm:text-base' : 'shrink-0'}`}>{title}</h1>
      <div
        className={`flex items-center justify-end gap-x-1.5 gap-y-2 ${room ? 'ml-auto shrink-0 sm:gap-x-3' : 'min-w-0 flex-1 flex-wrap sm:gap-x-4'}`}
      >
        {children}
        {/* In the bar, controls marked hide-inline show just their icon (the menu shows their words). */}
        {menu && !collapsed && <div className='flex shrink-0 items-center gap-x-3 whitespace-nowrap [&_.hide-inline]:hidden'>{menu}</div>}
        {menu && collapsed && (
          <button
            ref={trigger}
            type='button'
            aria-haspopup='dialog'
            aria-expanded={open}
            aria-controls={optionsId}
            aria-label='Session options'
            title='Session options'
            onClick={() => setOpen((was) => !was)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              if (open) focusOptions();
              else setOpen(true);
            }}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${open ? 'bg-violet-100 text-violet-800' : 'text-slate-700 hover:bg-slate-100'}`}
          >
            <ChevronDown className={`h-5 w-5 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden='true' />
          </button>
        )}
        {end && <div className={`shrink-0 ${collapsed ? 'max-sm:hidden' : ''}`}>{end}</div>}
      </div>
      {menu && collapsed && open && (
        <div ref={options} id={optionsId} role='dialog' aria-label='Session options' tabIndex={-1} className='absolute right-2 top-full z-40 mt-2 flex max-h-[calc(100dvh-4rem)] w-72 max-w-[calc(100vw-1rem)] flex-col items-start gap-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-xl ring-1 ring-slate-200 outline-none'>
          {menu}
          {end && <div className='sm:hidden'>{end}</div>}
        </div>
      )}
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
      className={`inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-2 text-sm font-semibold sm:px-3 sm:py-1 group-data-[collapsed=true]/topbar:px-2 group-data-[collapsed=true]/topbar:py-2 ${TONES[tone]}`}
    >
      <span className='h-2 w-2 rounded-full bg-current' aria-hidden='true' />
      {/* Compact headers keep the status words available to screen readers. */}
      <span className='max-sm:sr-only group-data-[collapsed=true]/topbar:sr-only'>{children}</span>
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
    <div className='pointer-events-none absolute inset-x-0 top-[22%] z-10 flex justify-center px-3 sm:px-4 [main:has([data-object-toolbar])_&]:hidden'>
      <div className='pointer-events-auto relative max-w-md rounded-2xl bg-slate-900/85 px-9 py-3 text-center text-sm font-semibold leading-snug text-white shadow-lg backdrop-blur-sm sm:px-10 sm:text-base'>
        <p className='text-balance'>{children}</p>
        <button
          type='button'
          onClick={() => setClosed(text)}
          aria-label='Close this message'
          title='Close'
          className='absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/25 hover:text-white'
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
      className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-violet-200 text-sm font-semibold text-violet-800 hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${compact ? 'w-11 px-0 sm:w-auto sm:px-3' : 'px-3'}`}
    >
      {copied ? <Check className='h-4 w-4 shrink-0' aria-hidden='true' /> : <Copy className='h-4 w-4 shrink-0' aria-hidden='true' />}
      <span className={`${compact ? 'hidden sm:grid' : 'grid'} text-center`} aria-hidden='true'>
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
