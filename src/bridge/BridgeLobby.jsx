import { useState } from 'react';
import { navigate } from '../router.jsx';
import { isRoomCode } from '../whiteboard/stage.js';
import { TopBar } from '../whiteboard/ui.jsx';

const digitsOnly = (value) => value.split('').filter((c) => c >= '0' && c <= '9').join('').slice(0, 4);

// The front door to Alphabet Bridge: start a session with a student, join one, or practise alone.
export default function BridgeLobby() {
  const [code, setCode] = useState('');

  return (
    <div className='min-h-dvh bg-gradient-to-b from-violet-50 to-sky-50'>
      <TopBar back='/activities' title='Alphabet Bridge' />
      <main className='mx-auto grid max-w-4xl gap-6 px-4 py-8 sm:py-12 md:grid-cols-2'>
        <section className='rounded-3xl bg-white p-6 shadow-lg sm:p-8'>
          <p className='text-4xl' aria-hidden='true'>🧑‍🏫</p>
          <h2 className='mt-3 text-2xl font-bold text-slate-900'>I'm the tutor</h2>
          <p className='mt-2 text-base text-slate-600'>
            Start a session and give your student the 4-digit code. You build the bridge with them: choose the letters,
            show them a gap, and see every tap as it happens.
          </p>
          <button
            type='button'
            onClick={() => navigate('/bridge/teach')}
            className='mt-6 w-full rounded-full bg-violet-600 px-6 py-3 text-lg font-bold text-white shadow hover:bg-violet-700'
          >
            Start a session
          </button>
        </section>

        <section className='rounded-3xl bg-white p-6 shadow-lg sm:p-8'>
          <p className='text-4xl' aria-hidden='true'>✋</p>
          <h2 className='mt-3 text-2xl font-bold text-slate-900'>I'm the student</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (isRoomCode(code)) navigate(`/bridge/${code}`);
            }}
          >
            <label htmlFor='bridge-code' className='mt-2 block text-base text-slate-600'>
              Type the code your tutor gave you.
            </label>
            <input
              id='bridge-code'
              value={code}
              onChange={(event) => setCode(digitsOnly(event.target.value))}
              inputMode='numeric'
              autoComplete='off'
              placeholder='0000'
              className='mt-4 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-center font-mono text-4xl font-bold tracking-[0.4em] text-slate-900 focus:border-violet-500 focus:outline-none'
            />
            <button
              type='submit'
              disabled={!isRoomCode(code)}
              className='mt-4 w-full rounded-full bg-sky-600 px-6 py-3 text-lg font-bold text-white shadow hover:bg-sky-700 disabled:opacity-40'
            >
              Join
            </button>
          </form>
        </section>

        <section className='rounded-3xl bg-white p-6 shadow-lg sm:p-8 md:col-span-2'>
          <p className='text-4xl' aria-hidden='true'>🌉</p>
          <h2 className='mt-3 text-2xl font-bold text-slate-900'>Practise on your own</h2>
          <p className='mt-2 text-base text-slate-600'>Three levels, no tutor needed.</p>
          <button
            type='button'
            onClick={() => navigate('/bridge/solo')}
            className='mt-6 rounded-full bg-emerald-600 px-6 py-3 text-lg font-bold text-white shadow hover:bg-emerald-700'
          >
            Play alone
          </button>
        </section>
      </main>
    </div>
  );
}
