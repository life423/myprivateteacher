import { Star } from 'lucide-react';

const STARS = [0, 1, 2, 3, 4];

export default function CelebrationOverlay({ show }) {
  if (!show) return null;
  return (
    <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
      <span className='sr-only' role='status'>Correct!</span>
      <span className='text-6xl motion-safe:animate-bounce' aria-hidden='true'>🎉</span>
      {STARS.map((i) => (
        <Star
          key={i}
          aria-hidden='true'
          className='absolute h-7 w-7 sm:h-9 sm:w-9 fill-yellow-300 text-yellow-400 motion-safe:animate-pulse'
          style={{ top: `${20 + i * 15}%`, left: `${10 + i * 20}%`, animationDelay: `${i * 100}ms` }}
        />
      ))}
    </div>
  );
}
