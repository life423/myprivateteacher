import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Avatar } from '../account/AccountMenu.jsx';
import { api } from './api.js';
import { ago, date, status } from './format.js';
import { Badge, BUTTON, ConfirmButton, Message } from './ui.jsx';
import AccessFields from './AccessFields.jsx';
import Payments from './Payments.jsx';

// One tutor, in a panel from the right (the whole screen on phones).
export default function TutorPanel({ tutor, onClose, onChanged, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState('');
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
          {plan && ['trialing', 'active', 'past_due'].includes(plan.status) && (
            <section className='grid gap-2'>
              <h3 className='font-extrabold text-slate-900'>Plan</h3>
              {plan.cancelAtPeriodEnd ? (
                <>
                  <p className='text-sm text-slate-600'>Their plan is set to end on {date(plan.periodEnd || plan.trialEnd)}.</p>
                  <div>
                    <ConfirmButton disabled={busy} onConfirm={() => run('POST', `/tutors/${tutor.id}/resume`, null, () => 'Their plan will carry on.')}>
                      Keep their plan
                    </ConfirmButton>
                  </div>
                </>
              ) : (
                <>
                  <p className='text-sm text-slate-600'>Ending at the end of the period keeps their access until then. Ending now stops it straight away.</p>
                  <div className='flex flex-wrap gap-2'>
                    <ConfirmButton
                      disabled={busy}
                      onConfirm={() => run('POST', `/tutors/${tutor.id}/cancel`, { when: 'period_end' }, () => 'Their plan will end at the end of the period.')}
                    >
                      Cancel at period end
                    </ConfirmButton>
                    <ConfirmButton danger disabled={busy} onConfirm={() => run('POST', `/tutors/${tutor.id}/cancel`, { when: 'now' }, () => 'Their plan is cancelled.')}>
                      Cancel now
                    </ConfirmButton>
                  </div>
                </>
              )}
            </section>
          )}
          {plan && (
            <section className='grid gap-2'>
              <h3 className='font-extrabold text-slate-900'>Payments</h3>
              <Payments tutor={tutor} onDone={() => onChanged()} />
            </section>
          )}
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
          {access.kind !== 'owner' && (
            <section className='grid gap-3 rounded-2xl border border-rose-200 p-4'>
              <h3 className='font-extrabold text-rose-800'>Delete account</h3>
              <p className='text-sm text-slate-600'>
                For a deletion request. Removes their account and sign-ins
                {plan ? ', and cancels their plan first so they’re never charged again' : ''}. Stripe keeps its own billing records. This can’t be undone.
              </p>
              <label className='grid gap-1 text-sm font-semibold text-slate-700'>
                Type {tutor.email} to confirm
                <input
                  type='text'
                  autoComplete='off'
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className='rounded-xl border border-slate-300 px-3 py-2 font-normal'
                />
              </label>
              <div>
                <button
                  type='button'
                  disabled={busy || confirmText.trim().toLowerCase() !== tutor.email}
                  onClick={async () => {
                    setBusy(true);
                    setNote(null);
                    const result = await api('DELETE', `/tutors/${tutor.id}`, { confirm: confirmText });
                    setBusy(false);
                    if (!result.ok) return setNote({ error: true, text: result.error });
                    onDeleted();
                  }}
                  className={`${BUTTON} bg-rose-600 text-white hover:bg-rose-700`}
                >
                  Delete account permanently
                </button>
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
