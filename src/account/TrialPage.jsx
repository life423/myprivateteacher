import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check } from 'lucide-react';
import { Link, navigate } from '../router.jsx';
import GoogleButton from './GoogleButton.jsx';
import { planActive, startCheckout, useAccount } from './account.js';

// Start the free trial: sign in with Google, then Stripe Checkout (no card needed to start).
// A tutor already on the plan goes straight to teaching.
export default function TrialPage() {
  const { loading, tutor, googleClientId, trialDays } = useAccount();
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (loading || !tutor || started.current) return;
    started.current = true;
    if (!trialDays || planActive(tutor.plan)) {
      navigate('/whiteboard/teach'); // billing not switched on yet, or already on the plan
      return;
    }
    startCheckout().then((message) => {
      if (message) {
        setError(message);
        started.current = false;
      }
    });
  }, [loading, tutor, trialDays]);

  return (
    <main className='flex min-h-dvh items-center justify-center bg-gradient-to-b from-violet-50 to-white px-4 py-12'>
      <div className='w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-200'>
        <Link to='/' className='inline-flex items-center gap-2.5 font-bold text-slate-900'>
          <span className='flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white'>
            <BookOpen className='h-5 w-5' aria-hidden='true' />
          </span>
          My Private Teacher
        </Link>
        <h1 className='mt-8 text-2xl font-extrabold text-slate-900'>Start your free trial</h1>
        <ul className='mx-auto mt-4 grid max-w-xs gap-2 text-left text-slate-700'>
          {[`${trialDays || 14} days free`, 'No credit card required', '$19/month after, cancel anytime'].map((line) => (
            <li key={line} className='flex items-center gap-2'>
              <Check className='h-4 w-4 shrink-0 text-violet-600' aria-hidden='true' />
              {line}
            </li>
          ))}
        </ul>
        <div className='mt-6'>
          {loading ? (
            <p className='text-sm text-slate-500'>One moment…</p>
          ) : tutor ? (
            error ? (
              <button
                type='button'
                onClick={() => {
                  if (started.current) return;
                  started.current = true;
                  setError(null);
                  startCheckout().then((message) => {
                    setError(message);
                    if (message) started.current = false;
                  });
                }}
                className='w-full rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white hover:bg-violet-700'
              >
                Try again
              </button>
            ) : (
              <p className='text-sm font-semibold text-slate-600'>Taking you to secure checkout…</p>
            )
          ) : googleClientId ? (
            <>
              <p className='mb-3 text-sm text-slate-600'>First, sign in so your trial is saved to your account.</p>
              <GoogleButton clientId={googleClientId} />
            </>
          ) : (
            <p className='rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800'>Sign-in isn’t switched on yet.</p>
          )}
          {error && (
            <p role='alert' className='mt-3 text-sm font-semibold text-rose-700'>
              {error}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
