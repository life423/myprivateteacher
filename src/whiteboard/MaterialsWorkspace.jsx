import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, BookOpen, Milestone, Search, X } from 'lucide-react';
import { cleanMaterialsView, loadMaterialsView, saveMaterialsView } from './materials.js';

// Search and scroll belong to each materials tab. The content can unmount safely;
// changing a tab never overwrites another tab's saved browsing position.
export default function MaterialsWorkspace({ scope, tabs, activity, lesson }) {
  const [view, setView] = useState(() => loadMaterialsView(scope));
  const area = useRef(null), buttons = useRef({}), restoring = useRef(false);
  const frame = useRef(null);
  const [constrained, setConstrained] = useState(false);
  const scrollArea = constrained ? frame : area;
  const uid = useId();
  const current = tabs.some((tab) => tab.id === view.active) ? view.active : tabs[0]?.id;
  const selected = tabs.find((tab) => tab.id === current);
  const search = useRef(null);
  const activityTrigger = useRef(null), activityHeading = useRef(null);
  const lessonTrigger = useRef(null), lessonFrame = useRef(null), wasLessonOpen = useRef(false);
  const activityOpen = Boolean(activity?.open);
  const lessonOpen = Boolean(lesson?.open);
  const wasActivityOpen = useRef(activityOpen);
  useEffect(() => { saveMaterialsView(scope, view); }, [scope, view]);
  const update = (patch) => setView((old) => cleanMaterialsView({ ...old, ...patch }));
  const choose = (id, focus = false) => {
    const scrollTop = scrollArea.current?.scrollTop || 0;
    setView((old) => cleanMaterialsView({ ...old, [current]: { ...old[current], scrollTop }, active: id }));
    if (focus) buttons.current[id]?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    const element = scrollArea.current;
    if (!element || !selected || activityOpen || lessonOpen) return undefined;
    restoring.current = true;
    const restore = () => {
      if (!restoring.current) return;
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      element.scrollTop = Math.min(view[current].scrollTop, maximum);
      if (maximum >= view[current].scrollTop) restoring.current = false;
    };
    const observer = new ResizeObserver(restore);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    if (area.current && area.current !== element) observer.observe(area.current);
    restore();
    const frame = requestAnimationFrame(restore);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [current, view[current]?.query, activityOpen, lessonOpen, constrained]);
  // A pinned header must not leave a tiny results slit beside an active call.
  // At constrained heights the same panel scrolls as a whole, with one scroll owner.
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return undefined;
    const measure = () => {
      if (element.clientHeight > 0) setConstrained(element.clientHeight < 260);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activityOpen]);
  useLayoutEffect(() => {
    if (activityOpen !== wasActivityOpen.current) {
      (activityOpen ? activityHeading.current : activityTrigger.current)?.focus({ preventScroll: true });
      wasActivityOpen.current = activityOpen;
    }
  }, [activityOpen]);
  useLayoutEffect(() => {
    if (lessonOpen !== wasLessonOpen.current) {
      (lessonOpen ? lessonFrame.current?.querySelector('h2') : lessonTrigger.current)?.focus({ preventScroll: true });
      wasLessonOpen.current = lessonOpen;
    }
  }, [lessonOpen]);
  const openActivity = () => {
    const scrollTop = scrollArea.current?.scrollTop || 0;
    setView((old) => cleanMaterialsView({ ...old, [current]: { ...old[current], scrollTop } }));
    activity.onOpen();
  };
  const changeQuery = (query) => update({ [current]: { ...view[current], query, scrollTop: 0 } });
  const stopRestoring = () => { restoring.current = false; };
  const rememberScroll = (event) => {
    if (activityOpen || lessonOpen || restoring.current || event.currentTarget !== scrollArea.current) return;
    const scrollTop = scrollArea.current.scrollTop;
    setView((old) => ({ ...old, [current]: { ...old[current], scrollTop } }));
  };
  return (
    <div data-materials-workspace data-workspace-view={activityOpen ? 'games' : 'materials'} className='flex h-full min-h-0 flex-1 flex-col gap-2'>
      {/* Keep materials mounted while game controls are open, including unsent tile text. */}
      <section ref={frame} aria-label='Materials' hidden={activityOpen || lessonOpen} data-materials-scroll={constrained || undefined} onWheel={stopRestoring} onPointerDown={stopRestoring} onKeyDownCapture={stopRestoring} onScroll={rememberScroll} className={`${activityOpen || lessonOpen ? 'hidden' : 'flex'} ${constrained ? 'overflow-y-auto' : 'overflow-hidden'} min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white`}>
        <header className={`shrink-0 border-b border-slate-200 px-3 ${constrained ? 'py-2' : 'pb-3 pt-3'}`}>
          <h2 data-workspace-heading className={constrained ? 'sr-only' : 'mb-2 text-sm font-bold text-slate-800'}>Materials</h2>
          <div role='tablist' aria-label='Materials' className='grid grid-cols-3 gap-1 border-b border-slate-200'>
            {tabs.map((tab, index) => <button key={tab.id} ref={(node) => { buttons.current[tab.id] = node; }} id={`${uid}-${tab.id}-tab`} role='tab' type='button' aria-selected={current === tab.id} aria-controls={`${uid}-${tab.id}-panel`} tabIndex={current === tab.id ? 0 : -1} onClick={() => choose(tab.id)} onKeyDown={(event) => {
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
              if (next === null) return;
              event.preventDefault(); choose(tabs[next].id, true);
            }} className={`min-h-11 min-w-0 rounded-t-lg border-b-2 px-1 text-xs font-bold transition-colors duration-150 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500 ${current === tab.id ? 'border-violet-600 bg-violet-50 text-violet-800' : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}>{tab.label}</button>)}
          </div>
          <div className={`relative ${constrained ? 'mt-2' : 'mt-3'}`}>
            <Search className='pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500' aria-hidden='true' />
            <input ref={search} type='search' aria-label={`Search ${selected?.label.toLowerCase()}`} placeholder={`Search ${selected?.label.toLowerCase()}`} value={view[current]?.query || ''} onChange={(event) => changeQuery(event.target.value)} autoComplete='off' spellCheck={false} className='min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-10 text-sm text-slate-800 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500' />
            {view[current]?.query && <button type='button' aria-label={`Clear ${selected?.label.toLowerCase()} search`} onClick={() => { changeQuery(''); search.current?.focus(); }} className='absolute right-0 top-0 inline-flex h-11 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100'><X className='h-4 w-4' aria-hidden='true' /></button>}
          </div>
        </header>
        <div ref={area} data-materials-scroll={!constrained || undefined} onScroll={rememberScroll} className={`min-h-0 p-3 ${constrained ? 'shrink-0' : 'flex-1 overflow-y-auto'}`} onWheel={stopRestoring} onPointerDown={stopRestoring} onKeyDownCapture={stopRestoring}>
          <div key={current} id={`${uid}-${current}-panel`} role='tabpanel' aria-labelledby={`${uid}-${current}-tab`} className='min-w-0'>{selected?.content(view[current]?.query || '')}</div>
        </div>
      </section>
      {lesson && <div ref={lessonFrame} hidden={!lessonOpen} className={`${lessonOpen ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white`}>{lesson.content}</div>}

      {activity && <>
        <section id={`${uid}-games`} aria-label='Games' hidden={!activityOpen || lessonOpen} className={`${activityOpen && !lessonOpen ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white`}>
          <header className='shrink-0 border-b border-slate-200 px-3 pb-3 pt-2'>
            <button type='button' onClick={activity.onClose} className='-ml-2 mb-1 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-violet-800 transition-colors duration-150 motion-reduce:transition-none hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500'>
              <ArrowLeft className='h-4 w-4' aria-hidden='true' />Return to materials
            </button>
            <h2 ref={activityHeading} tabIndex={-1} data-workspace-heading className='rounded text-base font-bold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500'>Games</h2>
            <p className='mt-1 text-xs leading-relaxed text-slate-500'>Controls for the activity on your board.</p>
          </header>
          <div data-games-panel className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>{activity.content}</div>
        </section>

      </>}
      {!lessonOpen && !activityOpen && (lesson || activity) && <div className={`grid shrink-0 gap-2 ${lesson && activity ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {lesson && <section aria-label='Lesson shortcuts' className='min-w-0 rounded-xl border border-slate-200 bg-white'><button ref={lessonTrigger} type='button' aria-label='Lesson' aria-expanded={false} onClick={lesson.onOpen} className='flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-700 transition-colors duration-150 motion-reduce:transition-none hover:bg-violet-50'><BookOpen className='h-4 w-4 shrink-0' aria-hidden='true' /><span className='min-w-0 flex-1 truncate'>{lesson.title || 'Lesson'}{lesson.detail && <span className='mt-0.5 block text-xs font-medium text-slate-500'>{lesson.detail}</span>}</span><ChevronRight className='h-4 w-4 shrink-0 text-slate-500' aria-hidden='true' /></button></section>}
        {activity && <section aria-label='Game shortcuts' className='min-w-0 rounded-xl border border-slate-200 bg-white'>
          <button ref={activityTrigger} type='button' aria-label={activity.current ? 'Game controls' : 'Games'} aria-expanded={activityOpen} aria-controls={`${uid}-games`} onClick={openActivity} className='flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold text-slate-700 transition-colors duration-150 motion-reduce:transition-none hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500'>
            <Milestone className='h-4 w-4 shrink-0' aria-hidden='true' />
            <span className='min-w-0 flex-1 truncate'>{activity.current || 'Games'}{activity.current && <span className='mt-0.5 block text-xs font-medium text-slate-500'>{activity.detail ? `${activity.detail} · ` : ''}Game controls</span>}</span>
            <ChevronRight className='h-4 w-4 shrink-0 text-slate-500' aria-hidden='true' />
          </button>
          {activity.quickAction && <div className='border-t border-slate-100 px-2 pb-2'>{activity.quickAction}</div>}
        </section>}
      </div>}
    </div>
  );
}
