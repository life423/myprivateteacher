import { useEffect, useRef, useState } from 'react';
import { LogOut, PlayCircle } from 'lucide-react';
import { Link } from '../router.jsx';
import { signOut } from './account.js';

// A tutor's picture (from Google) or the first letter of their name.
export function Avatar({ tutor, size = 32 }) {
  const initial = (tutor.name || tutor.email || '?').trim().charAt(0).toUpperCase();
  if (tutor.picture) {
    return <img src={tutor.picture} alt='' width={size} height={size} referrerPolicy='no-referrer' className='shrink-0 rounded-full' />;
  }
  return (
    <span style={{ width: size, height: size }} className='flex shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white'>
      {initial}
    </span>
  );
}

// The signed-in tutor's menu: who they are, Start teaching, Log out.
export default function AccountMenu({ tutor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div ref={ref} className='relative'>
      <button
        type='button'
        aria-haspopup='menu'
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className='flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-semibold text-slate-700 hover:bg-slate-100'
      >
        <Avatar tutor={tutor} size={30} />
        <span className='max-w-[9rem] truncate'>{tutor.name.split(' ')[0] || tutor.email}</span>
      </button>
      {open && (
        <div role='menu' className='absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl bg-white p-2 text-left shadow-xl ring-1 ring-slate-200'>
          <div className='px-3 py-2'>
            <p className='truncate font-bold text-slate-900'>{tutor.name || 'Tutor'}</p>
            <p className='truncate text-sm text-slate-500'>{tutor.email}</p>
          </div>
          <Link to='/whiteboard/teach' role='menuitem' className='flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50'>
            <PlayCircle className='h-4 w-4 text-violet-600' aria-hidden='true' />
            Start teaching
          </Link>
          <button
            type='button'
            role='menuitem'
            onClick={async () => {
              setOpen(false);
              await signOut();
            }}
            className='flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50'
          >
            <LogOut className='h-4 w-4 text-slate-500' aria-hidden='true' />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
