import { useEffect, useState } from 'react';
import { EDUCATIONAL_TIPS } from '../data/educationalTips.js';

const ROTATE_MS = 6000;
const TONE = { phonics: 'text-blue-800', encouragement: 'text-green-800', strategy: 'text-purple-800' };

export default function TipsCarousel() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % EDUCATIONAL_TIPS.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, []);

  const tip = EDUCATIONAL_TIPS[index];
  return (
    <div className='w-full max-w-md px-4'>
      <div className='rounded-lg bg-white/80 px-4 py-3 shadow-md backdrop-blur'>
        <p key={index} className={`text-center text-sm sm:text-base motion-safe:animate-pop ${TONE[tip.type] ?? 'text-gray-800'}`}>
          {tip.text}
        </p>
        <div className='mt-2 flex justify-center gap-1' aria-hidden='true'>
          {EDUCATIONAL_TIPS.map((_, i) => (
            <span key={i} className={`h-1 rounded-full transition-all duration-300 ${i === index ? 'w-3 bg-purple-500' : 'w-1 bg-gray-300'}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
