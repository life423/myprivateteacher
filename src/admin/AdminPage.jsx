import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Search, X } from 'lucide-react';
import { Link } from '../router.jsx';
import { useAccount } from '../account/account.js';
import { Avatar } from '../account/AccountMenu.jsx';

// The owner's admin panel: tutors and their access, free access (with an end date or none),
// free extensions, invites for people who haven't signed in yet, and a record of every action.
// The server checks the owner role on every request; this page only arranges what it sends.
const DAY = 86400000;

async function api(method, path, body) {
  try {
    const res = await fetch(`/api/admin${path}`, {
      method,
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return res.ok ? { ok: true, data } : { ok: false, error: data?.error || 'That didn’t work. Please try again.' };
  } catch {
    return { ok: false, error: 'Couldn’t reach the server. Check your connection.' };
  }
}

const date = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
function ago(ms) {
  if (!ms) return 'never';
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : date(ms);
}

// A tutor's status as one short label, its colour, and the filter it belongs to.
function status(t) {
  const { access, plan } = t;
  if (access.kind === 'owner') return { label: 'Owner', tone: 'violet', group: 'free' };
  if (access.kind === 'comp') return { label: access.until ? `Free until ${date(access.until)}` : 'Free access', tone: 'emerald', group: 'free' };
  if (plan?.status === 'trialing') {
    const days = Math.max(0, Math.ceil((plan.trialEnd - Date.now()) / DAY));
    return { label: `Trial · ${days} day${days === 1 ? '' : 's'} left`, tone: 'sky', group: 'trial' };
  }
  if (plan?.status === 'active') return { label: plan.cancelAtPeriodEnd ? `Paying · ends ${date(plan.periodEnd)}` : 'Paying', tone: 'emerald', group: 'paying' };
  if (plan?.status === 'past_due') return { label: 'Past due', tone: 'amber', group: 'paying' };
  return { label: plan ? 'Plan ended' : 'No plan', tone: 'slate', group: 'none' };
}
const TONES = {
  violet: 'bg-violet-100 text-violet-800',
  emerald: 'bg-emerald-100 text-emerald-800',
  sky: 'bg-sky-100 text-sky-800',
  amber: 'bg-amber-100 text-amber-900',
  slate: 'bg-slate-100 text-slate-700',
};
const Badge = ({ s }) => <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${TONES[s.tone]}`}>{s.label}</span>;
const FILTERS = [
  ['all', 'All'],
  ['trial', 'Trial'],
  ['paying', 'Paying'],
  ['free', 'Free access'],
  ['none', 'No access'],
];
const BUTTON = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50';

// A button that asks once more before doing something that matters.
function ConfirmButton({ children, onConfirm, disabled, danger = false }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  let tone = danger ? 'border border-rose-300 text-rose-700 hover:bg-rose-50' : 'border border-slate-300 text-slate-800 hover:bg-slate-50';
  if (armed) tone = danger ? 'bg-rose-600 text-white' : 'bg-violet-600 text-white';
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
      className={`${BUTTON} ${tone}`}
    >
      {armed ? 'Click again to confirm' : children}
    </button>
  );
}

// Free access: forever, or until a date; with a note for yourself.
function AccessFields({ initial, onSave, busy, label }) {
  const inMonth = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
  const [forever, setForever] = useState(!initial?.until);
  const [until, setUntil] = useState(initial?.until ? new Date(initial.until).toISOString().slice(0, 10) : inMonth);
  const [note, setNote] = useState(initial?.note || '');
  const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
  return (
    <form
      className='grid gap-3'
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ until: forever ? null : new Date(`${until}T23:59:59`).toISOString(), note });
      }}
    >
      <div role='radiogroup' aria-label='How long' className='grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1'>
        {[
          [true, 'No end date'],
          [false, 'Until a date'],
        ].map(([value, text]) => (
          <button
            key={text}
            type='button'
            role='radio'
            aria-checked={forever === value}
            onClick={() => setForever(value)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${forever === value ? 'bg-white text-slate-900 shadow' : 'text-slate-600'}`}
          >
            {text}
          </button>
        ))}
      </div>
      {!forever && (
        <label className='grid gap-1 text-sm font-semibold text-slate-700'>
          Free until
          <input type='date' required min={tomorrow} value={until} onChange={(e) => setUntil(e.target.value)} className='rounded-xl border border-slate-300 px-3 py-2 font-normal' />
        </label>
      )}
      <label className='grid gap-1 text-sm font-semibold text-slate-700'>
        Note (only you see this)
        <input
          type='text'
          maxLength={120}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder='For example: Mom, or beta tester'
          className='rounded-xl border border-slate-300 px-3 py-2 font-normal'
        />
      </label>
      <button type='submit' disabled={busy} className={`${BUTTON} bg-violet-600 text-white hover:bg-violet-700`}>
        {busy ? 'Saving…' : label}
      </button>
    </form>
  );
}

