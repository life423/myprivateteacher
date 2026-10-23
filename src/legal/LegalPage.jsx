import { useEffect } from 'react';
import { BookOpen } from 'lucide-react';
import { Link } from '../router.jsx';
import { LEGAL } from './facts.js';

// The shared page for the Terms of Service and Privacy Policy: plain, readable, printable.
export function H2({ id, children }) {
  return (
    <h2 id={id} className='mt-10 scroll-mt-6 text-xl font-extrabold text-slate-900'>
      {children}
    </h2>
  );
}
export const P = ({ children }) => <p className='mt-3 leading-7 text-slate-700'>{children}</p>;
export const List = ({ children }) => <ul className='mt-3 list-disc space-y-2 pl-6 leading-7 text-slate-700'>{children}</ul>;
export const Mail = () => (
  <a href={`mailto:${LEGAL.email}`} className='font-semibold text-violet-700 underline underline-offset-2'>
    {LEGAL.email}
  </a>
);

export default function LegalPage({ title, summary, children }) {
  useEffect(() => window.scrollTo(0, 0), []);
  return (
    <div className='min-h-dvh bg-white'>
      <header className='border-b border-slate-200'>
        <div className='mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6'>
          <Link to='/' className='inline-flex items-center gap-2.5 font-bold text-slate-900'>
            <span className='flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white'>
              <BookOpen className='h-5 w-5' aria-hidden='true' />
            </span>
            {LEGAL.service}
          </Link>
          <nav className='ml-auto flex gap-4 text-sm font-semibold text-slate-600'>
            <Link to='/terms' className='hover:text-violet-700'>
              Terms
            </Link>
            <Link to='/privacy' className='hover:text-violet-700'>
              Privacy
            </Link>
          </nav>
        </div>
      </header>
      <main className='mx-auto max-w-3xl px-4 pb-20 pt-10 sm:px-6'>
        <h1 className='text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl'>{title}</h1>
        <p className='mt-2 text-sm text-slate-500'>Effective {LEGAL.effective}</p>
        {summary && <div className='mt-6 rounded-2xl bg-violet-50 p-5 leading-7 text-slate-800'>{summary}</div>}
        {children}
      </main>
    </div>
  );
}
