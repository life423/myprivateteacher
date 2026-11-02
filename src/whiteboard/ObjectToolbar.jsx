import { useLayoutEffect, useRef, useState } from 'react';
import { Copy, Crop, Trash2, X } from 'lucide-react';
import { objectToolbarPosition } from './objectToolbarPosition.js';
import ObjectSizeControl from './ObjectSizeControl.jsx';

const action = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-700 hover:bg-violet-50 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500';

export default function ObjectToolbar({ object, piece, kind, label, layout, viewport, topInset, reserved, locked, resizeLocked, placementNotice, onCrop, onDuplicate, onDelete, onClear, onPointerInput, canResize, resizeCorner, onSizeStart, onSizeChange, onSizeEnd }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 260, height: 54 });
  const [measuredReserved, setMeasuredReserved] = useState([]);
  const [sizeOpen, setSizeOpen] = useState(false);
  const sizeAnchor = useRef(null);
  const dismissSize = useRef(null);
  const compact = viewport.width < 380;
  useLayoutEffect(() => {
    const node = ref.current;
    const surface = node.closest('[data-board-surface]');
    const layers = surface?.querySelector('[data-picture-layers-control] > button');
    const update = () => {
      setSize(previous => node.offsetWidth === previous.width && node.offsetHeight === previous.height ? previous : { width: node.offsetWidth, height: node.offsetHeight });
      const box = surface?.getBoundingClientRect(), layer = layers?.getBoundingClientRect();
      const next = box && layer ? [{ x: layer.x - box.x, y: layer.y - box.y, w: layer.width, h: layer.height }] : [];
      setMeasuredReserved(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(node, { box: 'border-box' }); if (layers) observer.observe(layers); return () => observer.disconnect();
  }, [object.id, sizeOpen, viewport.width, viewport.height, layout.left, layout.top, layout.scale]);
  const reservations = [...measuredReserved, ...(reserved || [])];
  const at = objectToolbarPosition(sizeOpen ? sizeAnchor.current?.object || object : object, layout, viewport, size, { topInset, reserved: sizeOpen ? sizeAnchor.current?.reserved || reservations : reservations });
  // Toolbar input is an HTML action, never a board drag, resize or selection.
  const stopInput = event => event.stopPropagation();
  return <section ref={ref} data-object-toolbar={kind} aria-label={`Selected ${kind}`} style={{ left: at.left, top: at.top, paddingBottom: sizeOpen ? 56 : undefined, maxWidth: Math.max(0, viewport.width - 16) }}
    onPointerDown={event => { event.stopPropagation(); onPointerInput?.(); }} onPointerUp={stopInput} onClick={stopInput} onDoubleClick={stopInput}
    onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      if (sizeOpen) dismissSize.current?.();
      else onClear();
    }}
    className='pointer-events-auto absolute z-30 w-max rounded-xl border border-violet-200 bg-white p-1 shadow-lg'>
    {locked && <p role='status' className='max-w-64 px-2 py-1 text-xs text-slate-600'>The other person is moving this {kind}.</p>}
    {placementNotice && <p role='status' className='max-w-64 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-950'>{placementNotice}</p>}
    <div role='group' aria-label={`${label} actions`} className='flex flex-nowrap items-center gap-1'>
      {canResize && <ObjectSizeControl piece={piece} label={kind === 'mark' ? label : kind === 'text' ? 'Text' : 'Picture'} disabled={locked} buttonClassName={action} panelLayout='inset' corner={resizeCorner} dismissRef={dismissSize}
        onStart={onSizeStart} onChange={onSizeChange} onEnd={onSizeEnd}
        onOpenChange={open => { if (open) sizeAnchor.current = { object: { ...object }, reserved: reservations }; setSizeOpen(open); }} />}
      {onCrop && <button type='button' aria-label='Crop picture' title='Crop picture' disabled={locked} onClick={onCrop} className={action}><Crop className='h-4 w-4' aria-hidden='true' /><span className={compact ? 'sr-only' : undefined}>Crop</span></button>}
      {onDuplicate && <button type='button' aria-label={`Duplicate ${kind}`} disabled={locked} onClick={onDuplicate} className={action}>{!compact && <Copy className='h-4 w-4' aria-hidden='true' />}Duplicate</button>}
      {onDelete && <button type='button' aria-label={`Delete ${kind}`} title={`Delete ${kind}`} disabled={locked} onClick={onDelete} className={`${action} text-rose-700 hover:bg-rose-50`}><Trash2 className='h-4 w-4' aria-hidden='true' /><span className={compact ? 'sr-only' : undefined}>Delete</span></button>}
      {!onCrop && !onDuplicate && !onDelete && <p role='status' className='max-w-44 px-2 text-[11px] text-slate-600'>{resizeLocked ? 'Drag to move · Your tutor controls size' : 'Drag to move'}</p>}
      <span aria-hidden='true' className='mx-0.5 h-5 w-px shrink-0 bg-slate-200' />
      <button type='button' aria-label={`Deselect ${kind}`} onClick={onClear} className={action}><X className='h-4 w-4' aria-hidden='true' /></button>
    </div>
  </section>;
}
