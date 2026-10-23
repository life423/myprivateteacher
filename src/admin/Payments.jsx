import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { date, money } from './format.js';
import { BUTTON, ConfirmButton, Message } from './ui.jsx';

// A tutor's payments (from Stripe), with receipts, and refunds: all of what's left or part of it.
export default function Payments({ tutor, onDone }) {
  const [payments, setPayments] = useState(null);
  const [refunding, setRefunding] = useState(null); // the payment whose refund form is open
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const load = useCallback(() => api('GET', `/tutors/${tutor.id}/payments`).then((r) => setPayments(r.ok ? r.data.payments : [])), [tutor.id]);
  useEffect(() => {
    load();
  }, [load]);
  const refund = async (payment, cents) => {
    setBusy(true);
    setNote(null);
    const result = await api('POST', `/tutors/${tutor.id}/refund`, { charge: payment.id, amount: cents });
    setBusy(false);
    if (!result.ok) return setNote({ error: true, text: result.error });
    const done = result.data.payment;
    setNote({ text: `Refunded. ${money(done.refunded)} of ${money(done.amount)} has gone back to them in total.` });
    setRefunding(null);
    setAmount('');
    load();
    onDone?.();
  };
  if (!payments) return <p className='text-sm text-slate-500'>Loading payments…</p>;
  if (!payments.length) return <p className='text-sm text-slate-600'>No payments yet.</p>;
  return (
    <div className='grid gap-2'>
      <Message note={note} />
      <ul className='grid gap-2'>
        {payments.map((p) => {
          const left = p.amount - p.refunded;
          const raw = p.status.charAt(0).toUpperCase() + p.status.slice(1); // Pending, Failed
          const state = p.status !== 'succeeded' ? raw : p.refunded === 0 ? 'Paid' : left === 0 ? 'Refunded' : `Partly refunded (${money(p.refunded)})`;
          const cents = amount ? Math.round(Number(amount) * 100) : left;
          return (
            <li key={p.id} className='rounded-xl border border-slate-200 p-3 text-sm'>
              <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
                <span className='font-bold text-slate-900'>{money(p.amount)}</span>
                <span className='text-slate-500'>{date(p.created)}</span>
                <span className='rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700'>{state}</span>
                {p.receipt && (
                  <a href={p.receipt} target='_blank' rel='noreferrer' className='ml-auto font-semibold text-violet-700 hover:underline'>
                    Receipt
                  </a>
                )}
              </div>
              {p.status === 'succeeded' && left > 0 && (
                refunding === p.id ? (
                  <div className='mt-3 grid gap-2'>
                    <label className='grid gap-1 font-semibold text-slate-700'>
                      Amount to refund, up to {money(left)}
                      <input
                        type='number'
                        inputMode='decimal'
                        min='0.01'
                        step='0.01'
                        max={(left / 100).toFixed(2)}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder={`${(left / 100).toFixed(2)} (all of it)`}
                        className='rounded-xl border border-slate-300 px-3 py-2 font-normal'
                      />
                    </label>
                    <div className='flex flex-wrap gap-2'>
                      <ConfirmButton danger disabled={busy || !(cents > 0 && cents <= left)} onConfirm={() => refund(p, cents)}>
                        Refund {money(cents)}
                      </ConfirmButton>
                      <button type='button' onClick={() => setRefunding(null)} className={`${BUTTON} text-slate-600 hover:bg-slate-50`}>
                        Never mind
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type='button'
                    onClick={() => {
                      setRefunding(p.id);
                      setAmount('');
                    }}
                    className='mt-2 font-semibold text-rose-700 hover:underline'
                  >
                    Refund…
                  </button>
                )
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
