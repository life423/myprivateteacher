import { ChevronLeft, ChevronRight } from 'lucide-react';

// The games go round like a merry-go-round: the one at the front is the one in use, and the
// arrows (or a dot) turn the ring to the next. Each game is { id, title, content }.
const RADIUS = 280; // px from the middle of the ring out to each card

export default function GameCarousel({ games, active, onTurn }) {
  const n = games.length;
  const step = 360 / n;
  const wrap = (i) => ((i % n) + n) % n;

  return (
    <div className='flex flex-col gap-3 px-4 py-3'>
      <div className='relative mx-auto h-[20rem] w-full max-w-sm' style={{ perspective: '1100px' }}>
        <div
          className='absolute inset-0 transition-transform duration-700 ease-in-out motion-reduce:transition-none'
          style={{ transformStyle: 'preserve-3d', transform: `translateZ(${-RADIUS}px) rotateY(${-active * step}deg)` }}
        >
          {games.map((game, i) => (
            <section
              key={game.id}
              aria-label={`${game.title}, ${i + 1} of ${n}`}
              aria-hidden={i !== active}
              className='absolute inset-x-0 top-0 mx-auto flex max-h-full w-[min(100%,20rem)] flex-col overflow-y-auto rounded-3xl bg-white p-4 shadow-lg ring-1 ring-slate-200'
              style={{ transform: `rotateY(${i * step}deg) translateZ(${RADIUS}px)`, backfaceVisibility: 'hidden' }}
            >
              <h3 className='mb-2 text-lg font-bold text-slate-900'>{game.title}</h3>
              {game.content}
            </section>
          ))}
        </div>
      </div>

      <div className='flex items-center justify-center gap-3'>
        <button
          type='button'
          aria-label='Previous game'
          onClick={() => onTurn(wrap(active - 1))}
          className='rounded-full bg-white p-2 text-slate-700 shadow hover:bg-slate-50'
        >
          <ChevronLeft className='h-5 w-5' aria-hidden='true' />
        </button>
        {games.map((game, i) => (
          <button
            key={game.id}
            type='button'
            aria-label={`Show ${game.title}`}
            aria-current={i === active}
            onClick={() => onTurn(i)}
            className={`h-2.5 rounded-full transition-all ${i === active ? 'w-6 bg-violet-600' : 'w-2.5 bg-slate-300 hover:bg-slate-400'}`}
          />
        ))}
        <button
          type='button'
          aria-label='Next game'
          onClick={() => onTurn(wrap(active + 1))}
          className='rounded-full bg-white p-2 text-slate-700 shadow hover:bg-slate-50'
        >
          <ChevronRight className='h-5 w-5' aria-hidden='true' />
        </button>
      </div>
    </div>
  );
}
