import { useEffect, useState } from 'react';
import { usePhonemeGame } from '../game/usePhonemeGame.js';
import GameHeader from './GameHeader.jsx';
import InstructionsPanel from './InstructionsPanel.jsx';
import PhonemeBoard from './PhonemeBoard.jsx';

// The how-to panel opens on first load for wide screens only; after that it's the player's call.
const opensByDefault = () => window.matchMedia('(min-width: 768px)').matches;

export default function PhonemeSeparationGame() {
  const { state, bank, act } = usePhonemeGame();
  const [showInstructions, setShowInstructions] = useState(opensByDefault);

  // A ?level= link is used once; after that the device remembers the level being played.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('level')) return;
    url.searchParams.delete('level');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);

  return (
    <div className='min-h-dvh flex flex-col bg-gradient-to-b from-blue-50 to-purple-50'>
      <GameHeader
        showInstructions={showInstructions}
        onToggleInstructions={() => setShowInstructions((open) => !open)}
        level={state.level}
        levels={bank.levels}
        onChooseLevel={(level) => act({ type: 'chooseLevel', level })}
        score={state.score}
        streak={state.streak}
      />
      {showInstructions && <InstructionsPanel onClose={() => setShowInstructions(false)} />}
      <div className='flex min-h-0 flex-1 flex-col'>
        <PhonemeBoard state={state} total={bank.words[state.level]?.length ?? 0} onIntent={act} />
      </div>
    </div>
  );
}
