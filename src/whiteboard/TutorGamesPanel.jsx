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
    <div ref={panel} aria-label='Game choices' className='flex flex-col gap-3 p-3'>
      {!active && <div>
        <h3 className='text-sm font-bold text-slate-900'>Choose a game</h3>
        <p className='mt-1 text-xs leading-relaxed text-slate-600'>Start an activity on both lesson screens.</p>
      </div>}
      {order.map((id) => (
        <section key={id} data-game-id={id} data-active-game={active === id ? 'true' : 'false'} className='scroll-mt-3 rounded-xl border border-slate-200 bg-white p-3'>
          <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
            <h3 className='text-base font-bold text-slate-900'>{id === 'bridge' ? 'Alphabet Bridge' : 'Phoneme Pop'}</h3>
            {active === id && <span className='inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600'><span className='h-2 w-2 rounded-full bg-[#F4B544]' aria-hidden='true' />Playing</span>}
          </div>
          {id === 'bridge' ? (
            <BridgeControls actionsFirst={Boolean(bridge.game)} bridge={{ ...bridge, start: (event) => start(event, startBridge, 'bridge') }} />
          ) : (
            <div className='flex flex-col items-start gap-3'>
              {phoneme.active && <div role='group' aria-label='Level' className='grid w-full grid-cols-2 gap-2'>
                {phoneme.bank.levels.map((level) => <button key={level.level} type='button' aria-pressed={phoneme.state.level === level.level} onClick={() => phoneme.act({ type: 'chooseLevel', level: level.level })} className={`min-h-11 rounded-lg px-3 py-2 text-sm font-bold ${phoneme.state.level === level.level ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-violet-50'}`}>Level {level.level}</button>)}
              </div>}
              <div role='group' aria-label='Phoneme Pop actions' className='flex flex-wrap gap-2'>
                {phoneme.active && <button key='next' type='button' onClick={() => phoneme.act({ type: 'showNext' })} disabled={phoneme.state.phase !== 'tiles'} className='min-h-11 rounded-full bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-40'>Show me the next sound</button>}
                <button key='toggle' type='button' onClick={phoneme.active ? phoneme.stop : (event) => start(event, startPhoneme, 'phoneme')} className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold ${phoneme.active ? 'border border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-violet-600 text-white hover:bg-violet-700'}`}>
                  {phoneme.active ? 'Put Phoneme Pop away' : 'Start Phoneme Pop'}
                </button>
              </div>
              {!phoneme.active && <p className='text-sm leading-relaxed text-slate-600'>Hear the word, split it into its sounds, and put them back in order.</p>}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
