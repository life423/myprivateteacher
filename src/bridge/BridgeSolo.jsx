import { useEffect, useState } from 'react';
import { TopBar } from '../whiteboard/ui.jsx';
import BridgeBoard from './BridgeBoard.jsx';
import { applyAct, newRound } from '../../shared/bridge.js';

// Practice on your own, with no tutor. The same bridge as a lesson, at three levels.
const LEVELS = [
  { name: 'Easy', settings: { length: 4, gaps: 1, distractors: 0 } },
  { name: 'Medium', settings: { length: 5, gaps: 2, distractors: 1 } },
  { name: 'Hard', settings: { length: 7, gaps: 3, distractors: 2 } },
];

export default function BridgeSolo() {
  const [level, setLevel] = useState(0);
  const [game, setGame] = useState(() => newRound(LEVELS[0].settings));
  const [selected, setSelected] = useState(null);
  const done = game.slots.every((slot) => game.placed[slot] !== undefined);

  const newBridge = (i) => {
    setLevel(i);
    setGame(newRound(LEVELS[i].settings));
    setSelected(null);
  };
  const place = (slot, letter) => {
    const next = applyAct(game, { a: 'place', slot, letter });
    setGame(next);
    if (next.placed[slot] !== undefined) setSelected(null);
  };
  // A letter that has just been placed can't be picked any more
  useEffect(() => {
    if (selected && !game.tray.includes(selected)) setSelected(null);
  }, [game, selected]);

  return (
    <div className='min-h-dvh bg-gradient-to-b from-sky-50 to-violet-50'>
      <TopBar back='/bridge' title='Alphabet Bridge' />
      <main className='mx-auto max-w-3xl px-4 py-8'>
        <div className='flex flex-wrap items-center justify-center gap-2' role='group' aria-label='Level'>
          {LEVELS.map((l, i) => (
            <button
              key={l.name}
              type='button'
              aria-pressed={level === i}
              onClick={() => newBridge(i)}
              className={`rounded-full px-5 py-2 font-bold shadow ${level === i ? 'bg-violet-600 text-white' : 'bg-white text-violet-700 hover:bg-violet-50'}`}
            >
              {l.name}
            </button>
          ))}
        </div>

        <div className='mt-8'>
          <BridgeBoard game={game} selected={selected} onSelect={setSelected} onPlace={place} />
        </div>

        {done && (
          <div className='mt-8 text-center'>
            <button
              type='button'
              onClick={() => newBridge(level)}
              className='rounded-full bg-emerald-600 px-6 py-3 text-lg font-bold text-white shadow hover:bg-emerald-700'
            >
              Build another bridge
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
