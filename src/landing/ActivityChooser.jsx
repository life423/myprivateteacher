import { Link } from '../router.jsx';

const ACTIVITIES = [
  {
    to: '/phoneme-pop',
    emoji: '🎯',
    title: 'Phoneme Pop',
    text: 'Hear a word, split it into its sounds, and put them back in order.',
    tone: 'from-purple-500 to-pink-500',
  },
  {
    to: '/whiteboard',
    emoji: '✋',
    title: 'Alphabet Whiteboard',
    text: 'Point to letters on a shared alphabet strip while your tutor watches live.',
    tone: 'from-sky-500 to-violet-600',
  },
];

export default function ActivityChooser() {
  return (
    <div className='min-h-dvh bg-gradient-to-b from-blue-50 to-purple-50'>
      <header className='mx-auto max-w-4xl px-4 pt-10 sm:pt-16'>
        <p className='text-sm font-bold uppercase tracking-widest text-purple-700'>My Private Teacher</p>
        <h1 className='mt-2 text-3xl sm:text-4xl font-bold text-slate-900'>Choose an activity</h1>
      </header>
      <main className='mx-auto grid max-w-4xl gap-6 px-4 py-8 sm:grid-cols-2'>
        {ACTIVITIES.map((activity) => (
          <Link
            key={activity.to}
            to={activity.to}
            className='group rounded-3xl bg-white p-6 sm:p-8 shadow-lg ring-1 ring-slate-100 transition hover:-translate-y-1 hover:shadow-xl focus-visible:outline focus-visible:outline-4 focus-visible:outline-purple-400'
          >
            <span className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${activity.tone} text-3xl shadow`} aria-hidden='true'>
              {activity.emoji}
            </span>
            <h2 className='mt-4 text-2xl font-bold text-slate-900'>{activity.title}</h2>
            <p className='mt-2 text-base text-slate-600'>{activity.text}</p>
            <span className='mt-4 inline-block font-bold text-purple-700 group-hover:underline'>Start →</span>
          </Link>
        ))}
      </main>
    </div>
  );
}
