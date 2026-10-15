import { useState } from 'react';
import { ArrowRight, BookOpen, Check, Gamepad2, Image as ImageIcon, LayoutGrid, Link2, Menu, MonitorPlay, PlayCircle, Users, Video, X } from 'lucide-react';
import { Link } from '../router.jsx';
import AccountMenu from '../account/AccountMenu.jsx';
import { signOut, useAccount } from '../account/account.js';

// The public home page: what My Private Teacher is, for the tutors who subscribe to it, with a
// quick way in for students who already have a lesson code.
const START = '/whiteboard/teach'; // a tutor starts a lesson
const JOIN = '/whiteboard'; // a student types their code

function Button({ to, kind = 'primary', children, className = '' }) {
  const look =
    kind === 'primary'
      ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/25 hover:bg-violet-700'
      : 'border border-slate-300 bg-white text-slate-800 hover:border-violet-400 hover:text-violet-700';
  return (
    <Link to={to} className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold transition-colors ${look} ${className}`}>
      {children}
    </Link>
  );
}

function Ticks({ items, className = '' }) {
  return (
    <ul className={`flex flex-col gap-2.5 ${className}`}>
      {items.map((item) => (
        <li key={item} className='flex items-start gap-3 text-slate-700'>
          <span className='mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white'>
            <Check className='h-3.5 w-3.5' strokeWidth={3} aria-hidden='true' />
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

const Eyebrow = ({ children }) => <p className='text-xs font-bold uppercase tracking-[0.14em] text-violet-600'>{children}</p>;

const FEATURES = [
  { icon: Video, tone: 'bg-violet-100 text-violet-600', title: 'Live, interactive lessons', text: 'See and hear each other while you teach on one shared board.' },
  { icon: LayoutGrid, tone: 'bg-emerald-100 text-emerald-600', title: 'Structured literacy tools', text: 'Letter tiles, sound boxes, the alphabet strip, and more.' },
  { icon: ImageIcon, tone: 'bg-orange-100 text-orange-500', title: 'Use your own materials', text: 'Add worksheets and pictures, then lift out just the part you need.' },
  { icon: Gamepad2, tone: 'bg-pink-100 text-pink-500', title: 'Engaging practice', text: 'Phoneme Pop sound practice, with more activities on the way.' },
];

const STEPS = [
  { icon: PlayCircle, title: 'Start a lesson', text: 'Open My Private Teacher and start a lesson in one click.' },
  { icon: Link2, title: 'Share the code', text: 'Your student types a 4-digit code or opens your link. No account needed.' },
  { icon: MonitorPlay, title: 'Teach together', text: 'Use the whiteboard, tiles, pictures and video, live.' },
];

const SECTIONS = [
  ['#features', 'Features'],
  ['#how-it-works', 'How it works'],
  ['#pricing', 'Pricing'],
];

export default function LandingPage() {
  const [menu, setMenu] = useState(false); // the phone menu
  const { tutor } = useAccount();
  return (
    <div className='min-h-dvh bg-white text-slate-900'>
      <header className='sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur'>
        <nav className='mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6'>
          <Link to='/' className='flex items-center gap-2.5 font-bold text-slate-900'>
            <span className='flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white'>
              <BookOpen className='h-5 w-5' aria-hidden='true' />
            </span>
            <span className='text-lg'>My Private Teacher</span>
          </Link>
          <div className='hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex'>
            <a href='#features' className='hover:text-violet-700'>Features</a>
            <a href='#how-it-works' className='hover:text-violet-700'>How it works</a>
            <a href='#pricing' className='hover:text-violet-700'>Pricing</a>
          </div>
          <div className='ml-auto hidden items-center gap-3 md:flex'>
            {tutor ? (
              <AccountMenu tutor={tutor} />
            ) : (
              <Link to='/login' className='rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100'>
                Sign in
              </Link>
            )}
            <Link to={JOIN} className='rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100'>
              Join a lesson
            </Link>
            <Link to={START} className='inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700'>
              Start free trial <ArrowRight className='h-4 w-4' aria-hidden='true' />
            </Link>
          </div>
          <button
            type='button'
            onClick={() => setMenu((was) => !was)}
            aria-expanded={menu}
            aria-label={menu ? 'Close menu' : 'Open menu'}
            className='ml-auto rounded-xl p-2 text-slate-700 hover:bg-slate-100 md:hidden'
          >
            {menu ? <X className='h-6 w-6' aria-hidden='true' /> : <Menu className='h-6 w-6' aria-hidden='true' />}
          </button>
        </nav>
        {menu && (
          <div className='border-t border-slate-200 bg-white px-4 pb-5 pt-2 md:hidden'>
            <div className='flex flex-col text-base font-medium text-slate-700'>
              {SECTIONS.map(([href, label]) => (
                <a key={href} href={href} onClick={() => setMenu(false)} className='rounded-lg px-2 py-3 hover:bg-slate-50'>
                  {label}
                </a>
              ))}
            </div>
            <div className='mt-3 grid gap-2'>
              {tutor ? (
                <button
                  type='button'
                  onClick={() => {
                    setMenu(false);
                    signOut();
                  }}
                  className='rounded-xl px-4 py-3 text-center font-semibold text-slate-700 hover:bg-slate-50'
                >
                  Log out ({tutor.name || tutor.email})
                </button>
              ) : (
                <Link to='/login' className='rounded-xl px-4 py-3 text-center font-semibold text-slate-700 hover:bg-slate-50'>
                  Sign in
                </Link>
              )}
              <Link to={JOIN} className='rounded-xl border border-slate-300 px-4 py-3 text-center font-semibold text-slate-700'>
                Join a lesson
              </Link>
              <Link to={START} className='flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white'>
                Start free trial <ArrowRight className='h-4 w-4' aria-hidden='true' />
              </Link>
            </div>
          </div>
        )}
      </header>

      <main>
        <section className='relative overflow-hidden bg-gradient-to-b from-violet-50 via-white to-white'>
          <div className='pointer-events-none absolute -right-40 -top-32 h-[32rem] w-[32rem] rounded-full bg-violet-200/40 blur-3xl' aria-hidden='true' />
          <div className='relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:py-20'>
            <div>
              <Eyebrow>Built for dyslexia tutors</Eyebrow>
              <h1 className='mt-4 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]'>
                A live lesson workspace for <span className='text-violet-600'>structured literacy</span>
              </h1>
              <p className='mt-5 max-w-xl text-lg leading-relaxed text-slate-600'>
                Teach phonics, spelling, and reading in a shared, interactive space with tools designed for dyslexia instruction.
              </p>
              <Ticks
                className='mt-6 hidden sm:flex'
                items={['Live whiteboard with video', 'Letter tiles, sound boxes, and manipulatives', 'Use your own worksheets and pictures', 'Engaging activities like Phoneme Pop']}
              />
              <div className='mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap'>
                <Button to={START} className='w-full sm:w-auto'>
                  Start free trial <ArrowRight className='h-5 w-5' aria-hidden='true' />
                </Button>
                <Button to={JOIN} kind='secondary' className='hidden sm:inline-flex'>
                  <Users className='h-5 w-5 text-violet-600' aria-hidden='true' /> Join a lesson
                </Button>
              </div>
              <p className='mt-4 text-center text-sm text-slate-500 sm:text-left'>
                <span className='sm:hidden'>No credit card required</span>
                <span className='hidden sm:inline'>Free during early access · No credit card required · Designed for one-to-one tutoring</span>
              </p>
              <p className='mt-3 text-center text-sm sm:hidden'>
                <Link to={JOIN} className='font-semibold text-violet-700'>
                  Joining a lesson? Enter your code →
                </Link>
              </p>
            </div>
            <div className='rounded-[1.75rem] bg-slate-900 p-2 shadow-2xl shadow-violet-900/20 ring-1 ring-slate-900/10 sm:p-2.5'>
              <img
                src='/landing/whiteboard.jpg'
                width='1600'
                height='1000'
                alt='The My Private Teacher whiteboard: letter tiles c a t, sound boxes, a mouth picture and the alphabet strip'
                className='block h-auto w-full rounded-[1.3rem] bg-slate-100'
              />
            </div>
          </div>
        </section>

        <section id='features' className='scroll-mt-16 border-y border-slate-100 bg-slate-50/60'>
          <h2 className='mx-auto max-w-6xl px-4 pt-12 text-3xl font-extrabold tracking-tight sm:px-6 lg:hidden'>Everything you need for engaging lessons</h2>
          <div className='mx-auto grid max-w-6xl gap-3 px-4 pb-12 pt-6 sm:grid-cols-2 sm:gap-8 sm:px-6 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-slate-200 lg:py-12'>
            {FEATURES.map(({ icon: Icon, tone, title, text }) => (
              <div
                key={title}
                className='flex gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:block sm:bg-transparent sm:p-0 sm:shadow-none sm:ring-0 lg:px-6 lg:first:pl-0 lg:last:pr-0'
              >
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>
                  <Icon className='h-6 w-6' aria-hidden='true' />
                </span>
                <div>
                  <h3 className='text-base font-bold sm:mt-4'>{title}</h3>
                  <p className='mt-1 text-slate-600 sm:mt-1.5'>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className='mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24'>
          <div className='order-2 overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-950 to-violet-800 p-2.5 shadow-xl lg:order-1'>
            <img
              src='/landing/phoneme-pop.jpg'
              width='1600'
              height='1105'
              loading='lazy'
              alt='Phoneme Pop: a word to split into its sounds'
              className='block h-auto w-full rounded-2xl'
            />
          </div>
          <div className='order-1 lg:order-2'>
            <Eyebrow>Interactive activities</Eyebrow>
            <h2 className='mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl'>Make practice fun and effective</h2>
            <p className='mt-4 text-lg leading-relaxed text-slate-600'>
              Phoneme Pop helps students hear a word, break it into its sounds, and put them back in the right order.
            </p>
            <Ticks
              className='mt-6'
              items={['Builds phonemic awareness', 'Every word is read aloud', 'Levels up as students improve', 'Coming soon: launch it during a live lesson']}
            />
            <Link to='/phoneme-pop' className='mt-8 inline-flex items-center gap-2 font-semibold text-violet-700 hover:text-violet-800'>
              Try Phoneme Pop <ArrowRight className='h-4 w-4' aria-hidden='true' />
            </Link>
          </div>
        </section>

        <section id='how-it-works' className='scroll-mt-16 bg-slate-50/60'>
          <div className='mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_2fr] lg:items-center'>
            <div>
              <h2 className='text-3xl font-extrabold tracking-tight sm:text-4xl'>How it works</h2>
              <p className='mt-3 text-lg text-slate-600'>Get started in minutes and start teaching.</p>
            </div>
            <ol className='grid gap-8 sm:grid-cols-3'>
              {STEPS.map(({ icon: Icon, title, text }, i) => (
                <li key={title} className='relative flex items-start gap-4 sm:block sm:text-center'>
                  <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-700 sm:mx-auto'>{i + 1}</span>
                  <span className='flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-violet-600 shadow-sm ring-1 ring-slate-200 sm:mx-auto sm:mt-4'>
                    <Icon className='h-7 w-7' aria-hidden='true' />
                  </span>
                  <div className='pt-1 sm:pt-0'>
                    <h3 className='font-bold sm:mt-4'>{title}</h3>
                    <p className='mt-1 text-sm text-slate-600'>{text}</p>
                  </div>
                  {i < STEPS.length - 1 && (
                    <ArrowRight className='absolute -right-6 top-[4.6rem] hidden h-5 w-5 text-slate-300 sm:block' aria-hidden='true' />
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id='pricing' className='scroll-mt-16 mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24'>
          <div>
            <Eyebrow>Simple pricing</Eyebrow>
            <h2 className='mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl'>Simple pricing for tutors</h2>
            <p className='mt-3 text-lg text-slate-600'>Everything you need to run effective, engaging lessons. Your students join free.</p>
          </div>
          <div className='rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8'>
            <div className='flex flex-wrap items-start justify-between gap-6'>
              <div>
                <Eyebrow>Tutor plan</Eyebrow>
                <p className='mt-2 flex items-baseline gap-1'>
                  <span className='text-4xl font-extrabold'>$19</span>
                  <span className='text-slate-500'>/ month</span>
                </p>
                <p className='mt-1 inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700'>Free during early access</p>
              </div>
              <div className='hidden flex-col items-center gap-2 sm:flex'>
                <Button to={START}>
                  Start free trial <ArrowRight className='h-5 w-5' aria-hidden='true' />
                </Button>
                <span className='text-xs text-slate-500'>No credit card required</span>
              </div>
            </div>
            <Ticks
              className='mt-6 text-sm'
              items={['Unlimited lessons', 'All whiteboard tools', 'Phoneme Pop and future activities', 'Use your own materials', 'Students join with a code, no accounts']}
            />
            <div className='mt-6 sm:hidden'>
              <Button to={START} className='w-full'>
                Start free trial <ArrowRight className='h-5 w-5' aria-hidden='true' />
              </Button>
              <p className='mt-2 text-center text-xs text-slate-500'>No credit card required</p>
            </div>
          </div>
          <div className='rounded-3xl bg-violet-50 p-6 text-center lg:hidden'>
            <Users className='mx-auto h-8 w-8 text-violet-600' aria-hidden='true' />
            <h3 className='mt-3 font-bold'>Perfect for one-to-one tutoring</h3>
            <p className='mt-1 text-sm text-slate-600'>Designed specifically for dyslexia tutors and structured literacy instruction.</p>
          </div>
        </section>

        <section className='relative overflow-hidden bg-gradient-to-b from-white to-violet-50'>
          <div className='mx-auto max-w-3xl px-4 py-20 text-center sm:px-6'>
            <BookOpen className='mx-auto mb-6 h-14 w-14 text-violet-500' strokeWidth={1.5} aria-hidden='true' />
            <h2 className='text-3xl font-extrabold tracking-tight sm:text-4xl'>Help more students become confident readers</h2>
            <p className='mt-3 text-lg text-slate-600'>A powerful, easy-to-use workspace designed for dyslexia tutors.</p>
            <Button to={START} className='mt-8 w-full sm:w-auto'>
              Start free trial <ArrowRight className='h-5 w-5' aria-hidden='true' />
            </Button>
            <p className='mt-3 text-sm text-slate-500'>No credit card required</p>
          </div>
        </section>
      </main>

      <footer className='border-t border-slate-200 bg-white'>
        <div className='mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-slate-500 sm:px-6'>
          <span>© {new Date().getFullYear()} My Private Teacher</span>
          <Link to={JOIN} className='hover:text-violet-700'>Join a lesson</Link>
          <Link to='/phoneme-pop' className='hover:text-violet-700'>Phoneme Pop</Link>
          <Link to='/activities' className='hover:text-violet-700'>All activities</Link>
        </div>
      </footer>
    </div>
  );
}
