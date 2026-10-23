import { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, PlayCircle } from 'lucide-react';
import { Link } from '../router.jsx';
import { planActive, planLabel, refreshAccount } from './account.js';

// Back from Stripe Checkout: confirm with Stripe, then welcome the tutor.
export default function BillingDonePage() {
  const [plan, setPlan] = useState(undefined);
  const [error, setError] = useState(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('session_id') || '';
    fetch(`/api/billing/done?session_id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Could not confirm your plan yet.');
        setPlan(data.plan);
        refreshAccount();
      })
      .catch((e) => setError(e.message));
  }, []);
  const trial = plan?.status === 'trialing';
  return (
    <main className='flex min-h-dvh items-center justify-center bg-gradient-to-b from-violet-50 to-white px-4 py-12'>
      <div className='w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-200'>
        <Link to='/' className='inline-flex items-center gap-2.5 font-bold text-slate-900'>
          <span className='flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white'>
            <BookOpen className='h-5 w-5' aria-hidden='true' />
          </span>
          My Private Teacher
        </Link>
        {error ? (
          <>
            <h1 className='mt-8 text-xl font-extrabold text-slate-900'>Almost there</h1>
            <p className='mt-2 text-slate-600'>{error}</p>
            <Link to='/account' className='mt-6 inline-block font-semibold text-violet-700 hover:underline'>
              Check your account
            </Link>
          </>
        ) : plan === undefined ? (
          <p className='mt-8 text-sm font-semibold text-slate-600'>Confirming with Stripe…</p>
        ) : (
          <>
            <CheckCircle2 className='mx-auto mt-8 h-14 w-14 text-emerald-500' aria-hidden='true' />
            <h1 className='mt-4 text-2xl font-extrabold text-slate-900'>
              {trial ? 'Your free trial has started' : planActive(plan) ? 'You’re on the Tutor plan' : 'Thanks!'}
            </h1>
            <p className='mt-2 text-slate-600'>
              {trial ? `${planLabel(plan)}. No card needed until it ends, and nothing is charged unless you add one.` : planLabel(plan)}
            </p>
            <Link to='/whiteboard/teach' className='mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white hover:bg-violet-700'>
              <PlayCircle className='h-5 w-5' aria-hidden='true' />
              Start teaching
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
