import { useState } from 'react';
import { BookOpen, CreditCard, LogOut, PlayCircle, ShieldCheck, Sparkles } from 'lucide-react';
import { Link, navigate } from '../router.jsx';
import { Avatar } from './AccountMenu.jsx';
import GoogleButton from './GoogleButton.jsx';
import { accessLabel, hasAccess, openBilling, signOut, startCheckout, useAccount } from './account.js';

// Sign in, for tutors. Students join a lesson with a code and never need an account.
export default function LoginPage() {
  const { loading, tutor, googleClientId, trialDays } = useAccount();
  const [billingError, setBillingError] = useState(null);
  const [opening, setOpening] = useState(false); // waiting for Stripe: one click is enough
  const openStripe = (open) => {
    if (opening) return;
    setOpening(true);
    setBillingError(null);
    open().then((message) => {
      setBillingError(message);
      if (message) setOpening(false); // on success the page is already leaving for Stripe
    });
  };
  return (
    <main className='flex min-h-dvh items-center justify-center bg-gradient-to-b from-violet-50 to-white px-4 py-12'>
      <div className='w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-200'>
        <Link to='/' className='inline-flex items-center gap-2.5 font-bold text-slate-900'>
          <span className='flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white'>
            <BookOpen className='h-5 w-5' aria-hidden='true' />
          </span>
          My Private Teacher
        </Link>
        {tutor ? (
          <>
            <div className='mt-8 flex flex-col items-center gap-3'>
              <Avatar tutor={tutor} size={64} />
              <div>
                <p className='text-sm text-slate-500'>Signed in as</p>
                <p className='text-lg font-extrabold text-slate-900'>{tutor.name || tutor.email}</p>
                <p className='text-sm text-slate-500'>{tutor.email}</p>
              </div>
              {trialDays && (
                <p className={`rounded-full px-3 py-1 text-sm font-semibold ${hasAccess(tutor) ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                  {accessLabel(tutor)}
                </p>
              )}
            </div>
            <div className='mt-6 grid gap-2'>
              <Link to='/whiteboard/teach' className='inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white hover:bg-violet-700'>
                <PlayCircle className='h-5 w-5' aria-hidden='true' />
                Start teaching
              </Link>
              {tutor.owner && (
                <Link to='/admin' className='inline-flex items-center justify-center gap-2 rounded-xl border border-violet-300 px-4 py-3 font-semibold text-violet-700 hover:bg-violet-50'>
                  <ShieldCheck className='h-5 w-5' aria-hidden='true' />
                  Admin panel
                </Link>
              )}
              {trialDays && (tutor.billingAccount && tutor.plan ? (
                <button
                  type='button'
                  disabled={opening}
                  onClick={() => openStripe(openBilling)}
                  className='inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60'
                >
                  <CreditCard className='h-5 w-5' aria-hidden='true' />
                  {opening ? 'Opening…' : 'Manage billing'}
                </button>
              ) : !hasAccess(tutor) && (
                <button
                  type='button'
                  disabled={opening}
                  onClick={() => openStripe(startCheckout)}
                  className='inline-flex items-center justify-center gap-2 rounded-xl border border-violet-300 px-4 py-3 font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-60'
                >
                  <Sparkles className='h-5 w-5' aria-hidden='true' />
                  {opening ? 'Opening…' : `Start ${trialDays}-day free trial`}
                </button>
              ))}
              {billingError && (
                <p role='alert' className='text-sm font-semibold text-rose-700'>
                  {billingError}
                </p>
              )}
              <button
                type='button'
                onClick={() => signOut()}
                className='inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50'
              >
                <LogOut className='h-5 w-5' aria-hidden='true' />
                Log out
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className='mt-8 text-2xl font-extrabold text-slate-900'>Sign in</h1>
            <p className='mt-2 text-slate-600'>For tutors. Students join a lesson with a code and never need an account.</p>
            <div className='mt-6'>
              {loading ? (
                <p className='text-sm text-slate-500'>One moment…</p>
              ) : googleClientId ? (
                <>
                  <GoogleButton clientId={googleClientId} onSignedIn={() => navigate('/whiteboard')} />
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
                </>
              ) : (
                <p className='rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800'>Sign-in isn’t switched on yet.</p>
              )}
            </div>
            <p className='mt-6 text-sm text-slate-500'>
              Joining a lesson?{' '}
              <Link to='/whiteboard' className='font-semibold text-violet-700 hover:underline'>
                Enter your code
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
