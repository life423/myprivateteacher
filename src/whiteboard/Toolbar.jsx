import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { GloveIcon } from './Hand.jsx';

export function ToolRail({ label, children }) {
  return (
    <nav
      aria-label={label}
      className='flex shrink-0 flex-col justify-center gap-1 self-center rounded-2xl border border-slate-200/80 bg-white p-1 shadow-sm'
    >
      {children}
    </nav>
  );
}

export function ToolButton({ icon: Icon, label, pressed, expanded, controls, disabled = false, danger = false, swatch, onClick }) {
  let tone = 'text-slate-700 hover:bg-violet-50';
  if (danger) tone = 'bg-rose-600 text-white';
  else if (pressed) tone = 'bg-violet-600 text-white shadow';
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      aria-pressed={expanded === undefined ? pressed : undefined}
      aria-expanded={expanded}
      aria-controls={controls}
      title={label}
      aria-label={label}
      className={`flex min-h-11 w-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold transition-colors disabled:opacity-30 ${tone}`}
    >
      <span className='relative'>
        <Icon className='h-5 w-5' aria-hidden='true' />
        {swatch && (
          <span
            className='absolute -bottom-1 -right-1 h-3 w-3 rounded-full ring-2 ring-white'
            style={{ backgroundColor: swatch }}
          />
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}

// The two shared hands, switched on and off: the left glove on the left, the right on the right.
// Either person can use it (the student while their tools are on); both screens follow.
export function HandsSwitch({ hands, onToggle }) {
  return (
    <div role='group' aria-label='Hands' className='flex w-11 flex-col items-center gap-1 rounded-xl px-0.5 py-1.5 sm:w-14 lg:w-16'>
      <div className='flex w-full justify-center gap-0.5'>
        {['l', 'r'].map((side) => {
          const on = hands[side].on;
          const name = side === 'l' ? 'Left hand' : 'Right hand';
          return (
            <button
              key={side}
              type='button'
              aria-pressed={on}
              aria-label={name}
              title={`${name}: ${on ? 'showing' : 'hidden'}`}
              onClick={() => onToggle(side, !on)}
              className={`flex h-11 min-w-0 flex-1 items-center justify-center rounded-lg transition-colors ${on ? 'bg-violet-100 ring-2 ring-inset ring-violet-400' : 'hover:bg-violet-50'}`}
            >
              <GloveIcon side={side} className={`h-6 w-auto ${on ? '' : 'opacity-40 grayscale'}`} />
            </button>
          );
        })}
      </div>
      <span className='text-xs font-bold text-slate-700 max-sm:sr-only'>Hands</span>
    </div>
  );
}

// Clearing needs a second tap within three seconds, so it never happens by accident.
export function ClearButton({ icon, onClear, label = 'Clear board' }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <div className='mt-2 border-t border-slate-200 pt-2'><ToolButton
      icon={icon}
      label={armed ? 'Clear now?' : label}
      danger={armed}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onClear();
      }}
    /></div>
  );
}

export function Switch({ checked, onChange, label }) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className='inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-semibold text-slate-700 hover:bg-slate-100'
    >
      <span className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}>
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
        />
      </span>
      {label}
    </button>
  );
}

// A row of handwriting lines: top line, dashed midline, baseline.
export function LinesIcon({ className }) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' className={className} aria-hidden='true'>
      <path d='M3 6h18' />
      <path d='M3 12h18' strokeDasharray='2.5 3' />
      <path d='M3 18h18' />
    </svg>
  );
}

const LINE_CHOICES = [
  { size: 'big', label: 'Big', hint: 'Kindergarten to 1st grade', rows: 1 },
  { size: 'medium', label: 'Medium', hint: '2nd and 3rd grade', rows: 2 },
  { size: 'small', label: 'Small', hint: 'Cursive, 3rd grade and up', rows: 3 },
  { size: 'off', label: 'Off', hint: 'A blank board', rows: 0 },
];

