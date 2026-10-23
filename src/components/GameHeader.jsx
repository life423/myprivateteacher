import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Home, Link2 as LinkIcon, Trophy } from 'lucide-react';
import { Link } from '../router.jsx';

function Stat({ label, value, tone, children }) {
  return (
    <div className='text-center'>
      <div className='text-xs sm:text-sm text-gray-600'>{label}</div>
      <div className={`flex items-center justify-center gap-1 text-lg sm:text-xl md:text-2xl font-bold ${tone}`}>
        {value}
        {children}
      </div>
    </div>
  );
}

// The level number, which opens a list of every level to choose from.
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
    <div ref={box}>
      <button
        type='button'
        onClick={() => setOpen((was) => !was)}
        aria-haspopup='menu'
        aria-expanded={open}
        aria-label={`Level ${level}. Choose a level`}
        className='rounded-xl px-1 sm:px-2 py-0.5 text-center transition-colors hover:bg-purple-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-500'
      >
        <span className='flex items-center justify-center gap-0.5 text-xs sm:text-sm text-gray-600'>
          Level
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden='true' />
        </span>
        <span className='block text-lg sm:text-xl md:text-2xl font-bold text-purple-700'>{level}</span>
      </button>
      {open && (
        <div
          role='menu'
          aria-label='Choose a level'
          className='absolute right-0 top-full z-30 mt-2 w-[min(21rem,calc(100vw_-_1.5rem))] rounded-2xl border border-gray-200 bg-white p-2 text-left shadow-xl'
        >
          <p className='px-3 pb-1 pt-1.5 text-sm font-bold text-gray-900'>Choose a level</p>
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
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${on ? 'bg-purple-50' : 'hover:bg-gray-50'}`}
              >
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${on ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-700'}`}
                >
                  {l.level}
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='block text-sm font-semibold text-gray-900'>{l.title}</span>
                  <span className='block truncate text-xs text-gray-600'>
                    {l.examples.join(', ')} · {l.count} words
                  </span>
                </span>
                {on && <Check className='h-4 w-4 shrink-0 text-purple-600' aria-hidden='true' />}
              </button>
            );
          })}
          <div className='mt-1 border-t border-gray-100 px-1 pt-1'>
            <button
              type='button'
              role='menuitem'
              onClick={copyLink}
              className='flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-50'
            >
              <LinkIcon className='h-3.5 w-3.5' aria-hidden='true' />
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
    <header className='bg-white shadow-md px-3 py-2 sm:px-4 sm:py-3'>
      <div className='max-w-7xl mx-auto flex items-center justify-between gap-3'>
        <div className='flex items-center gap-1 sm:gap-3'>
          <Link to='/' aria-label='All activities' className='rounded-full p-2 text-purple-700 hover:bg-purple-100'>
            <Home className='w-5 h-5' aria-hidden='true' />
          </Link>
          <h1 className='whitespace-nowrap text-lg sm:text-xl md:text-2xl font-bold text-purple-700'>Phoneme Pop!</h1>
          <button
            type='button'
            onClick={onToggleInstructions}
            aria-expanded={showInstructions}
            aria-controls='how-to-play'
            aria-label='How to play'
            className='flex items-center gap-1 rounded-full px-2 sm:px-3 py-1.5 text-sm font-semibold text-purple-700 hover:bg-purple-100 transition-colors'
          >
            <span className='hidden sm:inline'>How to play</span>
            <Chevron className='w-4 h-4' aria-hidden='true' />
          </button>
        </div>
        <div className='relative flex items-center gap-2.5 sm:gap-6'>
          <LevelPicker level={level} levels={levels} onChoose={onChooseLevel} />
          <Stat label='Score' value={score} tone='text-green-700' />
          <Stat label='Streak' value={streak} tone='text-orange-600'>
            {streak >= 3 && <Trophy className='w-4 h-4 sm:w-5 sm:h-5 text-orange-500' aria-label='On a roll!' />}
          </Stat>
        </div>
      </div>
    </header>
  );
}
