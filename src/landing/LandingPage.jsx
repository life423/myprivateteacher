import Photo from './Photo.jsx';
import LessonJoinForm from './LessonJoinForm.jsx';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, Gamepad2, Image as ImageIcon, LayoutGrid, Menu, PlayCircle, Users, Video, Volume2, X } from 'lucide-react';
import { Link } from '../router.jsx';
import AccountMenu from '../account/AccountMenu.jsx';
import SiteFooter from './SiteFooter.jsx';
import { hasAccess, signOut, useAccount } from '../account/account.js';

// The public home page: what My Private Teacher is, for the tutors who subscribe to it, with a
// quick way in for students who already have a lesson code.
const START = '/trial'; // a tutor starts the free trial: sign in, then Stripe Checkout

function Button({ to, kind = 'primary', compact = false, children, className = '' }) {
  const look =
    kind === 'primary'
      ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/25 hover:bg-violet-700'
      : kind === 'demo'
        ? 'border border-violet-200 bg-violet-50 text-violet-800 hover:border-violet-400 hover:bg-violet-100'
        : 'border border-slate-300 bg-white text-slate-800 hover:border-violet-400 hover:text-violet-700';
  const size = compact ? 'gap-1.5 whitespace-nowrap px-2.5 text-sm sm:gap-2 sm:px-5 sm:text-base' : 'gap-2 px-5 text-base';
  return (
    <Link to={to} className={`inline-flex min-h-12 items-center justify-center rounded-xl py-3 font-semibold transition-colors focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-violet-500 ${size} ${look} ${className}`}>
      {children}
    </Link>
  );
}