// A tiny picture of a line size: bigger lines, fewer rows.
function LinesPreview({ rows }) {
  const lines = [];
  if (rows) {
    const band = 20 / (rows * 1.5 - 0.5);
    for (let i = 0; i < rows; i += 1) {
      const top = 2 + i * band * 1.5;
      lines.push(<path key={`t${i}`} d={`M3 ${top}h26`} />, <path key={`m${i}`} d={`M3 ${top + band / 2}h26`} strokeDasharray='2 2' />, <path key={`b${i}`} d={`M3 ${top + band}h26`} />);
    }
  }
  return (
    <svg viewBox='0 0 32 24' fill='none' stroke='currentColor' strokeWidth='1.5' className='h-6 w-8 shrink-0' aria-hidden='true'>
      <rect x='1' y='0.75' width='30' height='22.5' rx='3' className='stroke-slate-200' />
      {lines}
    </svg>
  );
}

const MENU_WIDTH = 248;

// The tutor's handwriting lines: big, medium, small or off. The menu opens beside the rail, or
// above the tools on a phone, and stays on screen.
export function LinesButton({ size, onChoose, inline = false }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const button = useRef(null);
  const menu = useRef(null);

  useLayoutEffect(() => {
    if (!open) return;
    const r = button.current.getBoundingClientRect();
    const height = menu.current?.offsetHeight || 280;
    const width = window.innerWidth;
    const fit = (value, low, high) => Math.min(Math.max(value, low), high);
    if (r.right + 8 + MENU_WIDTH <= width - 8) {
      setPlace({ left: r.right + 8, top: fit(r.top + r.height / 2 - height / 2, 8, window.innerHeight - height - 8) });
    } else {
      setPlace({ left: fit(r.left + r.width / 2 - MENU_WIDTH / 2, 8, width - MENU_WIDTH - 8), top: Math.max(8, r.top - 8 - height) });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => {
      if (!button.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (inline) return (
    <fieldset className='min-w-0'>
      <legend className='mb-2 text-sm font-semibold text-slate-700'>Writing lines</legend>
      <div role='group' aria-label='Writing lines' className='grid grid-cols-4 gap-2'>
        {LINE_CHOICES.map((choice) => {
          const on = choice.size === size;
          return <button key={choice.size} type='button' aria-label={`${choice.label} writing lines`} aria-pressed={on} title={choice.hint} onClick={() => { if (!on) onChoose(choice.size); }} className={`flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 text-xs font-semibold transition-colors duration-150 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500 ${on ? 'border-violet-400 bg-violet-50 text-violet-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}><LinesPreview rows={choice.rows} />{choice.label}</button>;
        })}
      </div>
    </fieldset>
  );

  return (
    <>
      <button
        ref={button}
        type='button'
        onClick={() => {
          setPlace(null);
          setOpen((was) => !was);
        }}
        aria-haspopup='menu'
        aria-expanded={open}
        title='Writing lines'
        className={`flex min-h-11 w-11 flex-col items-center gap-1 rounded-xl px-1 py-2 text-xs font-bold transition-colors sm:w-14 lg:w-16 ${
          open ? 'bg-violet-600 text-white shadow' : 'text-slate-700 hover:bg-violet-50'
        }`}
      >
        <LinesIcon className='h-6 w-6' />
        <span className='max-sm:sr-only'>Lines</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role='menu'
            aria-label='Writing lines'
            style={{ position: 'fixed', width: MENU_WIDTH, left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? 'visible' : 'hidden' }}
            className='z-50 rounded-2xl border border-slate-200 bg-white p-1.5 text-left shadow-xl'
          >
            <p className='px-3 pb-1 pt-1.5 text-sm font-bold text-slate-900'>Writing lines</p>
            {LINE_CHOICES.map((choice) => {
              const on = choice.size === size;
              return (
                <button
                  key={choice.size}
                  type='button'
                  role='menuitemradio'
                  aria-checked={on}
                  onClick={() => {
                    setOpen(false);
                    if (!on) onChoose(choice.size);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${on ? 'bg-violet-50 text-violet-700' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                  <LinesPreview rows={choice.rows} />
                  <span className='min-w-0 flex-1'>
                    <span className={`block text-sm font-bold ${on ? 'text-violet-700' : 'text-slate-800'}`}>{choice.label}</span>
                    <span className='block text-xs text-slate-500'>{choice.hint}</span>
                  </span>
                  {on && <Check className='h-4 w-4 shrink-0 text-violet-600' strokeWidth={3} aria-hidden='true' />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
