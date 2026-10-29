import LandingDialog from './LandingDialog.jsx';

export default function LessonDemoDialog({ open, onClose, returnFocusRef }) {
  return (
    <LandingDialog open={open} onClose={onClose} returnFocusRef={returnFocusRef} title='A 30-second lesson preview' wide>
      <div className='p-3 sm:p-5'>
        <video width={960} height={600} controls autoPlay muted playsInline preload='metadata' poster='/landing/lesson-demo-poster.jpg' aria-label='30-second demonstration of letter tiles, sound boxes, and Magic Select' className='aspect-[8/5] max-h-[60dvh] w-full rounded-xl object-contain border border-slate-200 bg-slate-50'>
          <source src='/landing/lesson-demo.webm' type='video/webm' />
          <track kind='captions' src='/landing/lesson-demo.vtt' srcLang='en' label='English' default />
          Your browser does not support this video. Read the transcript below.
        </video>
        <details className='mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700'>
          <summary className='min-h-6 cursor-pointer font-semibold text-violet-800'>Video transcript</summary>
          <div className='mt-3 space-y-2 leading-relaxed'>
            <p><strong>Letter tiles:</strong> Move c, a, and t into three sound boxes to build cat. You can drag, or select a letter and then a box.</p>
            <p><strong>Sound boxes:</strong> Tap one box for each sound. Ship has three sounds, even though it has four letters.</p>
            <p><strong>Magic Select:</strong> Select a picture on a practice page and add just that part to the board.</p>
          </div>
        </details>
      </div>
    </LandingDialog>
  );
}
