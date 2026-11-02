import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const HINT_KEY = 'mpt.studentJoinHint.v1';
const JOINED_KEY = 'mpt.studentJoinedRoom';
let seenInThisPage = false;

function seenHint() {
  try { return seenInThisPage || localStorage.getItem(HINT_KEY) === 'seen'; }
  catch { return seenInThisPage; }
}

function rememberHint() {
  seenInThisPage = true;
  try { localStorage.setItem(HINT_KEY, 'seen'); } catch { /* Still once per page when storage is blocked. */ }
}

function joinedRoom() {
  try { return sessionStorage.getItem(JOINED_KEY); } catch { return null; }
}

export function clearStudentJoinHistory() {
  try { sessionStorage.removeItem(JOINED_KEY); } catch { /* The current room still ends normally. */ }
}

export function useStudentJoinHelp({ code, roomKey, ready, studentHere }) {
  const [hintOpen, setHintOpen] = useState(() => !seenHint());
  const [joined, setJoined] = useState(joinedRoom);
  const [spaceForHint, setSpaceForHint] = useState(() => window.innerHeight >= 500 || window.innerHeight >= window.innerWidth);
  const hasJoined = studentHere || (Boolean(roomKey) && joined === roomKey);
  const hintVisible = Boolean(ready && code && !hasJoined && hintOpen && spaceForHint);

  useEffect(() => {
    const resize = () => setSpaceForHint(window.innerHeight >= 500 || window.innerHeight >= window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    if (!spaceForHint && seenHint()) setHintOpen(false);
  }, [spaceForHint]);

  useEffect(() => {
    // Remember presentation, not just dismissal: a refresh must not repeat the hint.
    if (hintVisible || (ready && studentHere)) rememberHint();
    if (ready && studentHere && roomKey) {
      setHintOpen(false);
      setJoined(roomKey);
      try { sessionStorage.setItem(JOINED_KEY, roomKey); } catch { /* Keep the in-memory choice. */ }
    }
  }, [hintVisible, ready, studentHere, roomKey]);

  useEffect(() => {
    const sync = (event) => {
      if (event.key === HINT_KEY && event.newValue === 'seen') setHintOpen(false);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  return {
    hintVisible,
    helpVisible: Boolean(ready && code && !hasJoined),
    dismissHint: () => { rememberHint(); setHintOpen(false); },
  };
}

// Automatic removal on student connection must not leave keyboard focus on a removed node.
function useRemovalFocus(ref, selector) {
  useLayoutEffect(() => {
    const node = ref.current;
    return () => {
      if (node?.contains(document.activeElement)) {
        node.closest('[data-tutor-header]')?.querySelector(selector)?.focus({ preventScroll: true });
      }
    };
  }, [ref, selector]);
}

export function StudentJoinHint({ code, site, onDismiss }) {
  const ref = useRef(null);
  useRemovalFocus(ref, '[aria-label="Copy lesson link"], [aria-label="Copied lesson link"]');
  return (
    <aside ref={ref} aria-label='Student joining tip' className='flex items-center justify-end gap-3 border-b border-violet-100 bg-violet-50 px-3 py-2 text-sm leading-5 text-violet-900 sm:px-4'>
      <p>Share the lesson link, or have your student join at <span className='font-semibold break-all'>{site}</span> with code <strong className='font-mono'>{code}</strong>.</p>
      <button type='button' onClick={onDismiss} className='inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 font-semibold transition-colors duration-150 hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 motion-reduce:transition-none'>Got it</button>
    </aside>
  );
}

export function StudentJoinInstructions({ code, site }) {
  const ref = useRef(null);
  useRemovalFocus(ref, '[aria-label="Lesson controls"]');
  return (
    <details ref={ref} data-student-join-help className='border-t border-slate-200 pt-2'>
      <summary className='min-h-11 cursor-pointer rounded-lg px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500'>How students join</summary>
      <p className='px-3 pb-3 text-sm leading-6 text-slate-600'>Share the lesson link, or ask your student to open <span className='font-semibold break-all'>{site}</span>, choose <strong>Join a lesson</strong> and enter <strong className='font-mono text-slate-900'>{code}</strong>. Students don’t need an account.</p>
    </details>
  );
}
