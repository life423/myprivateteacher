import { RefreshCw } from 'lucide-react';
import WordBubble from './WordBubble.jsx';
import TipsCarousel from './TipsCarousel.jsx';
import PhonemeBubbles from './PhonemeBubbles.jsx';
import CelebrationOverlay from './CelebrationOverlay.jsx';
import ProgressBar from './ProgressBar.jsx';

// The game's board: the word, then its sounds to put in order, then the progress. It only shows the
// state it's given and reports taps as intents (see shared/phoneme.js); it doesn't run the game.
export default function PhonemeBoard({ state, total, onIntent }) {
  const { word, phase, tiles, selected, feedback, level, solved } = state;

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <main className='relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-3 py-4 sm:py-6'>
        {phase === 'word' ? (
          <>
            <WordBubble key={word.word} word={word} onSplit={() => onIntent({ type: 'split' })} />
            <TipsCarousel />
          </>
        ) : (
          <PhonemeBubbles
            tiles={tiles}
            selected={selected}
            feedback={feedback}
            locked={phase === 'celebrating'}
            onTileClick={(tile) => onIntent({ type: 'toggleTile', id: tile.id })}
            onCheck={() => onIntent({ type: 'check' })}
            onHearWord={() => onIntent({ type: 'hear' })}
          />
        )}
        <CelebrationOverlay show={phase === 'celebrating'} />
      </main>

      <footer className='border-t bg-white px-3 py-2 sm:px-4 sm:py-3'>
        <div className='mx-auto flex max-w-7xl items-center gap-4'>
          <ProgressBar level={level} solvedCount={solved.size} total={total} />
          {phase !== 'word' && (
            <button
              type='button'
              onClick={() => onIntent({ type: 'next' })}
              className='flex items-center gap-2 whitespace-nowrap rounded-full border-2 border-purple-600 px-4 py-2 text-sm font-bold text-purple-700 hover:bg-purple-50 sm:text-base'
            >
              <RefreshCw className='h-4 w-4' aria-hidden='true' />
              Next word
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
