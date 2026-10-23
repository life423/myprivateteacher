import { useState } from 'react';
import { api } from './api.js';
import { date } from './format.js';
import { ConfirmButton, Message } from './ui.jsx';
import AccessFields from './AccessFields.jsx';

// Free access for someone who hasn't signed in yet: it starts at their first sign-in.
export default function Invites({ grants, onChanged }) {
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
