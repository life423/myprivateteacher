import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, EyeOff, Flag } from 'lucide-react';
import { Link, useNavigationGuard } from '../router.jsx';

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40';
const names = { review: 'Review', build: 'Build words', dictation: 'Dictation', read: 'Read' };
function ReviewNote({ activity, runner }) {
  const [flagged, setFlagged] = useState(activity.reviewNextTime), [note, setNote] = useState(activity.reviewNote || '');
  const [saved, setSaved] = useState(false);
  const editVersion = useRef(0);
  // Keep unsaved notes mounted as the tutor visits other activities.
  const dirty = flagged !== activity.reviewNextTime || note !== (activity.reviewNote || '');
  useNavigationGuard(dirty, 'Leave without saving this private review note?');
  return <div className='space-y-2 border-t border-slate-200 pt-3'>
    <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-semibold ${flagged ? 'bg-amber-50 text-amber-900' : 'text-slate-700'}`}><input type='checkbox' checked={flagged} onChange={event => { editVersion.current++; setFlagged(event.target.checked); setSaved(false); }} className='h-4 w-4 accent-violet-600' /><Flag className='h-4 w-4 shrink-0' aria-hidden='true' />Review next time</label>
    <label className='block text-xs font-semibold text-slate-600'>Private review note<textarea maxLength={1000} rows={3} value={note} onChange={event => { editVersion.current++; setNote(event.target.value); setSaved(false); }} className='mt-1 block w-full resize-y rounded-lg border border-slate-300 p-2 text-sm font-normal leading-6 text-slate-800' placeholder='What should you revisit?' /></label>
    <button type='button' disabled={runner.saving || !dirty} onClick={async () => { const version = editVersion.current; if (await runner.saveReview(activity.id, flagged, note)) { if (version === editVersion.current) { setNote(note.trim()); setSaved(true); } } }} className={`${button} w-full border border-slate-200 bg-white text-violet-800 hover:bg-violet-50`}><Check className='h-4 w-4' aria-hidden='true' />{runner.saving ? 'Saving…' : 'Save review note'}</button>
    {saved && !dirty && <p role='status' className='text-xs text-emerald-700'>Review note saved</p>}
    {dirty && <p className='text-xs text-slate-500'>Unsaved note. Save before leaving this room.</p>}
  </div>;
}
export function directionBlocks(text = '') {
  const blocks = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = line.trim().match(/^(Model|Practice|Check|Readiness|Background)(?:\s*:\s*(.*))?$/i);
    if (heading) blocks.push({ heading: heading[1][0].toUpperCase() + heading[1].slice(1).toLowerCase(), text: heading[2] || '' });
    else if (blocks.length) blocks[blocks.length - 1].text += `${blocks[blocks.length - 1].text ? '\n' : ''}${line}`;
    else blocks.push({ heading: null, text: line });
  }
  return blocks.map(block => ({ ...block, text: block.text.trim() })).filter(block => block.text);
}
function Directions({ text }) {
  return <div className='space-y-4'>{directionBlocks(text).map((block, index) => ['Background', 'Readiness'].includes(block.heading) ? <details key={index} className='rounded-xl border border-slate-200 bg-slate-50 px-3'><summary className='min-h-11 cursor-pointer list-inside py-3 text-sm font-semibold text-slate-700'>{block.heading}</summary><p className='pb-3 whitespace-pre-wrap text-base leading-7 text-slate-700 [overflow-wrap:anywhere]'>{block.text}</p></details> : <section key={index} className='min-w-0'>{block.heading && <h4 className='mb-1 text-sm font-bold text-violet-800'>{block.heading}</h4>}<p className='whitespace-pre-wrap text-base leading-7 text-slate-700 [overflow-wrap:anywhere] sm:text-[17px]'>{block.text}</p></section>)}</div>;
}
export default function LessonPanel({ runner }) {
  const [selected, setSelected] = useState(0), [notesOpen, setNotesOpen] = useState(false);
  const { lesson, loading, busy, error, index } = runner;
  useEffect(() => { if (index >= 0) setSelected(index); }, [index]);
  useEffect(() => { setSelected(0); setNotesOpen(false); }, [lesson?.id]);
  const activity = lesson?.activities[selected];
  return <section aria-label='Prepared lesson' className='flex h-full min-h-0 min-w-0 flex-col'>
    <header className='shrink-0 border-b border-slate-200 px-5 py-3'>
      <h3 className='text-lg font-bold leading-7 text-slate-900 [overflow-wrap:anywhere]'>{lesson?.title || 'Lesson'}</h3>
      <p className='mt-1 flex items-center gap-1.5 text-xs text-slate-500'><EyeOff className='h-3.5 w-3.5' aria-hidden='true' />Your plan and notes stay private</p>
    </header>
    <div className='min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4'>
      {error && <div role='alert' className='rounded-lg bg-rose-50 p-3 text-sm leading-6 text-rose-800'><p>{error}</p>{lesson && <button type='button' disabled={loading} onClick={runner.reload} className={`${button} mt-1 border border-rose-200`}>Reload saved preparation</button>}</div>}
      {!lesson ? <>
        <p className='text-sm leading-6 text-slate-600'>Open a lesson you prepared, or make one before your student arrives.</p>
        <button type='button' disabled={loading} onClick={runner.refreshChoices} className={`${button} w-full border border-violet-200 bg-violet-50 text-violet-800`}>{loading ? 'Loading…' : 'Choose a saved lesson'}</button>
        <ul className='space-y-2'>{runner.choices.map(item => <li key={item.id}><button type='button' disabled={loading} onClick={() => runner.choose(item.id)} className={`${button} w-full justify-start border border-slate-200 text-left text-slate-800 hover:bg-slate-50`}><BookOpen className='h-4 w-4 shrink-0' aria-hidden='true' /><span className='min-w-0 truncate'>{item.title}</span></button></li>)}</ul>
        <Link to='/lessons' className={`${button} w-full text-violet-800 underline underline-offset-4`}>Prepare lesson</Link>
      </> : <>
        <label className='block text-sm font-semibold text-slate-600'>Activity<select aria-label='Lesson activity' disabled={busy || loading || !runner.ready} value={selected} onChange={event => { const next = Number(event.target.value); setSelected(next); void runner.activate(next); }} className='mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-800'>{lesson.activities.map((item, number) => <option key={item.id} value={number}>{number + 1}. {item.title || names[item.type]}</option>)}</select></label>
        {activity ? <>
          <div className='min-w-0 space-y-3 rounded-xl border border-violet-100 bg-violet-50/40 p-4'>
            <p className='text-xs font-bold uppercase tracking-wide text-violet-700'>{names[activity.type]}</p>
            <h3 className='text-xl font-bold leading-7 text-slate-900 [overflow-wrap:anywhere]'>{activity.title || names[activity.type]}</h3>
            {activity.directions && <Directions text={activity.directions} />}
            {activity.targets && <div><p className='mb-2 text-sm font-semibold text-slate-600'>For you to say or model</p><ul aria-label='Private practice words or sentences' className='flex flex-wrap gap-2'>{activity.targets.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map((value, index) => <li key={index} className='max-w-full rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-base font-semibold leading-6 text-slate-800 [overflow-wrap:anywhere]'>{value}</li>)}</ul></div>}
          </div>
          <button type='button' disabled={busy || !runner.ready || index === selected} onClick={() => runner.activate(selected)} className={`${button} w-full bg-violet-600 text-white hover:bg-violet-700`}>{busy ? 'Opening activity…' : index === selected ? 'Activity is on the board' : 'Start activity'}</button>
          <p className='text-xs leading-5 text-slate-500'>{activity.type === 'dictation' ? 'Your student gets a writing area. The words above stay private.' : 'Selected materials open on their own page. Returning keeps the work on that page.'}</p>
          <button type='button' aria-expanded={notesOpen} onClick={() => setNotesOpen(value => !value)} className={`${button} w-full justify-start text-slate-700 hover:bg-slate-50`}><Flag className='h-4 w-4' aria-hidden='true' />Review next time{activity.reviewNextTime && <span className='ml-auto rounded bg-amber-100 px-2 py-1 text-xs text-amber-900'>Flagged</span>}</button>
          {lesson.activities.map(item => <div key={item.id} hidden={!notesOpen || item.id !== activity.id}><ReviewNote activity={item} runner={runner} /></div>)}
        </> : <p className='text-sm leading-6 text-slate-600'>This lesson has no activities yet. Add them in preparation.</p>}
        <div className='flex flex-wrap gap-1 border-t border-slate-200 pt-2'><Link to={`/lessons/${lesson.id}`} className={`${button} text-violet-800 underline underline-offset-4`}>Edit preparation</Link><Link to='/lessons' className={`${button} text-slate-600`}>All lessons</Link></div>
      </>}
    </div>
    {lesson?.activities.length > 0 && <footer className='grid shrink-0 grid-cols-2 gap-3 border-t border-slate-200 bg-white px-5 py-3'>
      <button type='button' aria-label='Previous activity' disabled={busy || !runner.ready || selected <= 0} onClick={() => { setSelected(selected - 1); void runner.activate(selected - 1); }} className={`${button} border border-slate-200 text-slate-700`}><ArrowLeft className='h-4 w-4' aria-hidden='true' />Previous</button>
      <button type='button' aria-label='Next activity' disabled={busy || !runner.ready || selected >= lesson.activities.length - 1} onClick={() => { setSelected(selected + 1); void runner.activate(selected + 1); }} className={`${button} border border-violet-200 bg-violet-50 text-violet-800`}>Next<ArrowRight className='h-4 w-4' aria-hidden='true' /></button>
    </footer>}
  </section>;
}
