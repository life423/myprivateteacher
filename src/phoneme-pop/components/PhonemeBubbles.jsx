import { Volume2, X } from 'lucide-react';
import { phonemeSymbols } from '../data/phonemeSymbols.js';

const FEEDBACK_TEXT = {
  'wrong-order': 'Check your order and try again!',
  incomplete: 'Use all the sounds!',
};

export default function PhonemeBubbles({ tiles, selected, feedback, locked, onTileClick, onCheck, onHearWord }) {
  return (
    <div className='w-full flex flex-col items-center gap-4 sm:gap-5'>
      <div className='flex items-center gap-3'>
        <p className='text-center text-base sm:text-lg font-semibold text-purple-700'>Put the sounds back in order!</p>
        <button
          type='button'
          onClick={onHearWord}
          aria-label='Hear the word again'
          className='rounded-full bg-white p-2 text-purple-600 shadow hover:bg-purple-50'
        >
          <Volume2 className='w-5 h-5' aria-hidden='true' />
        </button>
      </div>

      <div className='flex flex-wrap items-start justify-center gap-3 sm:gap-6 md:gap-8'>
        {tiles.map((tile, i) => {
          const isSelected = selected.some((t) => t.id === tile.id);
          const visual = phonemeSymbols[tile.sound];
          return (
            <button
              key={tile.id}
              type='button'
              disabled={locked}
              aria-pressed={isSelected}
              aria-label={visual ? `${tile.sound}, as in ${visual.hint}` : tile.sound}
              onClick={() => onTileClick(tile)}
              className='flex flex-col items-center gap-1 motion-safe:animate-pop disabled:cursor-default'
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <span className='h-9 sm:h-10 text-2xl sm:text-3xl' aria-hidden='true'>{visual?.symbol}</span>
              <span
                className={`rounded-full px-6 py-4 sm:px-8 sm:py-5 text-2xl sm:text-3xl font-bold text-white shadow-xl transition-transform ${
                  isSelected
                    ? 'scale-105 bg-gradient-to-br from-green-600 to-green-700 ring-4 ring-green-300'
                    : 'bg-gradient-to-br from-blue-500 to-sky-600 hover:scale-105'
                }`}
              >
                {tile.sound}
              </span>
              <span className='hidden sm:block text-sm font-medium text-gray-700' aria-hidden='true'>{visual?.hint}</span>
            </button>
          );
        })}
      </div>

      <div className={`flex min-h-[4.5rem] flex-col items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-lg sm:flex-row sm:gap-4 ${feedback ? 'ring-4 ring-red-300' : ''}`}>
        <div className='flex min-w-[6rem] flex-wrap items-center justify-center gap-2 text-2xl font-bold text-gray-800'>
          {selected.length === 0 ? (
            <span className='text-base font-medium text-gray-500'>Tap the sounds in order</span>
          ) : (
            selected.map((t, idx) => (
              <span key={t.id} className='flex items-center'>
                {t.sound}
                {idx < selected.length - 1 && <span className='mx-1 text-gray-400' aria-hidden='true'>→</span>}
              </span>
            ))
          )}
        </div>
        <button
          type='button'
          onClick={onCheck}
          disabled={locked || selected.length === 0}
          className='whitespace-nowrap rounded-full bg-green-700 px-6 py-2 text-base font-bold text-white transition-colors hover:bg-green-800 disabled:opacity-40'
        >
          Check word
        </button>
        <p role='status' className='flex items-center gap-1 text-sm sm:text-base font-semibold text-red-700 empty:hidden'>
          {feedback ? (
            <>
              <X className='w-5 h-5' aria-hidden='true' />
              {FEEDBACK_TEXT[feedback]}
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
