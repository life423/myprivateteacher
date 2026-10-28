import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Users, X } from 'lucide-react';
import { navigate } from '../router.jsx';
import { isRoomCode } from '../whiteboard/stage.js';

// Students enter the tutor's code here without an account or a second join page.
// One real input supports pasting, a phone's numeric keyboard and screen readers.
const LessonJoinForm = forwardRef(function LessonJoinForm(_, ref) {
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const titleId = `${fieldId}-title`;
  const input = useRef(null);
  const trigger = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const open = () => {
    setError('');
    setExpanded(true);
    // Header Join also refocuses an entry that was already open.
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  };
  useImperativeHandle(ref, () => ({ open }), []);
  useLayoutEffect(() => {
    if (expanded) input.current?.focus({ preventScroll: true });
  }, [expanded]);
  const close = () => {
    setExpanded(false);
    setError('');
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  const join = (event) => {
    event.preventDefault();
    if (!isRoomCode(code)) {
      setError('Enter all 4 numbers from your tutor.');
      input.current?.focus();
      return;
    }
    navigate(`/whiteboard/${code}`);
  };

  return (
    <section id='join-lesson' data-expanded={expanded} className='grid min-w-0 max-w-md scroll-mt-24 data-[expanded=true]:order-4 data-[expanded=true]:col-span-full data-[expanded=true]:basis-full'>
      <button ref={trigger} type='button' onClick={open} aria-expanded={expanded} aria-controls={`${fieldId}-entry`} className={`${expanded ? 'hidden' : 'inline-flex'} [grid-area:1/1] min-h-12 w-auto max-w-full justify-self-start self-start items-center justify-center gap-1.5 rounded-xl border border-sky-300 bg-white px-3 py-3 text-sm sm:gap-2 sm:px-5 sm:text-base font-semibold text-sky-800 hover:border-sky-500 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700`}>
        <Users className='hidden h-5 w-5 shrink-0 sm:block' aria-hidden='true' />
        Join a lesson <ArrowRight className='h-4 w-4 shrink-0' aria-hidden='true' />
      </button>
      <div id={`${fieldId}-entry`} aria-hidden={!expanded} inert={expanded ? undefined : ''} className={`[grid-area:1/1] grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${expanded ? 'w-full grid-rows-[1fr] opacity-100' : 'pointer-events-none w-0 grid-rows-[0fr] opacity-0'}`}>
        <div className='min-h-0 overflow-hidden'>
          <form aria-labelledby={titleId} noValidate onSubmit={join} className='rounded-2xl border border-sky-200 bg-white/90 p-4 sm:p-5'>
            <div className='flex items-center gap-2'>
              <Users className='h-5 w-5 shrink-0 text-sky-700' aria-hidden='true' />
              <h2 id={titleId} className='flex-1 text-lg font-bold leading-tight text-slate-900'>Join your lesson</h2>
              <button type='button' onClick={close} aria-label='Close lesson code entry' className='-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-700'>
                <X className='h-5 w-5' aria-hidden='true' />
              </button>
            </div>
            <label htmlFor={fieldId} className='mt-2 block text-sm leading-relaxed text-slate-600'>Enter the 4-digit code from your tutor.</label>
            <div className='mt-3 flex flex-col gap-2 min-[360px]:flex-row'>
              <input
                ref={input}
                id={fieldId}
                name='lesson-code'
                type='text'
                inputMode='numeric'
                autoComplete='off'
                enterKeyHint='go'
                pattern='[0-9]{4}'
                required
                value={code}
                onChange={(event) => {
                  // Ignore separators in a pasted code, but do not silently turn an
                  // overlong code into a different valid lesson.
                  setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 8));
                  setError('');
                }}
                aria-describedby={hintId}
                aria-invalid={Boolean(error)}
                placeholder='1234'
                className={`min-h-12 min-w-0 flex-1 rounded-xl border-2 bg-white px-3 py-2 text-center font-mono text-2xl font-bold tracking-[0.2em] text-slate-900 placeholder:text-slate-400 focus:outline focus:outline-2 focus:outline-offset-2 ${error ? 'border-rose-500 focus:outline-rose-500' : 'border-sky-200 focus:border-sky-600 focus:outline-sky-600'}`}
              />
              <button type='submit' className='inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-3 text-sm font-bold text-white hover:bg-sky-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700'>
                Join lesson <ArrowRight className='h-4 w-4' aria-hidden='true' />
              </button>
            </div>
            <p id={hintId} role={error ? 'alert' : undefined} className={`mt-2 text-xs leading-relaxed ${error ? 'font-semibold text-rose-700' : 'text-slate-500'}`}>
              {error || 'No account needed. Just your lesson code.'}
            </p>
          </form>
        </div>
      </div>
    </section>
  );
});

export default LessonJoinForm;
