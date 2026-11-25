import { useEffect, useState } from 'react';
import { Link } from '../router.jsx';
import { MessageScreen } from '../whiteboard/ui.jsx';

export default function ScheduledStart({ children }) {
  const [appointment] = useState(() => new URLSearchParams(window.location.search).get('appointment'));
  const [state, setState] = useState(appointment ? 'loading' : 'ready');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!appointment) return undefined;
    const controller = new AbortController();
    setState('loading');
    fetch(`/api/schedule/occurrences/${encodeURIComponent(appointment)}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('unavailable');
        const result = await response.json();
        if (!result.occurrence) throw new Error('unavailable');
        if (controller.signal.aborted) return;
        // Use the current owned preparation, including a change since this
        // calendar card was rendered. A bookmarked appointment also starts fresh.
        const url = new URL(window.location.href);
        if (result.occurrence.lessonId) url.searchParams.set('lesson', result.occurrence.lessonId);
        else url.searchParams.delete('lesson');
        if (!/^[A-Za-z0-9_-]{16,80}$/.test(url.searchParams.get('start') || '')) url.searchParams.set('start', crypto.randomUUID());
        window.history.replaceState(window.history.state, '', url.href);
        setState('ready');
      })
      .catch(error => { if (!controller.signal.aborted && error.name !== 'AbortError') setState('error'); });
    return () => controller.abort();
  }, [appointment, attempt]);
  if (state === 'ready') return children;
  if (state === 'loading') return <MessageScreen title='Opening your scheduled lesson'><span role='status'>Checking the lesson details…</span></MessageScreen>;
  return <MessageScreen title='This scheduled lesson could not be opened'>
    <p>It may have been cancelled or changed. Your calendar has the latest details.</p>
    <div className='mt-4 flex flex-wrap justify-center gap-3'>
      <Link to='/calendar' className='inline-flex min-h-11 items-center rounded-xl bg-violet-600 px-4 py-2 font-semibold text-white hover:bg-violet-700'>Return to calendar</Link>
      <button type='button' onClick={() => setAttempt(value => value + 1)} className='min-h-11 rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50'>Try again</button>
    </div>
  </MessageScreen>;
}
