import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Check, Copy, Layers, Lock, Minus, Plus, Trash2, X } from 'lucide-react';

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
  pieces, pictures, selected, me, srcFor, onSelect, onClear,
  onLayer, onDuplicate, onDelete, onResize, canResize, canShrink, canGrow,
  canDuplicate, canDelete, height = 500,
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef(null);
  const id = useId();
  const names = pictureNames(pieces, pictures);
  const ordered = [...pieces].sort((a, b) => b.z - a.z);
  const selectedIndex = ordered.findIndex((piece) => piece.id === selected?.id);
  const position = ordered.length < 2 ? '' : selectedIndex === 0 ? 'Front picture' : selectedIndex === ordered.length - 1 ? 'Back picture' : `Layer ${selectedIndex + 1} of ${ordered.length}`;
  const heldElsewhere = Boolean(selected?.heldBy && selected.heldBy !== me);
  const canOrder = me === 'tutor' && Boolean(onLayer);
  const owner = selected?.heldBy === 'tutor' ? 'Your tutor' : 'Your student';
  const quiet = () => { setOpen(false); toggle.current?.focus(); };

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
      <div className='pointer-events-none absolute left-2 right-14 top-2 z-20'>
        <button ref={toggle} type='button' aria-expanded={open} aria-controls={id} onClick={() => setOpen((was) => !was)} className={`${control} pointer-events-auto bg-white/95 shadow-sm`}>
          <Layers className='h-4 w-4' aria-hidden='true' />
          Layers <span className='rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-600'>{pieces.length}</span>
        </button>
        {open && (
          <section id={id} aria-label='Picture layers' className='pointer-events-auto mt-2 flex w-72 max-w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl' style={{ maxHeight: Math.max(150, Math.min(380, height - (selected ? 176 : 76))) }}>
            <div className='flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2'>
              <div><h3 className='text-sm font-bold text-slate-800'>Pictures on the board</h3><p className='text-xs text-slate-500'>Front to back</p></div>
              <button type='button' aria-label='Close layers' onClick={quiet} className={`${control} shrink-0 px-2`}><X className='h-4 w-4' aria-hidden='true' /></button>
            </div>
            <p className='shrink-0 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600'>Writing and letter tiles stay above pictures.</p>
            <ol className='min-h-0 overflow-y-auto p-1'>
              {ordered.map((piece, index) => {
                const active = selected?.id === piece.id;
                const locked = piece.heldBy && piece.heldBy !== me;
                return (
                  <li key={piece.id}>
                    <button type='button' aria-label={`Select ${names.get(piece.id)}${index === 0 ? ', front picture' : index === ordered.length - 1 ? ', back picture' : ''}`} aria-pressed={active} onClick={() => { onSelect(piece.id); quiet(); }} className={`flex min-h-14 w-full items-center gap-3 rounded-lg border px-2 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-violet-500 ${active ? 'border-violet-300 bg-violet-50' : 'border-transparent hover:bg-slate-50'}`}>
                      <Thumbnail piece={piece} picture={pictures.find((p) => p.id === piece.pic)} src={srcFor(piece.pic)} />
                      <span className='min-w-0 flex-1'><span className='block break-words text-xs font-semibold text-slate-800'>{names.get(piece.id)}</span><span className='mt-0.5 block text-[11px] text-slate-500'>{index === 0 ? 'Front' : index === ordered.length - 1 ? 'Back' : `Layer ${index + 1}`}{locked ? ` · ${piece.heldBy} is moving it` : ''}</span></span>
                      {locked ? <Lock className='h-4 w-4 shrink-0 text-slate-500' aria-hidden='true' /> : active ? <Check className='h-4 w-4 shrink-0 text-violet-700' aria-hidden='true' /> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </div>
      {selected && !(open && height < 340) && (
        <section aria-label='Selected picture' className='absolute bottom-2 left-2 right-2 z-20 mx-auto w-fit max-w-[calc(100%-1rem)] rounded-xl border border-violet-200 bg-white/95 p-2 shadow-lg'>
          <div className='flex items-center gap-2 pl-1'>
            <div className='min-w-0 flex-1'><p className='truncate text-xs font-bold text-slate-800'>{names.get(selected.id)}</p><p role='status' className='text-[11px] text-slate-500'>{position && `${position} · `}{heldElsewhere ? `${owner} is moving this picture.` : canResize ? 'Drag to move · Corners resize' : 'Drag to move this picture'}</p></div>
            <button type='button' aria-label='Deselect picture' onClick={() => { onClear(); toggle.current?.focus(); }} className={`${control} shrink-0 px-2`}><X className='h-4 w-4' aria-hidden='true' /></button>
          </div>
          {(canOrder || canDuplicate || canDelete || canResize) && (
            <div role='group' aria-label='Picture actions' className='mt-1 flex flex-wrap justify-center gap-1'>
              {canResize && <><button type='button' disabled={heldElsewhere || !canShrink} onClick={() => onResize(0.8)} className={control}><Minus className='h-4 w-4' aria-hidden='true' />Smaller</button><button type='button' disabled={heldElsewhere || !canGrow} onClick={() => onResize(1.25)} className={control}><Plus className='h-4 w-4' aria-hidden='true' />Larger</button></>}
              {canOrder && <><button type='button' aria-label='Bring picture to front' disabled={heldElsewhere || ordered[0]?.id === selected.id} onClick={() => onLayer(selected.id, 'front')} className={control} title='Bring to front of the pictures'><ArrowUpToLine className='h-4 w-4' aria-hidden='true' />Front</button><button type='button' aria-label='Send picture to back' disabled={heldElsewhere || ordered.at(-1)?.id === selected.id} onClick={() => onLayer(selected.id, 'back')} className={control} title='Send to back of the pictures'><ArrowDownToLine className='h-4 w-4' aria-hidden='true' />Back</button></>}
              {canDuplicate && <button type='button' disabled={heldElsewhere} onClick={() => onDuplicate(selected.id)} className={control}><Copy className='h-4 w-4' aria-hidden='true' />Duplicate</button>}
              {canDelete && <button type='button' disabled={heldElsewhere} onClick={() => onDelete(selected.id)} className={`${control} text-rose-700 hover:bg-rose-50`}><Trash2 className='h-4 w-4' aria-hidden='true' />Delete</button>}
            </div>
          )}
        </section>
      )}
    </>
  );
}
