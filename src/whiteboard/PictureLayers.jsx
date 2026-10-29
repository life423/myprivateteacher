import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Check, EyeOff, Layers, Lock, Minus, Plus, X } from 'lucide-react';
import { pictureOverlapState } from './pictureGeometry.js';

const control = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';

function Thumbnail({ piece, picture, src }) {
  const clip = useId();
  if (!picture) return <span className='h-11 w-11 shrink-0 rounded-lg bg-slate-100' />;
  const { crop } = piece;
  return (
    <svg width='44' height='44' viewBox={`${crop.x} ${crop.y} ${crop.w} ${crop.h}`} className='shrink-0 rounded-lg bg-white ring-1 ring-slate-200' aria-hidden='true'>
      <defs><clipPath id={clip}><rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} rx={crop.r} /></clipPath></defs>
      <image href={src} width={picture.w} height={picture.h} clipPath={`url(#${clip})`} />
    </svg>
  );
}

export function pictureNames(pieces, pictures) {
  return new Map(pieces.map((piece) => {
    const picture = pictures.find((p) => p.id === piece.pic);
    const number = pictures.findIndex((p) => p.id === piece.pic) + 1;
    const copies = pieces.filter((p) => p.pic === piece.pic);
    const name = picture?.title || `Picture ${number || 1}`;
    return [piece.id, copies.length > 1 ? `${name} · ${copies.findIndex((p) => p.id === piece.id) + 1}` : name];
  }));
}

