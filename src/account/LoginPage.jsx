import { BookOpen, LogOut, PlayCircle } from 'lucide-react';
import { Link, navigate } from '../router.jsx';
import { Avatar } from './AccountMenu.jsx';
import GoogleButton from './GoogleButton.jsx';
import { signOut, useAccount } from './account.js';

// Sign in, for tutors. Students join a lesson with a code and never need an account.
export default function LoginPage() {
  const { loading, tutor, googleClientId } = useAccount();
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
            </div>
            <div className='mt-6 grid gap-2'>
              <Link to='/whiteboard/teach' className='inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white hover:bg-violet-700'>
                <PlayCircle className='h-5 w-5' aria-hidden='true' />
                Start teaching
              </Link>
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
                <GoogleButton clientId={googleClientId} onSignedIn={() => navigate('/whiteboard')} />
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
