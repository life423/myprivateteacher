// The bridge itself: planks with letters, gaps to fill, and the tray of letters to pick from.
// Used by the tutor, the student and solo practice, so all three look and behave the same.
// Everything is a tap: pick a letter, then tap a gap (no dragging, so it works on any touch screen).
export default function BridgeBoard({ game, selected, onSelect, onPlace }) {
  if (!game) {
    return <p className='py-16 text-center text-lg text-slate-600'>Waiting for your tutor to start the bridge…</p>;
  }
  const done = game.slots.every((slot) => game.placed[slot] !== undefined);
  const { miss } = game;

  return (
    <div className='flex flex-col items-center gap-8'>
      <div className='relative w-full overflow-hidden rounded-3xl bg-gradient-to-b from-sky-200 to-sky-400 px-4 pb-10 pt-12 shadow-inner'>
        <ol className='relative z-10 flex flex-wrap items-end justify-center gap-2 sm:gap-3' aria-label='The bridge'>
          {game.letters.split('').map((letter, i) => {
            const gap = game.slots.includes(i);
            if (!gap) {
              return (
                <li key={i} className='flex h-20 w-14 items-center justify-center rounded-xl bg-amber-700 text-4xl font-bold text-amber-50 shadow sm:w-16'>
                  {letter}
                </li>
              );
            }
            const placed = game.placed[i];
            if (placed !== undefined) {
              return (
                <li key={i} className='flex h-20 w-14 items-center justify-center rounded-xl bg-emerald-600 text-4xl font-bold text-white shadow sm:w-16'>
                  {placed}
                </li>
              );
            }
            const wrongHere = miss && miss.slot === i;
            return (
              <li key={i}>
                <button
                  type='button'
                  onClick={() => selected && onPlace(i, selected)}
                  aria-label={selected ? `Gap ${i + 1}: put ${selected} here` : `Gap ${i + 1}: pick a letter first`}
                  className={`flex h-20 w-14 items-center justify-center rounded-xl border-4 border-dashed bg-white/80 text-4xl font-bold sm:w-16 ${
                    selected ? 'border-amber-500 text-amber-700 hover:bg-white' : 'border-amber-700/60 text-slate-400'
                  } ${wrongHere ? 'ring-4 ring-rose-400' : ''}`}
                >
                  {wrongHere ? miss.letter : '?'}
                </button>
              </li>
            );
          })}
        </ol>
        {/* The water under the deck */}
        <div className='pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-sky-600/40' aria-hidden='true' />
      </div>

      <p role='status' aria-live='polite' className='min-h-[1.75rem] text-center text-lg font-semibold'>
        {done ? (
          <span className='text-emerald-700'>🎉 The bridge is built! Well done.</span>
        ) : miss ? (
          <span className='text-rose-700'>That isn’t {miss.letter}. Have another look.</span>
        ) : selected ? (
          <span className='text-slate-700'>Now tap a gap to put {selected} there.</span>
        ) : (
          <span className='text-slate-600'>Tap a letter, then the gap it belongs in.</span>
        )}
      </p>

      <div className='flex flex-wrap justify-center gap-3' aria-label='Letters to choose from'>
        {game.tray.map((letter) => {
          const picked = selected === letter;
          return (
            <button
              key={letter}
              type='button'
              aria-pressed={picked}
              onClick={() => onSelect(picked ? null : letter)}
              className={`h-16 w-16 rounded-2xl text-3xl font-bold shadow transition sm:h-20 sm:w-20 sm:text-4xl ${
                picked ? 'scale-110 bg-violet-600 text-white ring-4 ring-violet-300' : 'bg-white text-violet-700 hover:bg-violet-50'
              }`}
            >
              {letter}
            </button>
          );
        })}
      </div>
    </div>
  );
}
