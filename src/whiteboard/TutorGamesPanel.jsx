import { useLayoutEffect, useRef } from 'react';
import BridgeControls from '../bridge/BridgeControls.jsx';

// One chooser owns both games. Active controls move first in DOM and keyboard
// order; the other choices keep their usual order.
export default function TutorGamesPanel({ bridge, phoneme, startBridge, startPhoneme, visible }) {
  const panel = useRef(null);
  const startedFrom = useRef(null);
  const active = phoneme.active ? 'phoneme' : bridge.game ? 'bridge' : null;
  const order = active === 'phoneme' ? ['phoneme', 'bridge'] : ['bridge', 'phoneme'];
  const start = (event, action, id) => { startedFrom.current = active === id ? null : event.currentTarget; action(); };

  useLayoutEffect(() => {
    if (!visible || !active) return undefined;
    const frame = requestAnimationFrame(() => {
      const section = panel.current?.querySelector(`[data-game-id="${active}"]`);
      if (!section) return;
      // Bridge's inactive start control is replaced by its playing controls.
      // Preserve the Phoneme toggle if it survives, otherwise focus the first
      // playing control rather than leaving keyboard focus on the document.
      const previous = startedFrom.current;
      if (previous) {
        const control = previous.isConnected ? previous : section.querySelector('button:not(:disabled), select:not(:disabled)');
        control?.focus({ preventScroll: true });
        startedFrom.current = null;
      }
      section.scrollIntoView({ block: 'start', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, active]);

  return (
    <div ref={panel} aria-label='Game choices' className='flex flex-col gap-4 p-3'>
      {!active && <div>
        <h2 className='text-lg font-bold text-slate-900'>Choose a game</h2>
        <p className='mt-1 text-sm text-slate-600'>Start an activity on both lesson screens.</p>
      </div>}
      {order.map((id) => (
        <section key={id} data-game-id={id} data-active-game={active === id ? 'true' : 'false'} className='scroll-mt-24 rounded-2xl bg-white p-4 shadow ring-1 ring-slate-200'>
          <h3 className='mb-3 text-lg font-bold text-slate-900'>{id === 'bridge' ? 'Alphabet Bridge' : 'Phoneme Pop'}</h3>
          {id === 'bridge' ? (
            <BridgeControls actionsFirst={Boolean(bridge.game)} bridge={{ ...bridge, start: (event) => start(event, startBridge, 'bridge') }} />
          ) : (
            <div className='flex flex-col items-start gap-3'>
              <div role='group' aria-label='Phoneme Pop actions' className='flex flex-wrap gap-2'>
                {phoneme.active && <button key='next' type='button' onClick={() => phoneme.act({ type: 'showNext' })} disabled={phoneme.state.phase !== 'tiles'} className='min-h-11 rounded-full bg-amber-500 px-4 py-2 font-bold text-white shadow hover:bg-amber-600 disabled:opacity-40'>Show me the next sound</button>}
                <button key='toggle' type='button' onClick={phoneme.active ? phoneme.stop : (event) => start(event, startPhoneme, 'phoneme')} className='min-h-11 rounded-full border-2 border-violet-600 px-4 py-2 font-bold text-violet-700 hover:bg-violet-50'>
                  {phoneme.active ? 'Put Phoneme Pop away' : 'Start Phoneme Pop'}
                </button>
              </div>
              {phoneme.active ? (
                <div role='group' aria-label='Level' className='flex flex-wrap gap-2'>
                  {phoneme.bank.levels.map((level) => <button key={level.level} type='button' aria-pressed={phoneme.state.level === level.level} onClick={() => phoneme.act({ type: 'chooseLevel', level: level.level })} className={`min-h-11 rounded-full px-4 py-2 text-sm font-bold ${phoneme.state.level === level.level ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-violet-50'}`}>Level {level.level}</button>)}
                </div>
              ) : <p className='text-base text-slate-700'>Hear the word, split it into its sounds, and put them back in order.</p>}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
