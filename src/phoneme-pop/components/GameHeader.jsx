import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, HelpCircle, Home, Link2 as LinkIcon, Trophy } from 'lucide-react';
import { Link } from '../../router.jsx';

function Stat({ label, value, tone, children }) {
  return (
    <div className='text-center'>
      <div className='text-[11px] min-[400px]:text-xs sm:text-sm text-gray-600'>{label}</div>
      <div className={`flex items-center justify-center gap-1 text-lg sm:text-xl md:text-2xl font-bold leading-tight ${tone}`}>
        {value}
        {children}
      </div>
    </div>
  );
}

// The Level 1 pill, which opens a short list of every level (its skill on a second line).
function LevelPicker({ level, levels, onChoose }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => {
      if (!box.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/phoneme-pop?level=${level}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked: nothing to do
    }
  };

  return (
    <div ref={box} className='relative'>
      <button
        type='button'
        onClick={() => setOpen((was) => !was)}
        aria-haspopup='menu'
        aria-expanded={open}
        aria-label={`Level ${level}. Choose a level`}
        className={`flex items-center gap-1 rounded-xl border-2 px-2.5 py-1 text-sm font-bold text-purple-700 transition-colors sm:gap-1.5 sm:px-3.5 sm:py-1.5 sm:text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 ${
          open ? 'border-purple-500 bg-purple-100' : 'border-purple-300 bg-purple-50 hover:border-purple-400 hover:bg-purple-100'
        }`}
      >
        <span className='whitespace-nowrap'>Level {level}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden='true' />
      </button>
      {open && (
        <div
          role='menu'
          aria-label='Choose a level'
          className='absolute left-1/2 top-full z-30 mt-3 w-60 -translate-x-1/2 rounded-2xl border border-gray-200 bg-white p-1.5 text-left shadow-xl'
        >
          {/* The little pointer up to the pill. */}
          <span aria-hidden='true' className='absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-gray-200 bg-white' />
          {levels.map((l) => {
            const on = l.level === level;
            return (
              <button
                key={l.level}
                type='button'
                role='menuitemradio'
                aria-checked={on}
                onClick={() => {
                  setOpen(false);
                  if (!on) onChoose(l.level);
                }}
                className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${on ? 'bg-purple-100' : 'hover:bg-gray-50'}`}
              >
                <span className='min-w-0 flex-1'>
                  <span className={`block text-base font-bold ${on ? 'text-purple-700' : 'text-slate-800'}`}>Level {l.level}</span>
                  <span className='block truncate text-xs text-gray-500'>{l.title}</span>
                </span>
                {on && <Check className='h-5 w-5 shrink-0 text-purple-600' strokeWidth={3} aria-hidden='true' />}
              </button>
            );
          })}
          <div className='mt-1 border-t border-gray-100 pt-1'>
            <button
              type='button'
              role='menuitem'
              onClick={copyLink}
              className='flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-50'
            >
              <LinkIcon className='h-3.5 w-3.5 shrink-0' aria-hidden='true' />
              {copied ? 'Link copied' : `Copy a link to Level ${level}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GameHeader({ showInstructions, onToggleInstructions, level, levels, onChooseLevel, score, streak }) {
  const Chevron = showInstructions ? ChevronUp : ChevronDown;
  return (
    <header className='bg-white shadow-md px-2 py-2 min-[400px]:px-3 sm:px-4 sm:py-3'>
      <div className='max-w-7xl mx-auto flex items-center justify-between gap-2 sm:gap-3'>
        <div className='flex min-w-0 items-center gap-0.5 sm:gap-3'>
          <Link to='/' aria-label='All activities' className='shrink-0 rounded-full p-2 text-purple-700 hover:bg-purple-100'>
            <Home className='w-5 h-5' aria-hidden='true' />
          </Link>
          <h1 className='whitespace-nowrap text-base min-[400px]:text-lg sm:text-xl md:text-2xl font-bold text-purple-700'>Phoneme Pop!</h1>
          <button
            type='button'
            onClick={onToggleInstructions}
            aria-expanded={showInstructions}
            aria-controls='how-to-play'
            aria-label='How to play'
            className='flex shrink-0 items-center gap-1 rounded-full p-1.5 sm:px-3 sm:py-1.5 text-sm font-semibold text-purple-700 hover:bg-purple-100 transition-colors'
          >
            <HelpCircle className='h-5 w-5 sm:hidden' aria-hidden='true' />
            <span className='hidden sm:inline'>How to play</span>
            <Chevron className='hidden h-4 w-4 sm:block' aria-hidden='true' />
          </button>
        </div>
        <div className='flex shrink-0 items-center gap-2 min-[400px]:gap-3 sm:gap-6'>
          <LevelPicker level={level} levels={levels} onChoose={onChooseLevel} />
          <Stat label='Score' value={score} tone='text-green-700' />
          <Stat label='Streak' value={streak} tone='text-orange-600'>
            {streak >= 3 && <Trophy className='hidden w-4 h-4 sm:w-5 sm:h-5 text-orange-500 min-[400px]:block' aria-label='On a roll!' />}
          </Stat>
        </div>
      </div>
    </header>
  );
}
