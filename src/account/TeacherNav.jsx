import { BookOpen, CalendarDays, Receipt } from 'lucide-react';
import { Link } from '../router.jsx';

const pages = [
  { to: '/lessons', key: 'lessons', label: 'Your lessons', Icon: BookOpen },
  { to: '/calendar', key: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { to: '/invoices', key: 'invoices', label: 'Invoices', Icon: Receipt },
];

export default function TeacherNav({ active }) {
  return <nav aria-label='Teacher workspace' className='mx-auto flex max-w-7xl gap-1 px-4 sm:px-6'>
    {pages.map(({ to, key, label, Icon }) => <Link key={key} to={to} aria-current={active === key ? 'page' : undefined}
      className={`inline-flex min-h-12 min-w-0 items-center justify-center gap-2 border-b-2 px-2 py-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 sm:px-4 ${active === key ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'}`}>
      <Icon className='h-4 w-4 shrink-0' aria-hidden='true' /><span>{label}</span>
    </Link>)}
  </nav>;
}
