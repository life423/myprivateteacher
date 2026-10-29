import { useEffect, useId, useRef } from 'react';
import { ChevronDown, Grid, RotateCcw, Scan } from 'lucide-react';
import { BOX_COUNTS } from '../../shared/tiles.js';

const control = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500 disabled:opacity-40';

// A board control, not another activity. The selected count and taps come from
// the shared room; showing the boxes changes only this person's local view.
export default function SoundBoxControls({ count = 0, taps = [], onCount, onReset, onShow, open = false, onOpenChange, height = 300 }) {
  const element = useRef(null), trigger = useRef(null);
  const id = useId(), statusId = useId();
  const marked = new Set(taps.filter((index) => Number.isInteger(index) && index >= 0 && index < count)).size;
  const close = (focus = false) => { onOpenChange?.(false); if (focus) trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!open) return undefined;
    element.current?.querySelector('[data-box-count][aria-pressed="true"]')?.focus({ preventScroll: true });
    const outside = (event) => { if (!element.current?.contains(event.target)) onOpenChange?.(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]); // callbacks always belong to the current controlled popover
  if (!onCount && !count) return null;
  return <div ref={element} className='relative min-w-0' onKeyDown={(event) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); }
  }}>
    <button ref={trigger} type='button' aria-label={onCount ? 'Sound boxes' : 'Show sound boxes'} aria-describedby={statusId} aria-expanded={onCount ? open : undefined} aria-controls={onCount ? id : undefined} onClick={() => onCount ? onOpenChange?.(!open) : onShow?.()} className={`${control} whitespace-nowrap ${count ? 'border-violet-200 text-violet-800' : ''}`}>
      <Grid className='h-4 w-4 shrink-0 text-violet-600' aria-hidden='true' />Sound boxes
      <span className='rounded-md bg-violet-50 px-1.5 py-0.5 tabular-nums text-violet-800'>{count ? `${marked}/${count}` : 'Off'}</span>
      {onCount && <ChevronDown className={`h-3.5 w-3.5 shrink-0 ${open ? 'rotate-180' : ''}`} aria-hidden='true' />}
    </button>
    <span id={statusId} role='status' aria-live='polite' className='sr-only'>{count ? `${marked} of ${count} sound boxes tapped` : 'Sound boxes are off'}</span>
    {onCount && open && <section id={id} data-sound-box-settings aria-label='Sound box settings' className='absolute left-0 top-full z-40 mt-1 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-xl' style={{ maxHeight: Math.max(44, height - 4) }}>
      <h2 className='text-sm font-bold text-slate-800'>Sound boxes</h2>
      <p className='mt-1 text-xs leading-relaxed text-slate-600'>Choose one box for each sound. Tap a box to mark it; tap again to undo.</p>
      <div role='group' aria-label='Sound box count' className='mt-2 grid grid-cols-5 gap-1'>
        {BOX_COUNTS.map((number) => <button key={number} data-box-count={number} type='button' aria-label={number ? `${number} sound boxes` : 'Turn sound boxes off'} aria-pressed={count === number} onClick={() => { onCount(number); close(true); }} className={`min-h-11 rounded-lg text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500 ${count === number ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-violet-50'}`}>{number || 'Off'}</button>)}
      </div>
      {count > 0 && <>
        <p className='mt-2 text-xs font-semibold text-slate-700'>{marked} of {count} sound boxes tapped</p>
        <div className='mt-2 grid grid-cols-1 gap-1.5'>
          <button type='button' disabled={!onReset || !marked} onClick={() => { onReset(); close(true); }} className={control}><RotateCcw className='h-4 w-4' aria-hidden='true' />Reset counters</button>
          <button type='button' onClick={() => { onShow?.(); close(true); }} className={control}><Scan className='h-4 w-4' aria-hidden='true' />Show boxes in view</button>
        </div>
      </>}
    </section>}
  </div>;
}
