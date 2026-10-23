import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useGameState } from '../game/useGameState.js';
import { checkAnswer, makeTiles, pickNextWord, randomItem, shuffleTiles } from '../game/logic.js';
import { BUILT_IN, rememberLevel, useWordBank, wantedLevel } from '../game/wordBank.js';
import { speak } from '../speechUtils.js';
import GameHeader from './GameHeader.jsx';
import InstructionsPanel from './InstructionsPanel.jsx';
import WordBubble from './WordBubble.jsx';
import TipsCarousel from './TipsCarousel.jsx';
import PhonemeBubbles from './PhonemeBubbles.jsx';
import CelebrationOverlay from './CelebrationOverlay.jsx';
import ProgressBar from './ProgressBar.jsx';

const CELEBRATION_MS = 1800;
const FEEDBACK_MS = 1600;

// The how-to panel opens on first load for wide screens only; after that it's the player's call.
const opensByDefault = () => window.matchMedia('(min-width: 768px)').matches;

export default function PhonemeSeparationGame() {
  const bank = useWordBank();
  const [want] = useState(wantedLevel); // the level asked for (a link, or last time); may be only in the server's bank
  const [state, dispatch] = useGameState({ level: BUILT_IN.words[want] ? want : 1, lists: BUILT_IN.words });
  const [showInstructions, setShowInstructions] = useState(opensByDefault);
  const { word, phase, tiles, selected, feedback, level, score, streak, solved } = state;
  const settled = useRef(false); // the starting level is decided (or the player picked one)

  const chooseLevel = (next) => {
    const list = bank.words[next];
    if (list?.length) dispatch({ type: 'chooseLevel', level: next, word: randomItem(list) });
  };

  // A level only the server's bank has (a link to level 4, say) starts as soon as the bank arrives.
  useEffect(() => {
    if (settled.current || !bank.words[want]?.length) return;
    settled.current = true;
    if (want !== level) chooseLevel(want);
  }, [bank]);

  // A ?level= link is used once; after that the device remembers the level being played.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('level')) return;
    url.searchParams.delete('level');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);
  useEffect(() => rememberLevel(level), [level]);

  const goToNextWord = () => {
    const next = pickNextWord({ level, solved, currentWord: word }, Math.random, bank.words);
    if (next.levelUp) speak(`Level ${next.level}!`);
    dispatch({ type: 'next', next });
  };

  // Timers live in effects, so moving to another word cancels them automatically.
  useEffect(() => {
    if (phase !== 'celebrating') return undefined;
    const timer = setTimeout(goToNextWord, CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [phase, word]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = setTimeout(() => dispatch({ type: 'clearFeedback' }), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [feedback, dispatch]);

  const splitWord = () => {
    speak(word.word);
    dispatch({ type: 'split', tiles: shuffleTiles(makeTiles(word)) });
  };

  const check = () => {
    const result = checkAnswer(selected, word);
    if (result === 'correct') {
      dispatch({ type: 'correct' });
      speak(`${word.word}! Great job!`);
    } else {
      dispatch({ type: 'miss', reason: result });
      speak(result === 'incomplete' ? 'Use all the sounds.' : 'Check your order. Try again!');
    }
  };

  return (
    <div className='min-h-dvh flex flex-col bg-gradient-to-b from-blue-50 to-purple-50'>
      <GameHeader
        showInstructions={showInstructions}
        onToggleInstructions={() => setShowInstructions((open) => !open)}
        level={level}
        levels={bank.levels}
        onChooseLevel={(next) => {
          settled.current = true;
          chooseLevel(next);
        }}
        score={score}
        streak={streak}
      />
      {showInstructions && <InstructionsPanel onClose={() => setShowInstructions(false)} />}

      <main className='relative flex-1 flex flex-col items-center justify-center gap-4 px-3 py-4 sm:py-6'>
        {phase === 'word' ? (
          <>
            <WordBubble key={word.word} word={word} onSplit={splitWord} />
            <TipsCarousel />
          </>
        ) : (
          <PhonemeBubbles
            tiles={tiles}
            selected={selected}
            feedback={feedback}
            locked={phase === 'celebrating'}
            onTileClick={(tile) => dispatch({ type: 'toggleTile', tile })}
            onCheck={check}
            onHearWord={() => speak(word.word)}
          />
        )}
        <CelebrationOverlay show={phase === 'celebrating'} />
      </main>

      <footer className='bg-white border-t px-3 py-2 sm:px-4 sm:py-3'>
        <div className='max-w-7xl mx-auto flex items-center gap-4'>
          <ProgressBar level={level} solvedCount={solved.size} total={bank.words[level]?.length ?? 0} />
          {phase !== 'word' && (
            <button
              type='button'
              onClick={goToNextWord}
              className='flex items-center gap-2 whitespace-nowrap rounded-full border-2 border-purple-600 px-4 py-2 text-sm sm:text-base font-bold text-purple-700 hover:bg-purple-50'
            >
              <RefreshCw className='w-4 h-4' aria-hidden='true' />
              Next word
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
