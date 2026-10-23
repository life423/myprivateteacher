import { useState } from 'react';
import { DAY } from './format.js';
import { BUTTON } from './ui.jsx';

// Free access: forever, or until a date; with a note for yourself.
export default function AccessFields({ initial, onSave, busy, label }) {
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
