import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cleanMaterialsView, loadMaterialsView, saveMaterialsView } from './materials.js';

// Search and scroll belong to each materials tab. The content can unmount safely;
// changing a tab never overwrites another tab's saved browsing position.
export default function MaterialsWorkspace({ scope, tabs, supplement }) {
  const [view, setView] = useState(() => loadMaterialsView(scope));
  const area = useRef(null), buttons = useRef({}), restoring = useRef(false);
  const uid = useId();
  const current = tabs.some((tab) => tab.id === view.active) ? view.active : tabs[0]?.id;
  const selected = tabs.find((tab) => tab.id === current);
  const search = useRef(null);
  useEffect(() => { saveMaterialsView(scope, view); }, [scope, view]);
  const update = (patch) => setView((old) => cleanMaterialsView({ ...old, ...patch }));
  const choose = (id, focus = false) => {
    const scrollTop = area.current?.scrollTop || 0;
    setView((old) => cleanMaterialsView({ ...old, [current]: { ...old[current], scrollTop }, active: id }));
    if (focus) buttons.current[id]?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    const element = area.current;
    if (!element || !selected) return undefined;
    restoring.current = true;
    const restore = () => {
      if (!restoring.current) return;
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      element.scrollTop = Math.min(view[current].scrollTop, maximum);
      if (maximum >= view[current].scrollTop) restoring.current = false;
    };
    const observer = new ResizeObserver(restore);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    restore();
    const frame = requestAnimationFrame(restore);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [current, view[current]?.query]);
  const changeQuery = (query) => update({ [current]: { ...view[current], query, scrollTop: 0 } });
  return (
    <div data-materials-workspace className='flex h-full min-h-0 flex-1 flex-col gap-2'>
      <section aria-label='Materials' className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow'>
        <header className='shrink-0 border-b border-slate-100 p-3'>
          <h2 className='mb-2 text-sm font-bold text-slate-800'>Materials</h2>
          <div role='tablist' aria-label='Materials' className='grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1'>
            {tabs.map((tab, index) => <button key={tab.id} ref={(node) => { buttons.current[tab.id] = node; }} id={`${uid}-${tab.id}-tab`} role='tab' type='button' aria-selected={current === tab.id} aria-controls={`${uid}-${tab.id}-panel`} tabIndex={current === tab.id ? 0 : -1} onClick={() => choose(tab.id)} onKeyDown={(event) => {
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
              if (next === null) return;
              event.preventDefault(); choose(tabs[next].id, true);
            }} className={`min-h-11 min-w-0 rounded-lg px-1 text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500 ${current === tab.id ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-700 hover:bg-white'}`}>{tab.label}</button>)}
          </div>
          <div className='relative mt-2'>
            <Search className='pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500' aria-hidden='true' />
            <input ref={search} type='search' aria-label={`Search ${selected?.label.toLowerCase()}`} placeholder={`Search ${selected?.label.toLowerCase()}`} value={view[current]?.query || ''} onChange={(event) => changeQuery(event.target.value)} autoComplete='off' spellCheck={false} className='min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-10 text-sm text-slate-800 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500' />
            {view[current]?.query && <button type='button' aria-label={`Clear ${selected?.label.toLowerCase()} search`} onClick={() => { changeQuery(''); search.current?.focus(); }} className='absolute right-0 top-0 inline-flex h-11 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100'><X className='h-4 w-4' aria-hidden='true' /></button>}
          </div>
        </header>
        <div ref={area} data-materials-scroll onWheel={() => { restoring.current = false; }} onPointerDown={() => { restoring.current = false; }} onKeyDownCapture={() => { restoring.current = false; }} className='min-h-0 flex-1 overflow-y-auto p-3' onScroll={() => {
          if (!restoring.current) setView((old) => ({ ...old, [current]: { ...old[current], scrollTop: area.current.scrollTop } }));
        }}>
          <div key={current} id={`${uid}-${current}-panel`} role='tabpanel' aria-labelledby={`${uid}-${current}-tab`} className='min-w-0'>{selected?.content(view[current]?.query || '')}</div>
        </div>
      </section>
      {supplement}
    </div>
  );
}