function Message({ note }) {
  if (!note) return null;
  return (
    <p role='status' className={`rounded-xl px-3 py-2 text-sm font-semibold ${note.error ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>
      {note.text}
    </p>
  );
}

// One tutor, in a panel from the right (the whole screen on phones).
function TutorPanel({ tutor, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const run = async (method, path, body, done) => {
    setBusy(true);
    setNote(null);
    const result = await api(method, path, body);
    setBusy(false);
    if (!result.ok) return setNote({ error: true, text: result.error });
    setEditing(false);
    setNote({ text: done(result.data) });
    onChanged(result.data?.tutor);
  };
  const { access, plan, comp } = tutor;
  const canExtend = access.kind !== 'owner' && !(access.kind === 'comp' && !access.until);
  const extendHelp =
    access.kind === 'plan'
      ? 'Moves their next charge back 30 days. Stripe won’t bill them for the added time.'
      : access.kind === 'comp'
        ? 'Adds 30 days to their free access.'
        : 'Gives them 30 days of free access.';
  const rows = [
    ['Joined', date(tutor.createdAt)],
    ['Last signed in', ago(tutor.lastSignInAt)],
    ['Plan', plan ? `${plan.status}${plan.trialEnd ? `, trial ends ${date(plan.trialEnd)}` : ''}${plan.periodEnd && !plan.trialEnd ? `, renews ${date(plan.periodEnd)}` : ''}` : 'None'],
    ['Free access', comp ? `${comp.until ? `until ${date(comp.until)}` : 'no end date'}${comp.note ? ` · ${comp.note}` : ''}` : 'No'],
  ];
  return (
    <div className='fixed inset-0 z-50'>
      <div className='absolute inset-0 bg-slate-900/30' onClick={onClose} />
      <aside role='dialog' aria-modal='true' aria-label={`Manage ${tutor.name || tutor.email}`} className='absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl sm:w-[28rem]'>
        <header className='flex items-center gap-3 border-b border-slate-200 px-5 py-4'>
          <Avatar tutor={tutor} size={44} />
          <div className='min-w-0 flex-1'>
            <p className='truncate font-extrabold text-slate-900'>{tutor.name || tutor.email}</p>
            <p className='truncate text-sm text-slate-500'>{tutor.email}</p>
          </div>
          <button type='button' onClick={onClose} aria-label='Close' className='rounded-full p-2 text-slate-500 hover:bg-slate-100'>
            <X className='h-5 w-5' aria-hidden='true' />
          </button>
        </header>
        <div className='grid flex-1 grid-cols-[minmax(0,1fr)] content-start gap-6 overflow-y-auto p-5'>
          <section className='grid gap-3'>
            <Badge s={status(tutor)} />
            <dl className='grid gap-2 text-sm'>
              {rows.map(([term, value]) => (
                <div key={term} className='flex justify-between gap-4'>
                  <dt className='text-slate-500'>{term}</dt>
                  <dd className='text-right font-semibold text-slate-800'>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <Message note={note} />
          <section className='grid gap-3'>
            <h3 className='font-extrabold text-slate-900'>Free access</h3>
            {access.kind === 'owner' ? (
              <p className='text-sm text-slate-600'>Owners always have free access.</p>
            ) : comp && !editing ? (
              <div className='flex flex-wrap gap-2'>
                <button type='button' onClick={() => setEditing(true)} className={`${BUTTON} border border-slate-300 text-slate-800 hover:bg-slate-50`}>
                  Change
                </button>
                <ConfirmButton danger disabled={busy} onConfirm={() => run('DELETE', `/tutors/${tutor.id}/comp`, null, () => 'Free access removed.')}>
                  Remove free access
                </ConfirmButton>
              </div>
            ) : (
              <AccessFields
                initial={comp}
                busy={busy}
                label={comp ? 'Save' : 'Give free access'}
                onSave={(body) => run('POST', `/tutors/${tutor.id}/comp`, body, () => 'Free access saved.')}
              />
            )}
          </section>
          <section className='grid gap-2'>
            <h3 className='font-extrabold text-slate-900'>Extend for free</h3>
            <p className='text-sm text-slate-600'>{canExtend ? extendHelp : 'Nothing to extend: they already have free access with no end date.'}</p>
            <div>
              <ConfirmButton disabled={busy || !canExtend} onConfirm={() => run('POST', `/tutors/${tutor.id}/extend`, { days: 30 }, (d) => `Extended to ${date(d.until)}.`)}>
                Extend 30 days free
              </ConfirmButton>
            </div>
          </section>
          <section className='grid gap-2'>
            <h3 className='font-extrabold text-slate-900'>Sign out everywhere</h3>
            <p className='text-sm text-slate-600'>Ends their sessions on every device, for a lost phone or a shared login. They can sign straight back in.</p>
            <div>
              <ConfirmButton
                danger
                disabled={busy}
                onConfirm={() => run('POST', `/tutors/${tutor.id}/sign-out`, null, (d) => `Signed out of ${d.signedOut} session${d.signedOut === 1 ? '' : 's'}.`)}
              >
                Sign out everywhere
              </ConfirmButton>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

// Free access for someone who hasn't signed in yet: it starts at their first sign-in.
function Invites({ grants, onChanged }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [formKey, setFormKey] = useState(0);
  const save = async (body) => {
    setBusy(true);
    setNote(null);
    const result = await api('POST', '/grants', { email, ...body });
    setBusy(false);
    if (!result.ok) return setNote({ error: true, text: result.error });
    setNote({ text: result.data.applied ? `${email} already had an account: their free access is on now.` : `Saved. ${email} gets free access the first time they sign in with Google.` });
    setEmail('');
    setFormKey((k) => k + 1);
    onChanged();
  };
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]'>
      <section className='grid content-start gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200'>
        <h2 className='font-extrabold text-slate-900'>Give someone free access</h2>
        <p className='text-sm text-slate-600'>Use the email of the Google account they’ll sign in with. If they’ve signed in before, it starts straight away.</p>
        <label className='grid gap-1 text-sm font-semibold text-slate-700'>
          Their Google email
          <input type='email' value={email} onChange={(e) => setEmail(e.target.value)} placeholder='name@gmail.com' className='rounded-xl border border-slate-300 px-3 py-2 font-normal' />
        </label>
        <AccessFields key={formKey} busy={busy || !email} label='Give free access' onSave={save} />
        <Message note={note} />
      </section>
      <section className='grid content-start gap-3'>
        <h2 className='font-extrabold text-slate-900'>Waiting for their first sign-in</h2>
        {grants.length === 0 ? (
          <p className='rounded-2xl bg-white p-5 text-sm text-slate-500 ring-1 ring-slate-200'>No invites waiting.</p>
        ) : (
          <ul className='grid gap-2'>
            {grants.map((g) => (
              <li key={g.email} className='flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:flex-row sm:items-center'>
                <div className='min-w-0 flex-1'>
                  <p className='truncate font-bold text-slate-900'>{g.email}</p>
                  <p className='text-sm text-slate-500'>
                    {g.roles?.includes('owner') ? 'Owner' : g.comp?.until ? `Free until ${date(g.comp.until)}` : 'Free access, no end date'}
                    {g.comp?.note ? ` · ${g.comp.note}` : ''}
                  </p>
                </div>
                <ConfirmButton danger onConfirm={async () => (await api('DELETE', `/grants/${encodeURIComponent(g.email)}`)).ok && onChanged()}>
                  Remove
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const ACTIONS = {
  comp: 'gave free access to',
  uncomp: 'removed free access from',
  extend: 'extended',
  'sign-out': 'signed out',
  grant: 'invited',
  ungrant: 'removed the invite for',
};
function detailOf(e) {
  const d = e.detail || {};
  if (e.action === 'extend') return `${d.days} days, to ${date(d.until)}`;
  if (e.action === 'comp' || e.action === 'grant') return `${d.until ? `until ${date(d.until)}` : 'no end date'}${d.note ? ` · ${d.note}` : ''}`;
  if (e.action === 'sign-out') return `${d.sessions} session${d.sessions === 1 ? '' : 's'}`;
  return '';
}

function Activity({ entries }) {
  if (!entries) return <p className='text-sm text-slate-500'>Loading…</p>;
  if (!entries.length) return <p className='rounded-2xl bg-white p-5 text-sm text-slate-500 ring-1 ring-slate-200'>Nothing yet. Every change you make here is recorded.</p>;
  return (
    <ul className='grid gap-2'>
      {entries.map((e) => (
        <li key={e.id} className='rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200'>
          <p className='text-slate-800'>
            <strong>{e.by?.email}</strong> {ACTIONS[e.action] || e.action} <strong>{e.target?.email}</strong>
          </p>
          <p className='mt-1 text-slate-500'>
            {ago(e.at)}
            {detailOf(e) ? ` · ${detailOf(e)}` : ''}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Shell({ children }) {
  return (
    <main className='flex min-h-dvh items-center justify-center bg-slate-50 px-4'>
      <div className='max-w-sm rounded-3xl bg-white p-8 text-center shadow ring-1 ring-slate-200'>{children}</div>
    </main>
  );
}

export default function AdminPage() {
  const { loading, tutor } = useAccount();
  const [tab, setTab] = useState('tutors');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [activity, setActivity] = useState(null);
  const owner = Boolean(tutor?.owner);

  const load = useCallback(async () => {
    const result = await api('GET', '/tutors');
    if (result.ok) setData(result.data);
    else setError(result.error);
  }, []);
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
  const count = (group) => tutors.filter((t) => status(t).group === group).length;
  const stats = [
    ['Tutors', tutors.length],
    ['On a trial', count('trial')],
    ['Paying', count('paying')],
    ['Free access', count('free')],
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
        <dl className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
          {stats.map(([label, value]) => (
            <div key={label} className='rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200'>
              <dt className='text-sm text-slate-500'>{label}</dt>
              <dd className='mt-1 text-2xl font-extrabold text-slate-900'>{data ? value : '–'}</dd>
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
          }}
        />
      )}
    </div>
  );
}
