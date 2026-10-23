import { X } from 'lucide-react';
import MarkedText from './MarkedText.jsx';

export default function InstructionsPanel({ onClose }) {
  return (
    <section id='how-to-play' className='bg-blue-100 border-b-2 border-blue-200 px-3 py-3 sm:px-4'>
      <div className='relative max-w-7xl mx-auto pr-10'>
        <h2 className='mb-2 text-base sm:text-lg font-bold text-blue-900'>How to play</h2>
        <ol className='list-decimal list-inside space-y-1 text-sm sm:text-base text-blue-900'>
          <li>Tap the big word to hear it and split it into sounds.</li>
          <li>Tap the sounds <strong>in the order you hear them</strong> in the word.</li>
          <li>Each sound has a picture to help you remember it.</li>
          <li>Tap 🔊 to hear the word again.</li>
          <li>Press Check word when you're done. Harder levels give more points!</li>
          <li>Tap <strong>Level</strong> at the top to choose your level.</li>
        </ol>
        <div className='mt-3 hidden sm:flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg bg-white px-3 py-2 text-base text-gray-800'>
          <span className='font-semibold text-blue-900'>Reading helper marks:</span>
          <span><strong className='text-xl'>ă</strong> = short a (căt)</span>
          <span><strong className='text-xl'>ā</strong> = long a (cāke)</span>
          <span><strong className='text-xl'><MarkedText text='[sh]' /></strong> = one sound</span>
        </div>
        <button
          type='button'
          onClick={onClose}
          aria-label='Close how to play'
          className='absolute right-0 top-0 rounded-full p-1.5 text-blue-900 hover:bg-blue-200'
        >
          <X className='w-5 h-5' aria-hidden='true' />
        </button>
      </div>
    </section>
  );
}
