import { MAX_DISTRACTORS, MAX_GAPS, MAX_LENGTH, MIN_LENGTH } from '../../shared/bridge.js';

const options = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// The tutor's panel for the bridge: what to build, and how to help. Turned on and off from the tools.
export default function BridgeControls({ bridge, actionsFirst = false }) {
  const { game, settings, changeSettings, showNext, start, stop } = bridge;

  if (!game) {
    return (
      <div className='flex flex-col items-start gap-3'>
        <p className='text-base text-slate-700'>
          Fill in the missing letters together, one gap at a time.
        </p>
        <button type='button' onClick={start} className='min-h-11 rounded-full bg-violet-600 px-5 py-2 font-bold text-white shadow hover:bg-violet-700'>
          Start the bridge
        </button>
      </div>
    );
  }

  const actions = (
      <div className='flex flex-wrap gap-3'>
        <button type='button' onClick={showNext} className='min-h-11 rounded-full bg-amber-500 px-5 py-2 font-bold text-white shadow hover:bg-amber-600'>
          Show me the next gap
        </button>
        <button type='button' onClick={start} className='min-h-11 rounded-full bg-violet-600 px-5 py-2 font-bold text-white shadow hover:bg-violet-700'>
          New bridge
        </button>
        <button type='button' onClick={stop} className='min-h-11 rounded-full border-2 border-slate-300 px-5 py-2 font-bold text-slate-700 hover:bg-slate-50'>
          Put the bridge away
        </button>
      </div>
  );

  return (
    <div className='flex flex-col gap-4'>
      {actionsFirst && actions}
      <div className='grid gap-4 sm:grid-cols-3'>
        <label className='flex flex-col gap-1 text-sm font-semibold text-slate-700'>
          Letters in the row
          <select
            value={settings.length}
            onChange={(e) => changeSettings({ length: Number(e.target.value) })}
            className='rounded-xl border-2 border-slate-200 px-3 py-2 text-base font-normal'
          >
            {options(MIN_LENGTH, MAX_LENGTH).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className='flex flex-col gap-1 text-sm font-semibold text-slate-700'>
          Missing letters
          <select
            value={settings.gaps}
            onChange={(e) => changeSettings({ gaps: Number(e.target.value) })}
            className='rounded-xl border-2 border-slate-200 px-3 py-2 text-base font-normal'
          >
            {options(1, Math.min(MAX_GAPS, settings.length - 1)).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className='flex flex-col gap-1 text-sm font-semibold text-slate-700'>
          Extra letters to avoid
          <select
            value={settings.distractors}
            onChange={(e) => changeSettings({ distractors: Number(e.target.value) })}
            className='rounded-xl border-2 border-slate-200 px-3 py-2 text-base font-normal'
          >
            {options(0, MAX_DISTRACTORS).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      {!actionsFirst && actions}
    </div>
  );
}
