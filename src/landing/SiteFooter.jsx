import { ArrowUp, BookOpen } from 'lucide-react';
import { Link } from '../router.jsx';
import { LEGAL } from '../legal/facts.js';

// The site footer: the brand, three small groups of links, and a closing line.
// Phones: stacked, the links in two columns. Tablets: three columns under the brand.
// Desktop: the brand beside the three groups.
const GROUPS = [
  {
    title: 'Product',
    links: [
      ['Features', '/#features'],
      ['How it works', '/#how-it-works'],
      ['Pricing', '/#pricing'],
      ['Phoneme Pop', '/phoneme-pop'],
    ],
  },
  {
    title: 'Lessons',
    links: [
      ['Join a lesson', '/whiteboard'],
      ['Start free trial', '/trial'],
      ['Sign in', '/login'],
      ['All activities', '/activities'],
    ],
  },
  {
    title: 'Company',
    links: [
      ['Terms of Service', '/terms'],
      ['Privacy Policy', '/privacy'],
      ['Contact', `mailto:${LEGAL.email}`],
    ],
  },
];

const LINK = 'inline-block rounded py-1 text-sm text-slate-600 hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600';

function FooterLink({ to, children }) {
  // Section links and email go through the browser; pages through the app's router.
  if (to.startsWith('/#') || to.startsWith('mailto:')) {
    return (
      <a href={to} className={LINK}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={LINK}>
      {children}
    </Link>
  );
}

export default function SiteFooter() {
  return (
    <footer className='border-t border-slate-200 bg-white'>
      <div className='mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-14'>
        <div className='grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16'>
          <div className='max-w-xs'>
            <Link to='/' className='inline-flex items-center gap-2.5 font-bold text-slate-900'>
              <span className='flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white'>
                <BookOpen className='h-5 w-5' aria-hidden='true' />
              </span>
              {LEGAL.service}
            </Link>
            <p className='mt-3 text-sm leading-6 text-slate-600'>A live lesson workspace for structured literacy tutors and their students.</p>
          </div>
          <nav aria-label='Footer' className='grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3'>
            {GROUPS.map((group) => (
              <div key={group.title}>
                <h2 className='text-xs font-bold uppercase tracking-wider text-slate-900'>{group.title}</h2>
                <ul className='mt-3 space-y-1'>
                  {group.links.map(([label, to]) => (
                    <li key={label}>
                      <FooterLink to={to}>{label}</FooterLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className='mt-10 flex flex-col-reverse gap-4 border-t border-slate-200 pt-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between'>
          <p>
            © {new Date().getFullYear()} {LEGAL.service}
          </p>
          <button
            type='button'
            onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}
            className='inline-flex items-center gap-1.5 self-start rounded py-1 font-semibold text-slate-600 hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600 sm:self-auto'
          >
            <ArrowUp className='h-4 w-4' aria-hidden='true' />
            Back to top
          </button>
        </div>
      </div>
    </footer>
  );
}
