import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, CreditCard, LogIn, Sparkles } from 'lucide-react';
import { Link } from '../router.jsx';
import GoogleButton from './GoogleButton.jsx';
import { openBilling, refreshAccount, startCheckout, useAccount } from './account.js';

// The tutor's way into a lesson. Once billing is on, starting one needs a signed-in tutor with a
// current trial or plan; instead of the board, this says what's missing and offers the one step
// that fixes it. (The server checks the same thing.) Rejoining a lesson already under way, after a
// reload, is never stopped. Students never see this: they join with a code.
const SAVED_LESSON = 'wb-tutor';

function Card({ icon: Icon, title, children }) {
  return (
    <main className='flex min-h-dvh items-center justify-center bg-gradient-to-b from-violet-50 to-white px-4 py-12'>
      <div className='w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-200'>
        <Link to='/' className='inline-flex items-center gap-2.5 font-bold text-slate-900'>
          <span className='flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white'>
            <BookOpen className='h-5 w-5' aria-hidden='true' />
          </span>
          My Private Teacher
        </Link>
        {Icon && <Icon className='mx-auto mt-8 h-10 w-10 text-violet-600' aria-hidden='true' />}
        {title && <h1 className='mt-4 text-2xl font-extrabold text-slate-900'>{title}</h1>}
        {children}
        <p className='mt-8 flex items-center justify-center gap-3 text-sm text-slate-500'>
          <Link to='/' className='inline-flex items-center gap-1 font-semibold hover:text-slate-700'>
            <ArrowLeft className='h-4 w-4' aria-hidden='true' />
            Home
          </Link>
          <span aria-hidden='true'>·</span>
          <Link to='/terms' className='hover:text-slate-700'>
            Terms
          </Link>
          <span aria-hidden='true'>·</span>
          <Link to='/privacy' className='hover:text-slate-700'>
            Privacy
          </Link>
        </p>
      </div>
    </main>
  );
}

// What's missing, and the one button that fixes it.
export function LessonGate({ reason }) {
  const { tutor, googleClientId, trialDays } = useAccount();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(null);
  const open = (go) => {
    if (opening) return;
    setOpening(true);
    setError(null);
    go().then((message) => {
      if (message) {
        setError(message);
        setOpening(false);
      }
    });
  };
  const days = trialDays || 14;

  if (reason === 'sign-in' || !tutor) {
    return (
      <Card icon={LogIn} title='Sign in to start teaching'>
        <p className='mt-2 text-slate-600'>Your lessons and plan are saved to your account, so they follow you to any device.</p>
        <div className='mt-6'>
          {googleClientId ? <GoogleButton clientId={googleClientId} /> : <p className='text-sm text-slate-500'>Sign-in isn’t switched on yet.</p>}
          <p className='mt-4 text-xs leading-5 text-slate-500'>
                By continuing, you agree to our{' '}
                <Link to='/terms' className='underline underline-offset-2 hover:text-slate-700'>
                  Terms
                </Link>{' '}
                and{' '}
                <Link to='/privacy' className='underline underline-offset-2 hover:text-slate-700'>
                  Privacy Policy
                </Link>
                .
              </p>
        </div>
        <p className='mt-4 text-sm text-slate-500'>Students don’t need an account: they join with your lesson code.</p>
      </Card>
    );
  }

  if (reason === 'unavailable') {
    return (
      <Card title='We couldn’t check your plan'>
        <p className='mt-2 text-slate-600'>That’s on our side. Please try again in a moment.</p>
        <button
          type='button'
          onClick={() => window.location.reload()}
          className='mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white hover:bg-violet-700'
        >
          Try again
        </button>
      </Card>
    );
  }

  const ended = Boolean(tutor.plan);
  return (
    <Card icon={Sparkles} title={ended ? 'Your plan has ended' : 'Start your free trial to teach'}>
      <p className='mt-2 text-slate-600'>
        {ended
          ? 'Subscribe to keep teaching: $19/month, cancel anytime. Your account is just as you left it.'
          : `${days} days free, no credit card required. Then $19/month, cancel anytime.`}
      </p>
      <div className='mt-6 grid gap-2'>
        <button
          type='button'
          disabled={opening}
          onClick={() => open(startCheckout)}
          className='inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white hover:bg-violet-700 disabled:opacity-60'
        >
          <Sparkles className='h-5 w-5' aria-hidden='true' />
          {opening ? 'Opening…' : ended ? 'Subscribe for $19/month' : `Start ${days}-day free trial`}
        </button>
        {ended && tutor.billingAccount && (
          <button
            type='button'
            disabled={opening}
            onClick={() => open(openBilling)}
            className='inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60'
          >
            <CreditCard className='h-5 w-5' aria-hidden='true' />
            Manage billing
          </button>
        )}
      </div>
      {error && (
        <p role='alert' className='mt-3 text-sm font-semibold text-rose-700'>
          {error}
        </p>
      )}
    </Card>
  );
}

// Wraps the tutor's lesson: checks first (with fresh account details), then opens the board.
export default function TeachGate({ children }) {
  const { lesson } = useAccount();
  const [checked, setChecked] = useState(false);
  const resuming = typeof sessionStorage !== 'undefined' && Boolean(sessionStorage.getItem(SAVED_LESSON));
  useEffect(() => {
    if (resuming) return;
    refreshAccount().then(() => setChecked(true));
  }, [resuming]);
  if (resuming) return children;
  if (!checked) return <Card><p className='mt-8 text-sm font-semibold text-slate-600'>One moment…</p></Card>;
  if (!lesson.ok) return <LessonGate reason={lesson.reason} />;
  return children;
}