// The list stays available even when another picture completely covers the one wanted.
// Selecting a row does not change the stack; Front and Back are deliberate tutor actions.
export default function PictureLayers({
  pieces, pictures, selected, me, srcFor, onSelect, onClear, onOpenChange,
  onLayer, onResize, canResize, canShrink, canGrow, resizeLocked = false,
  height = 500, topOffset = 8, overlapState: suppliedOverlap, inline = false, open: externalOpen,
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = externalOpen === undefined ? localOpen : externalOpen;
  const setOpen = (value) => { const next = typeof value === 'function' ? value(open) : value; if (externalOpen === undefined) setLocalOpen(next); onOpenChange?.(next); };
  const element = useRef(null);
  const toggle = useRef(null);
  const id = useId();
  const availableHeight = Math.max(0, height - (inline ? 0 : topOffset));
  const names = pictureNames(pieces, pictures);
  const ordered = [...pieces].reverse().sort((a, b) => (b.z || 0) - (a.z || 0));
  const overlapState = suppliedOverlap || pictureOverlapState(pieces);
  const overlapping = [...overlapState.values()].filter((state) => state.above.length || state.below.length).length;
  const covered = [...overlapState.values()].filter((state) => state.covered).length;
  const heldElsewhere = Boolean(selected?.heldBy && selected.heldBy !== me);
  const canOrder = me === 'tutor' && Boolean(onLayer);
  const owner = selected?.heldBy === 'tutor' ? 'Your tutor' : 'Your student';
  const overlapDescription = (piece) => {
    const state = overlapState.get(piece.id);
    if (state?.covered) return canOrder ? 'Fully covered · Front reveals it' : 'Fully covered · Ask your tutor to bring it to front';
    if (state?.above.length) return `Partly covered by ${state.above.length} picture${state.above.length === 1 ? '' : 's'}`;
    if (state?.below.length) return `Over ${state.below.length} picture${state.below.length === 1 ? '' : 's'}`;
    return '';
  };
  const quiet = () => { setOpen(false); toggle.current?.focus(); };
  useEffect(() => { if (!pieces.length && open) setOpen(false); }, [pieces.length]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!element.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    if (!open && !selected) return undefined;
    const escape = (event) => {
      if (event.key !== 'Escape') return;
      if (open) quiet();
      else { onClear(); toggle.current?.focus(); }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [open, selected, onClear]);

  if (!pieces.length) return null;
  return (
    <>
      <div ref={element} data-picture-layers-control className={inline ? 'relative z-30 min-w-0 shrink-0' : 'pointer-events-none absolute left-2 right-14 z-20'} style={inline ? undefined : { top: topOffset }}>
        <button ref={toggle} type='button' aria-label={`Picture layers, ${pieces.length} picture${pieces.length === 1 ? '' : 's'}${overlapping ? `, ${overlapping} overlapping` : ''}${covered ? `, ${covered} fully covered` : ''}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((was) => !was)} className={`${control} pointer-events-auto relative max-w-full ${inline ? 'whitespace-nowrap !px-2' : 'flex-wrap bg-white/95 shadow-sm'}`}>
          <Layers className='h-4 w-4' aria-hidden='true' />
          Layers <span className='rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-600'>{pieces.length}</span>
          {inline ? overlapping > 0 && <span data-overlap-count={overlapping} data-covered-count={covered || undefined} aria-hidden='true' className='absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-200 px-1 text-[10px] font-extrabold text-amber-950'>{covered ? <EyeOff className='h-3 w-3' /> : '!'}</span> : <>
            {overlapping > 0 && <span data-overlap-count={overlapping} className='rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-900'>{overlapping} overlapping</span>}
            {covered > 0 && <span data-covered-count={covered} className='inline-flex items-center gap-1 rounded-md bg-rose-100 px-1.5 py-0.5 text-rose-900'><EyeOff className='h-3 w-3' aria-hidden='true' />{covered} covered</span>}
          </>}
        </button>
        {open && (
          <section id={id} aria-label='Picture layers' className={`pointer-events-auto flex w-72 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ${inline ? 'absolute right-0 top-full mt-1 max-w-[calc(100vw-2rem)]' : 'mt-2 max-w-full'}`} style={{ maxHeight: Math.max(44, Math.min(380, availableHeight - (inline ? 4 : 60))) }}>
            <div className='flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2'>
              <div><h3 className='text-sm font-bold text-slate-800'>Pictures on the board</h3><p className='text-xs text-slate-500'>Front to back</p></div>
              <button type='button' aria-label='Close layers' onClick={quiet} className={`${control} shrink-0 px-2`}><X className='h-4 w-4' aria-hidden='true' /></button>
            </div>
            {availableHeight >= 240 && <p className='shrink-0 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600'>{overlapping ? 'Amber edges mark overlapping pictures. Select a covered picture here, then use Front to reveal it. ' : ''}Writing and letter tiles stay above pictures.</p>}
            <div className='min-h-0 overflow-y-auto'>
            <ol className='p-1'>
              {ordered.map((piece, index) => {
                const active = selected?.id === piece.id;
                const locked = piece.heldBy && piece.heldBy !== me;
                const state = overlapState.get(piece.id);
                const description = overlapDescription(piece);
                return (
                  <li key={piece.id}>
                    <button type='button' data-picture-layer={piece.id} aria-label={`Select ${names.get(piece.id)}${index === 0 ? ', front picture' : index === ordered.length - 1 ? ', back picture' : ''}${description ? `, ${description}` : ''}`} aria-pressed={active} onClick={() => { onSelect(piece.id); quiet(); }} className={`flex min-h-14 w-full items-center gap-3 rounded-lg border px-2 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-violet-500 ${active ? 'border-violet-300 bg-violet-50' : 'border-transparent hover:bg-slate-50'}`}>
                      <Thumbnail piece={piece} picture={pictures.find((p) => p.id === piece.pic)} src={srcFor(piece.pic)} />
                      <span className='min-w-0 flex-1'><span className='block break-words text-xs font-semibold text-slate-800'>{names.get(piece.id)}</span><span className='mt-0.5 block text-[11px] text-slate-500'>{index === 0 ? 'Front' : index === ordered.length - 1 ? 'Back' : `Layer ${index + 1}`}{locked ? ` · ${piece.heldBy} is moving it` : ''}</span>{description && <span className={`mt-0.5 block text-[11px] font-semibold ${state.covered ? 'text-rose-700' : 'text-amber-800'}`}>{description}</span>}</span>
                      {locked ? <Lock className='h-4 w-4 shrink-0 text-slate-500' aria-hidden='true' /> : active ? <Check className='h-4 w-4 shrink-0 text-violet-700' aria-hidden='true' /> : state?.covered ? <EyeOff className='h-4 w-4 shrink-0 text-rose-700' aria-hidden='true' /> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
            {selected && <div className='shrink-0 border-t border-slate-100 p-2'>
              <p className='truncate px-1 text-xs font-semibold text-slate-700'>{names.get(selected.id)}</p>
              <p role='status' className='px-1 text-[11px] text-slate-500'>{heldElsewhere ? `${owner} is moving this picture.` : resizeLocked ? 'Drag to move · Your tutor controls size' : 'Drag to move · Corners resize'}</p>
              {(canResize || canOrder) && <div role='group' aria-label='Picture size and order' className='mt-1 flex flex-wrap gap-1'>
                {canResize && <><button type='button' disabled={heldElsewhere || !canShrink} onClick={() => onResize(0.8)} className={control}><Minus className='h-4 w-4' aria-hidden='true' />Smaller</button><button type='button' disabled={heldElsewhere || !canGrow} onClick={() => onResize(1.25)} className={control}><Plus className='h-4 w-4' aria-hidden='true' />Larger</button></>}
                {canOrder && <><button type='button' aria-label='Bring picture to front' disabled={heldElsewhere || ordered[0]?.id === selected.id} onClick={() => onLayer(selected.id, 'front')} className={control}><ArrowUpToLine className='h-4 w-4' aria-hidden='true' />Front</button><button type='button' aria-label='Send picture to back' disabled={heldElsewhere || ordered.at(-1)?.id === selected.id} onClick={() => onLayer(selected.id, 'back')} className={control}><ArrowDownToLine className='h-4 w-4' aria-hidden='true' />Back</button></>}
              </div>}
            </div>}
            </div>
          </section>
        )}
      </div>

    </>
  );
}