function Ticks({ items, className = '' }) {
  return (
    <ul className={`flex flex-col gap-2.5 ${className}`}>
      {items.map((item) => (
        <li key={item} className='flex items-start gap-3 text-slate-700'>
          <span className='mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700'>
            <Check className='h-3.5 w-3.5' strokeWidth={3} aria-hidden='true' />
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

const Eyebrow = ({ children }) => <p className='text-xs font-bold uppercase tracking-[0.14em] text-violet-700'>{children}</p>;

const FEATURES = [
  { icon: Video, tone: 'bg-violet-100 text-violet-700', title: 'Live, interactive lessons', text: 'See and hear each other while you teach on one shared board.' },
  { icon: LayoutGrid, tone: 'bg-violet-100 text-violet-700', title: 'Structured literacy tools', text: 'Letter tiles, sound boxes, the alphabet strip, and more.' },
  { icon: ImageIcon, tone: 'bg-violet-100 text-violet-700', title: 'Use your own materials', text: 'Add worksheets and pictures, then lift out just the part you need.' },
  { icon: Gamepad2, tone: 'bg-violet-100 text-violet-700', title: 'Engaging practice', text: 'Practice sounds with Phoneme Pop and letter order with Alphabet Bridge.' },
];

const STEPS = [
  { title: 'Start a lesson', text: 'Open your whiteboard and choose the materials you want to use.' },
  { title: 'Share the code', text: 'Your student enters a 4-digit code or opens your link. No account needed.' },
  { title: 'Teach together', text: 'Talk, move letters, and work through your materials on the same board.' },
];

const SECTIONS = [
  ['#features', 'Features'],
  ['#how-it-works', 'How it works'],
  ['#pricing', 'Pricing'],
];

export default function LandingPage() {
  const [menu, setMenu] = useState(false); // the phone menu
  const { tutor } = useAccount();
  const headerRef = useRef(null);
  const menuButtonRef = useRef(null);
  const anchorTimerRef = useRef(null);
  const joinFormRef = useRef(null);
  const accountPath = tutor ? '/account' : '/login';
  const accountLabel = tutor ? 'My account' : 'Sign in';
  const showSection = (event, selector, reveal) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setMenu(false);
    window.clearTimeout(anchorTimerRef.current);
    // Let the collapsing header settle before scrolling to the selected section.
    const delay = menu && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 220 : 0;
    anchorTimerRef.current = window.setTimeout(() => {
      const target = document.querySelector(selector);
      if (!target) return;
      if (window.location.hash !== selector) window.history.pushState(null, '', selector);
      reveal?.();
      requestAnimationFrame(() => target.scrollIntoView({ block: 'start', behavior: 'instant' }));
    }, delay);
  };
  const showJoinLesson = (event) => showSection(event, '#join-lesson', () => joinFormRef.current?.open());
  useEffect(() => () => window.clearTimeout(anchorTimerRef.current), []);
  useEffect(() => {
    if (!menu) return undefined;
    const closeOutside = (event) => {
      if (!headerRef.current?.contains(event.target)) setMenu(false);
    };
    const closeWithEscape = (event) => {
      if (event.key !== 'Escape') return;
      setMenu(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, [menu]);
  return (
    <div className='min-h-dvh bg-white text-slate-900'>
      <header ref={headerRef} className='sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur'>
        <nav aria-label='Main navigation' className='mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:gap-4 sm:px-6 lg:gap-6'>
          <Link to='/' className='flex min-h-11 min-w-0 items-center gap-2 font-bold text-slate-900 lg:gap-2.5'>
            <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white sm:h-9 sm:w-9'>
              <BookOpen className='h-5 w-5' aria-hidden='true' />
            </span>
            <span className='min-w-0 text-sm leading-tight sm:text-lg'>My Private Teacher</span>
          </Link>
          <div className='hidden items-center gap-6 text-sm font-medium text-slate-600 lg:flex'>
            <a href='#features' className='hover:text-violet-700'>Features</a>
            <a href='#how-it-works' className='hover:text-violet-700'>How it works</a>
            <a href='#pricing' className='hover:text-violet-700'>Pricing</a>
          </div>
          <div className='ml-auto hidden items-center gap-3 lg:flex'>
            {tutor ? (
              <AccountMenu tutor={tutor} />
            ) : (
              <Link to='/login' className='rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100'>
                Sign in
              </Link>
            )}
            <a href='#join-lesson' onClick={showJoinLesson} className='rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100'>
              Join a lesson
            </a>
            {hasAccess(tutor) && (
              <Link to='/whiteboard/teach' className='inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700'>
                Start teaching <ArrowRight className='h-4 w-4' aria-hidden='true' />
              </Link>
            )}
          </div>
          <Link
            to={accountPath}
            className='ml-auto inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 lg:hidden'
          >
            {accountLabel}
          </Link>
          <button
            ref={menuButtonRef}
            type='button'
            onClick={() => setMenu((was) => !was)}
            aria-expanded={menu}
            aria-controls='mobile-navigation'
            aria-label={menu ? 'Close menu' : 'Open menu'}
            className='inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 lg:hidden'
          >
            {menu ? <X className='h-6 w-6' aria-hidden='true' /> : <Menu className='h-6 w-6' aria-hidden='true' />}
          </button>
        </nav>
        <div
          id='mobile-navigation'
          aria-hidden={!menu}
          inert={!menu ? '' : undefined}
          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none lg:hidden ${menu ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
        >
          <div className='min-h-0 overflow-hidden'>
            <div className='max-h-[calc(100dvh-4.5rem)] overflow-y-auto border-t border-slate-200 bg-white px-4 pb-5 pt-2'>
              <div className='flex flex-col text-base font-medium text-slate-700'>
                {SECTIONS.map(([href, label]) => (
                  <a key={href} href={href} onClick={(event) => showSection(event, href)} className='rounded-lg px-2 py-3 hover:bg-slate-50'>
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
                <a href='#join-lesson' onClick={showJoinLesson} className='rounded-xl border border-slate-300 px-4 py-3 text-center font-semibold text-slate-700'>
                  Join a lesson
                </a>
                {hasAccess(tutor) && (
                  <Link to='/whiteboard/teach' className='flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white'>
                    Start teaching <ArrowRight className='h-4 w-4' aria-hidden='true' />
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className='bg-[#fcfbfe]'>
        <section className='relative overflow-hidden bg-gradient-to-b from-violet-50 via-[#fcfbfe] to-[#f8f6fc]'>
          <div className='pointer-events-none absolute -right-40 -top-32 h-[32rem] w-[32rem] rounded-full bg-violet-200/40 blur-3xl' aria-hidden='true' />
          <div className='relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-10 sm:gap-12 sm:px-6 sm:py-14 lg:grid-cols-[1fr_1.15fr] lg:py-20'>
            <div className='min-w-0'>
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
              <div className='mt-6 grid grid-cols-2 items-start gap-x-2 gap-y-2 sm:flex sm:flex-wrap sm:gap-3'>
                <Button to={START} compact className='min-w-0 sm:w-auto'>
                  Start free trial <ArrowRight className='h-4 w-4 shrink-0 sm:h-5 sm:w-5' aria-hidden='true' />
                </Button>
                <LessonJoinForm ref={joinFormRef} />
                <p className='order-3 col-span-full text-center text-xs leading-5 text-slate-600 sm:basis-full sm:text-left'>
                  14 days free · No credit card required
                </p>
              </div>
              <p className='text-center text-[13px] leading-5 text-slate-600 sm:text-left lg:hidden'>
                {tutor ? 'Welcome back. ' : 'Already have an account? '}
                <Link to={accountPath} className='inline-flex min-h-11 items-center rounded-lg px-1 font-semibold text-violet-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600'>
                  {accountLabel}
                </Link>
              </p>
            </div>
            <div className='rounded-[1.75rem] bg-slate-900 p-2 shadow-2xl shadow-violet-900/20 ring-1 ring-slate-900/10 sm:p-2.5'>
              <Photo
                name='whiteboard'
                width={1600}
                height={1000}
                first
                alt='The My Private Teacher whiteboard: letter tiles c a t, sound boxes, a mouth picture and the alphabet strip'
                className='block h-auto w-full rounded-[1.3rem] bg-slate-100'
              />
            </div>
          </div>
        </section>

        <div data-landing-chapters>
          <section id='features' aria-labelledby='features-title' data-landing-chapter className='scroll-mt-20 bg-gradient-to-b from-[#f8f6fc] to-[#f2eff9]'>
            <div className='mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14 lg:pb-24'>
              <div className='flex flex-col justify-between gap-4 border-t border-violet-200/80 pt-8 lg:flex-row lg:items-end lg:gap-12'>
                <div className='max-w-xl'>
                  <Eyebrow>Your lesson toolkit</Eyebrow>
                  <h2 id='features-title' className='mt-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl'>Keep the lesson in one place.</h2>
                </div>
                <p className='max-w-sm text-base leading-relaxed text-slate-600'>Move between conversation, letter work, and your own materials on one shared board.</p>
              </div>
              <div className='mt-8 grid overflow-hidden rounded-3xl border border-violet-200/80 bg-white shadow-sm shadow-violet-950/5 sm:grid-cols-2'>
                {FEATURES.map(({ icon: Icon, tone, title, text }, index) => (
                  <div key={title} className={`flex items-start gap-4 p-5 sm:p-7 lg:gap-5 lg:p-8 ${index ? 'border-t border-slate-200/80' : ''} ${index === 1 ? 'sm:border-t-0' : ''} ${index % 2 ? 'sm:border-l' : ''}`}>
                    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${tone}`}>
                      <Icon className='h-6 w-6' aria-hidden='true' />
                    </span>
                    <div>
                      <h3 className='text-lg font-bold leading-snug'>{title}</h3>
                      <p className='mt-2 max-w-sm text-sm leading-relaxed text-slate-600 sm:text-base'>{text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section aria-labelledby='activity-title' data-landing-chapter className='bg-gradient-to-b from-[#f2eff9] via-[#faf9fd] to-[#fcfbfe]'>
            <div className='mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24'>
              <div className='grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14'>
                <div className='order-2 min-w-0 rounded-[1.75rem] border border-violet-200 bg-white p-3 shadow-lg shadow-violet-950/5 sm:p-5 lg:order-1'>
                  <div className='mb-3 flex items-center gap-2 px-1 text-xs font-semibold text-slate-600 sm:mb-4'>
                    <Gamepad2 className='h-4 w-4 text-violet-700' aria-hidden='true' />
                    Inside the activity
                  </div>
                  <div className='overflow-hidden rounded-2xl border border-violet-100 bg-violet-50'>
                    <Photo
                      name='phoneme-pop'
                      width={1200}
                      height={780}
                      alt='Phoneme Pop with sound bubbles and c, short a, and t arranged to spell cat'
                      className='block h-auto w-full'
                    />
                  </div>
                </div>
                <div className='order-1 min-w-0 lg:order-2'>
                  <Eyebrow>Practice through play</Eyebrow>
                  <h2 id='activity-title' className='mt-3 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl'>Phoneme Pop</h2>
                  <p className='mt-3 text-xl font-semibold leading-snug text-slate-800'>Hear it. Break it apart. Build it again.</p>
                  <p className='mt-4 max-w-lg text-base leading-relaxed text-slate-600 sm:text-lg'>Help students hear the sounds in a word and put them back in order. Play together in a lesson, or try the activity yourself.</p>
                  <p className='mt-5 flex items-center gap-2 text-sm text-slate-600'>
                    <Volume2 className='h-4 w-4 shrink-0 text-violet-700' aria-hidden='true' />
                    Words read aloud · Choose your practice level
                  </p>
                  <div className='mt-7'>
                    <Button
                      to='/phoneme-pop'
                      kind='demo'
                      className='group min-h-14 w-full sm:w-auto'
                    >
                      <PlayCircle className='h-6 w-6 shrink-0' aria-hidden='true' />
                      Play Phoneme Pop
                      <ArrowRight className='h-5 w-5 shrink-0 transition-transform motion-safe:group-hover:translate-x-1 motion-reduce:transition-none' aria-hidden='true' />
                    </Button>
                    <p className='mt-3 text-center text-xs text-slate-600 sm:text-left'>Free to play. No sign-up needed.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id='how-it-works' aria-labelledby='steps-title' data-landing-chapter className='scroll-mt-20 bg-[#fcfbfe]'>
            <div className='mx-auto max-w-6xl border-y border-slate-200/80 px-4 py-16 sm:px-6 lg:py-20'>
              <div className='mx-auto max-w-xl text-center'>
                <Eyebrow>How it works</Eyebrow>
                <h2 id='steps-title' className='mt-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl'>Less setup. More teaching.</h2>
                <p className='mt-4 text-base leading-relaxed text-slate-600'>Three steps from opening the app to working together.</p>
              </div>
              <ol className='mt-10 grid gap-8 sm:mt-12 sm:grid-cols-3 sm:gap-10'>
                {STEPS.map(({ title, text }, index) => (
                  <li key={title} className='relative flex items-start gap-5 sm:block sm:text-center'>
                    {index < STEPS.length - 1 && <span className='absolute bottom-[-2rem] left-7 top-14 w-px bg-violet-200 sm:bottom-auto sm:left-[calc(50%+1.75rem)] sm:top-7 sm:h-px sm:w-[calc(100%-1rem)]' aria-hidden='true' />}
                    <span className='relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-violet-200 bg-white font-mono text-xl font-semibold text-violet-700 sm:mx-auto' aria-hidden='true'>{String(index + 1).padStart(2, '0')}</span>
                    <div className='pt-1 sm:mt-5 sm:pt-0'>
                      <h3 className='text-lg font-bold'>{title}</h3>
                      <p className='mt-2 max-w-xs text-sm leading-relaxed text-slate-600 sm:mx-auto sm:text-base'>{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section id='pricing' aria-labelledby='pricing-title' data-landing-chapter className='scroll-mt-20 bg-gradient-to-b from-[#fcfbfe] to-[#f2eefb]'>
            <div className='mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:py-24'>
              <div className='mx-auto max-w-xl text-center'>
                <Eyebrow>Simple pricing</Eyebrow>
                <h2 id='pricing-title' className='mt-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl'>One plan for every lesson.</h2>
                <p className='mt-4 text-base leading-relaxed text-slate-600'>All your teaching tools, with room for your own materials.</p>
              </div>
              <div className='relative mt-8 overflow-hidden rounded-3xl border border-violet-200 bg-white shadow-xl shadow-violet-950/5 sm:mt-10'>
                <div className='absolute inset-x-0 top-0 h-1 bg-violet-500' aria-hidden='true' />
                <div className='grid gap-7 p-6 pt-8 sm:gap-10 sm:p-8 sm:pt-10 md:grid-cols-[0.85fr_1.15fr] md:p-10'>
                  <div>
                    <div className='flex flex-wrap items-center gap-3'>
                      <h3 className='text-lg font-bold'>Tutor plan</h3>
                      <span className='rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800'>14-day free trial</span>
                    </div>
                    <p className='mt-5 flex items-baseline gap-2'>
                      <span className='text-6xl font-extrabold tracking-tight'>$19</span>
                      <span className='text-base text-slate-600'>/ month</span>
                    </p>
                    <p className='mt-4 flex items-center gap-2 text-sm font-medium text-slate-700'>
                      <Users className='h-5 w-5 shrink-0 text-violet-600' aria-hidden='true' />
                      Your students always join free.
                    </p>
                  </div>
                  <div className='border-t border-slate-200 pt-6 md:border-l md:border-t-0 md:pl-10 md:pt-0'>
                    <p className='text-xs font-bold uppercase tracking-wider text-slate-600'>Included in your plan</p>
                    <Ticks
                      className='mt-4 text-sm'
                      items={['Unlimited lessons', 'All whiteboard tools', 'Phoneme Pop and Alphabet Bridge', 'Use your own materials', 'Students join with a code, no accounts']}
                    />
                  </div>
                </div>
                <div className='flex flex-col items-center justify-between gap-4 border-t border-violet-100 bg-violet-50/50 px-6 py-5 sm:flex-row sm:gap-6 sm:px-8 md:px-10'>
                  <div className='order-2 text-center sm:order-1 sm:text-left'>
                    <p className='text-sm font-semibold text-slate-700'>Make room for your next lesson.</p>
                    <p className='mt-1 text-xs text-slate-600'>14 days free · No credit card required</p>
                  </div>
                  <Button to={START} compact className='order-1 w-full shrink-0 sm:order-2 sm:w-auto'>
                    Start 14-day free trial <ArrowRight className='h-5 w-5 shrink-0' aria-hidden='true' />
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
