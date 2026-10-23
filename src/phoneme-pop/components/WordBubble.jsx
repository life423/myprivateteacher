import { Volume2 } from 'lucide-react';
import MarkedText from './MarkedText.jsx';

export default function WordBubble({ word, onSplit }) {
  return (
    <button
      type='button'
      onClick={onSplit}
      aria-label={`Hear ${word.word} and split it into sounds`}
      className='relative group motion-safe:animate-pop'
    >
      <span className='absolute inset-0 rounded-full bg-purple-400 blur-xl opacity-30 group-hover:opacity-50 transition-opacity' aria-hidden='true' />
      <span className='relative block rounded-full bg-gradient-to-br from-purple-500 to-pink-500 px-10 py-6 md:px-14 md:py-8 text-4xl md:text-5xl font-bold text-white shadow-2xl transition-transform group-hover:scale-105'>
        <MarkedText text={word.display} markClassName='underline decoration-4 underline-offset-8' />
      </span>
      <Volume2 className='absolute -top-2 -right-2 h-9 w-9 rounded-full bg-white p-1.5 text-purple-600 shadow' aria-hidden='true' />
    </button>
  );
}
