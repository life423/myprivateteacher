import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { TEACHING_MARKS, getTeachingMark } from '../../shared/teachingMarks.js';
import TeachingMarkGlyph from './TeachingMarkGlyph.jsx';

// The same named glyphs serve lesson preparation and explicit live placement.
// Keep definitions neutral: teachers decide how their program uses each mark.
export default function TeachingMarks({ selected = [], marks, onToggle, onAdd, disabled = false, label = 'Teaching marks', query = '' }) {
  const [note, setNote] = useState('');
  useEffect(() => { if (!note) return; const timer = setTimeout(() => setNote(''), 3500); return () => clearTimeout(timer); }, [note]);
  const choices = marks === undefined ? TEACHING_MARKS : marks.map(getTeachingMark).filter(Boolean);
  const needle = query.trim().toLowerCase();
  const visible = choices.filter(mark => `${mark.label} ${mark.id}`.toLowerCase().includes(needle));
  if (!choices.length) return null;
  const choosing = Boolean(onToggle);
  return <div role='group' aria-label={label} className='min-w-0'>
    <div className='grid grid-cols-2 gap-2'>
      {visible.map(mark => {
        const checked = selected.includes(mark.id);
        return <button key={mark.id} type='button' disabled={disabled} aria-label={choosing ? mark.label : `Add ${mark.label}`} aria-pressed={choosing ? checked : undefined}
          onClick={() => {
            if (choosing) onToggle(mark.id);
            else {
              const result = onAdd?.(mark.id);
              setNote(result ? `${mark.label} added` : 'The mark could not be added. Check the connection and board space.');
            }
          }}
          className={`flex min-h-11 min-w-0 items-center gap-1.5 rounded-lg border px-1.5 py-2 text-left text-xs font-semibold leading-5 transition-colors duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${choosing && checked ? 'border-violet-400 bg-violet-50 text-violet-900' : 'border-slate-200 bg-white text-slate-700 hover:border-violet-300 hover:bg-violet-50'}`}>
          <span className='flex h-6 w-6 shrink-0 items-center justify-center' aria-hidden='true'><TeachingMarkGlyph mark={mark.id} width={Math.min(24, 22 * mark.w / mark.h)} height={Math.min(22, 24 * mark.h / mark.w)} /></span>
          <span className='min-w-0 flex-1 [overflow-wrap:anywhere]'>{mark.label}</span>
          {choosing && checked && <Check className='h-3.5 w-3.5 shrink-0 text-violet-700' aria-hidden='true' />}
        </button>;
      })}
    </div>
    {!visible.length && <p className='text-xs leading-5 text-slate-500'>No teaching marks match.</p>}
    {note && <p role='status' className='mt-2 text-xs leading-5 text-slate-600'>{note}</p>}
  </div>;
}
