import Photo from './Photo.jsx';

const STEPS = [
  { title: 'Prepare your materials', text: 'Choose picture cards and letter tools, or bring a worksheet you already use.', photo: 'walkthrough-prepare', alt: 'My Private Teacher picture library showing complete articulation cards with Add face and View controls' },
  { title: 'Share the lesson code', text: 'Send your student the 4-digit code. They join your lesson without an account.', photo: 'walkthrough-share', alt: 'The lesson header with a 4-digit room code and the Copy lesson link control' },
  { title: 'Teach together', text: 'Talk through the task while you and your student move letters and pictures on the shared board.', photo: 'walkthrough-teach', alt: 'The shared whiteboard with c, a, and t arranged in sound boxes alongside a mouth picture' },
];

export default function LessonWalkthrough() {
  return (
    <section id='features' aria-labelledby='walkthrough-title' data-landing-chapter className='scroll-mt-20 bg-gradient-to-b from-[#f8f6fc] to-[#f2eff9]'>
      <div id='how-it-works' className='mx-auto max-w-6xl scroll-mt-24 px-4 pb-16 pt-10 sm:px-6 sm:pt-14 lg:pb-24'>
        <div className='flex flex-col justify-between gap-4 border-t border-violet-200/80 pt-8 lg:flex-row lg:items-end lg:gap-12'>
          <div className='max-w-xl'>
            <p className='text-xs font-bold uppercase tracking-[0.14em] text-violet-700'>Your lesson, from start to finish</p>
            <h2 id='walkthrough-title' className='mt-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl'>See how a lesson comes together.</h2>
          </div>
          <p className='max-w-sm text-base leading-relaxed text-slate-600'>Bring your teaching approach. Keep the tools and materials together.</p>
        </div>
        <ol className='mt-8 grid gap-8 sm:mt-10 md:grid-cols-3 md:gap-5 lg:gap-7'>
          {STEPS.map(({ title, text, photo, alt }, index) => <li key={photo} className='min-w-0'>
            <div className='overflow-hidden rounded-2xl border border-violet-200 bg-white p-2 shadow-sm shadow-violet-950/5'>
              <Photo name={photo} width={900} height={640} alt={alt} className='block aspect-[45/32] w-full rounded-xl object-cover' />
            </div>
            <div className='mt-4 flex items-start gap-3'>
              <span className='mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-800' aria-hidden='true'>{index + 1}</span>
              <div><h3 className='text-lg font-bold leading-snug'>{title}</h3><p className='mt-2 text-sm leading-relaxed text-slate-600'>{text}</p></div>
            </div>
          </li>)}
        </ol>
      </div>
    </section>
  );
}
