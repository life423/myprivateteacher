import { useEffect, useState } from 'react';

const TONES = {
  violet: 'bg-violet-100 text-violet-800',
  emerald: 'bg-emerald-100 text-emerald-800',
  sky: 'bg-sky-100 text-sky-800',
  amber: 'bg-amber-100 text-amber-900',
  slate: 'bg-slate-100 text-slate-700',
};

export const Badge = ({ s }) => <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${TONES[s.tone]}`}>{s.label}</span>;

export const BUTTON = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50';

// A button that asks once more before doing something that matters.
export function ConfirmButton({ children, onConfirm, disabled, danger = false }) {
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

export function Message({ note }) {
  if (!note) return null;
  return (
    <p role='status' className={`rounded-xl px-3 py-2 text-sm font-semibold ${note.error ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>
      {note.text}
    </p>
  );
}

export function Shell({ children }) {
  return (
    <main className='flex min-h-dvh items-center justify-center bg-slate-50 px-4'>
      <div className='max-w-sm rounded-3xl bg-white p-8 text-center shadow ring-1 ring-slate-200'>{children}</div>
    </main>
  );
}
