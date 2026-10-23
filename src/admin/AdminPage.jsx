import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Search } from 'lucide-react';
import { Link } from '../router.jsx';
import { useAccount } from '../account/account.js';
import { Avatar } from '../account/AccountMenu.jsx';
import { api } from './api.js';
import { ago, date, money, status } from './format.js';
import { Badge, Message, Shell } from './ui.jsx';
import TutorPanel from './TutorPanel.jsx';
import Invites from './Invites.jsx';
import Activity from './Activity.jsx';

// The owner's admin panel: tutors and their access, free access (with an end date or none),
// free extensions, invites for people who haven't signed in yet, and a record of every action.
// The server checks the owner role on every request; this page only arranges what it sends.

const FILTERS = [
  ['all', 'All'],
  ['trial', 'Trial'],
  ['paying', 'Paying'],
  ['free', 'Free access'],
  ['none', 'No access'],
];

export default function AdminPage() {
  const { loading, tutor } = useAccount();
  const [tab, setTab] = useState('tutors');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [activity, setActivity] = useState(null);
  const [overview, setOverview] = useState(null);
  const owner = Boolean(tutor?.owner);

  const refreshNumbers = useCallback(() => api('GET', '/overview').then((r) => r.ok && setOverview(r.data)), []);
  const load = useCallback(async () => {
    const result = await api('GET', '/tutors');
    if (result.ok) setData(result.data);
    else setError(result.error);
    refreshNumbers();
  }, [refreshNumbers]);
  useEffect(() => {
    if (owner) load();
  }, [owner, load]);
  useEffect(() => {
    if (owner && tab === 'activity') api('GET', '/activity').then((r) => r.ok && setActivity(r.data.activity));
  }, [owner, tab]);
  const closePanel = useCallback(() => setOpenId(null), []);

  if (loading) return <Shell>One moment…</Shell>;
  if (!owner) {
    return (
      <Shell>
        <p className='font-bold text-slate-900'>This page is for the site’s owner.</p>
        <Link to={tutor ? '/' : '/login'} className='mt-4 inline-block font-semibold text-violet-700 hover:underline'>
          {tutor ? 'Back to home' : 'Sign in'}
        </Link>
      </Shell>
    );
  }

  const tutors = data?.tutors || [];
  const grants = data?.grants || [];
  const o = overview;
  const stats = [
    ['Tutors', o?.tutors, o?.newThisWeek ? `${o.newThisWeek} new this week` : null],
    ['On a trial', o?.trials, o?.trialsEndingSoon ? `${o.trialsEndingSoon} ending this week` : null],
    ['Paying', o?.paying, o ? `${money(o.monthly)} a month` : null],
    ['Past due', o?.pastDue, o?.pastDue ? 'card needs updating' : null],
    ['Free access', o?.free, null],
    ['Lessons now', o?.lessonsNow, o?.lessonsNow ? `${o.studentsNow} with a student` : null],
  ];
  const needle = query.trim().toLowerCase();
  const shown = tutors.filter((t) => (filter === 'all' || status(t).group === filter) && (!needle || `${t.name} ${t.email}`.toLowerCase().includes(needle)));
  const open = tutors.find((t) => t.id === openId);
  const tabs = [
    ['tutors', 'Tutors'],
    ['invites', `Invites${grants.length ? ` (${grants.length})` : ''}`],
    ['activity', 'Activity'],
  ];

  return (
    <div className='min-h-dvh bg-slate-50'>
      <header className='border-b border-slate-200 bg-white'>
        <div className='mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-6'>
          <Link to='/' className='inline-flex items-center gap-2.5 font-bold text-slate-900'>
            <span className='flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white'>
              <BookOpen className='h-5 w-5' aria-hidden='true' />
            </span>
            <span className='max-sm:hidden'>My Private Teacher</span>
          </Link>
          <span className='rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-bold text-violet-800'>Admin</span>
          <Link to='/' className='ml-auto inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-violet-700'>
            <ArrowLeft className='h-4 w-4' aria-hidden='true' />
            Back to site
          </Link>
        </div>
      </header>
      <main className='mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-6 px-4 py-8 sm:px-6'>
        <h1 className='text-2xl font-extrabold text-slate-900 sm:text-3xl'>Admin</h1>
        {error && <Message note={{ error: true, text: error }} />}
        <dl className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'>
          {stats.map(([label, value, sub]) => (
            <div key={label} className='rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200'>
              <dt className='text-sm text-slate-500'>{label}</dt>
              <dd className='mt-1 text-2xl font-extrabold text-slate-900'>{o ? value : '–'}</dd>
              {sub && <p className='mt-1 text-xs text-slate-500'>{sub}</p>}
            </div>
          ))}
        </dl>
        <nav aria-label='Admin sections' className='flex gap-1 overflow-x-auto rounded-2xl bg-slate-200/60 p-1'>
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type='button'
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
              className={`flex-1 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold ${tab === id ? 'bg-white text-slate-900 shadow' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {label}
            </button>
          ))}
        </nav>
        {tab === 'tutors' && (
          <section className='grid grid-cols-[minmax(0,1fr)] gap-4'>
            <div className='flex flex-col gap-3 md:flex-row md:items-center'>
              <label className='relative flex-1'>
                <span className='sr-only'>Search tutors</span>
                <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400' aria-hidden='true' />
                <input
                  type='search'
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder='Search by name or email'
                  className='w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm'
                />
              </label>
              <div className='flex gap-1 overflow-x-auto'>
                {FILTERS.map(([id, label]) => (
                  <button
                    key={id}
                    type='button'
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold ${filter === id ? 'bg-violet-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {!data ? (
              <p className='text-sm text-slate-500'>Loading tutors…</p>
            ) : shown.length === 0 ? (
              <p className='rounded-2xl bg-white p-5 text-sm text-slate-500 ring-1 ring-slate-200'>No tutors match.</p>
            ) : (
              <ul className='grid gap-2'>
                {shown.map((t) => (
                  <li key={t.id}>
                    <button
                      type='button'
                      onClick={() => setOpenId(t.id)}
                      className='flex w-full flex-col gap-3 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 hover:ring-violet-300 sm:flex-row sm:items-center'
                    >
                      <span className='flex min-w-0 flex-1 items-center gap-3'>
                        <Avatar tutor={t} size={40} />
                        <span className='min-w-0'>
                          <span className='block truncate font-bold text-slate-900'>{t.name || t.email}</span>
                          <span className='block truncate text-sm text-slate-500'>{t.email}</span>
                        </span>
                      </span>
                      <span className='flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 sm:justify-end'>
                        <Badge s={status(t)} />
                        <span>Joined {date(t.createdAt)}</span>
                        <span>Seen {ago(t.lastSignInAt)}</span>
                        <span className='font-semibold text-violet-700'>Manage →</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {tab === 'invites' && <Invites grants={grants} onChanged={load} />}
        {tab === 'activity' && <Activity entries={activity} />}
      </main>
      {open && (
        <TutorPanel
          tutor={open}
          onClose={closePanel}
          onChanged={(changed) => {
            if (changed) setData((d) => ({ ...d, tutors: d.tutors.map((t) => (t.id === changed.id ? changed : t)) }));
            refreshNumbers();
          }}
          onDeleted={() => {
            setOpenId(null);
            load();
          }}
        />
      )}
    </div>
  );
}
