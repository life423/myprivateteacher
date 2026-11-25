import { useEffect } from 'react';
import { BookOpen } from 'lucide-react';
import { Link } from '../router.jsx';
import { LEGAL } from './facts.js';
import SiteFooter from '../landing/SiteFooter.jsx';

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
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return (
    <div className='min-h-dvh bg-white [overflow-wrap:anywhere]'>
      <header className='border-b border-slate-200'>
        <div className='mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-4 sm:px-6'>
          <Link to='/' className='inline-flex min-h-11 min-w-0 max-w-full items-center gap-2.5 rounded font-bold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600'>
            <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white'>
              <BookOpen className='h-5 w-5' aria-hidden='true' />
            </span>
            <span className='min-w-0 [overflow-wrap:anywhere]'>{LEGAL.service}</span>
          </Link>
          <nav className='ml-auto flex max-w-full flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-slate-600'>
            <Link to='/terms' className='inline-flex min-h-11 min-w-11 items-center rounded hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600'>
              Terms
            </Link>
            <Link to='/privacy' className='inline-flex min-h-11 min-w-11 items-center rounded hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600'>
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
      <SiteFooter />
    </div>
  );
}
