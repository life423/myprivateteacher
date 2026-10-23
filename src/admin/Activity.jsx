import { ago, date, money } from './format.js';

const ACTIONS = {
  comp: 'gave free access to',
  uncomp: 'removed free access from',
  extend: 'extended',
  'sign-out': 'signed out',
  refund: 'refunded',
  cancel: 'cancelled the plan of',
  resume: 'kept the plan of',
  delete: 'deleted the account of',
  grant: 'invited',
  ungrant: 'removed the invite for',
};

function detailOf(e) {
  const d = e.detail || {};
  if (e.action === 'extend') return `${d.days} days, to ${date(d.until)}`;
  if (e.action === 'comp' || e.action === 'grant') return `${d.until ? `until ${date(d.until)}` : 'no end date'}${d.note ? ` · ${d.note}` : ''}`;
  if (e.action === 'refund') return `${money(d.amount)} refunded in total`;
  if (e.action === 'cancel') return d.when === 'now' ? 'straight away' : 'at the end of the period';
  if (e.action === 'sign-out') return `${d.sessions} session${d.sessions === 1 ? '' : 's'}`;
  return '';
}

export default function Activity({ entries }) {
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
