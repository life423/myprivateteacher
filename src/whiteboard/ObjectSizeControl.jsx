import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import ResizeIcon from './ResizeIcon.jsx';
import { pieceSize } from '../../shared/pieces.js';
import { objectSizeRange, SIZE_TRACK_MAX, sizeTrackToWidth, widthToSizeTrack } from './objectSizeRange.js';
import './ObjectSizeControl.css';

const sizeKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const defaultButton = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-700 hover:bg-violet-50 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500';

// Used by both the selected-object toolbar and Layers. Each adjustment is one
// shared grab/move/drop gesture, including keyboard and assistive input.
export default function ObjectSizeControl({ piece, label = 'Picture', disabled = false, onStart, onChange, onEnd, buttonClassName = defaultButton, onOpenChange, panelLayout = 'inline', corner = 'se', dismissRef }) {
  const id = useId();
  const trigger = useRef(null), panel = useRef(null), input = useRef(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const openRef = useRef(false), active = useRef(null), pendingWidth = useRef(null);
  const previousPiece = useRef(piece?.id);
  const live = useRef(null);
  live.current = { piece, disabled, onStart, onChange, onEnd, onOpenChange };
  const range = objectSizeRange(piece);
  const unavailable = disabled || !range;
  const width = draft ?? piece?.w ?? range?.min ?? 0;

  const finish = (clearDraft = true) => {
    if (!active.current) return;
    active.current = null;
    live.current.onEnd?.(pendingWidth.current);
    pendingWidth.current = null;
    if (clearDraft) setDraft(null);
  };
  const changeOpen = (next, focus = false) => {
    if (openRef.current !== next) {
      openRef.current = next;
      setOpen(next);
      live.current.onOpenChange?.(next);
    }
    if (!next) finish();
    if (focus) trigger.current?.focus({ preventScroll: true });
  };
  const begin = (kind, pointerId) => {
    if (live.current.disabled || !objectSizeRange(live.current.piece) || active.current) return false;
    active.current = { kind, pointerId };
    pendingWidth.current = live.current.piece.w;
    live.current.onStart?.();
    return true;
  };
  const callbacks = useRef(null);
  callbacks.current = { finish, changeOpen };

  useLayoutEffect(() => {
    if (!dismissRef) return undefined;
    const dismiss = () => callbacks.current.changeOpen(false, true);
    dismissRef.current = dismiss;
    return () => { if (dismissRef.current === dismiss) dismissRef.current = null; };
  }, [dismissRef]);

  useLayoutEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (previousPiece.current !== piece?.id) {
      callbacks.current.changeOpen(false);
      setDraft(null);
      previousPiece.current = piece?.id;
    }
    if (disabled) callbacks.current.changeOpen(false);
  }, [piece?.id, disabled]);

  useEffect(() => {
    const endPointer = event => {
      const gesture = active.current;
      if (gesture?.kind === 'pointer' && gesture.pointerId === event.pointerId) callbacks.current.finish();
    };
    const endKey = event => { if (active.current?.kind === 'key' && sizeKeys.has(event.key)) callbacks.current.finish(); };
    const blur = () => callbacks.current.finish();
    window.addEventListener('pointerup', endPointer, true);
    window.addEventListener('pointercancel', endPointer, true);
    window.addEventListener('keyup', endKey, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointerup', endPointer, true);
      window.removeEventListener('pointercancel', endPointer, true);
      window.removeEventListener('keyup', endKey, true);
      window.removeEventListener('blur', blur);
      callbacks.current.finish(false);
      if (openRef.current) live.current.onOpenChange?.(false);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const outside = event => {
      if (!trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) callbacks.current.changeOpen(false);
    };
    const escapeFromActions = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation();
      callbacks.current.changeOpen(false, true);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escapeFromActions);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escapeFromActions); };
  }, [open]);

  const escape = event => {
    if (event.key !== 'Escape' || !openRef.current) return;
    event.preventDefault(); event.stopPropagation();
    changeOpen(false, true);
  };
  const finishPointer = event => {
    event.stopPropagation();
    if (active.current?.kind === 'pointer' && active.current.pointerId === event.pointerId) finish();
  };

  return <div className='contents' data-object-size-control>
    <button ref={trigger} type='button' aria-label={`${label} size`} aria-expanded={open} aria-controls={id} disabled={unavailable}
      onClick={() => changeOpen(!openRef.current)} onKeyDown={escape} className={buttonClassName}>
      <ResizeIcon corner={corner} />Size
    </button>
    {open && <div ref={panel} id={id} data-object-size-panel className={`flex items-center gap-3 border-t border-slate-100 px-2 pt-1 ${panelLayout === 'inset' ? 'absolute inset-x-1 bottom-1' : 'order-last basis-full'}`} style={{ minWidth: panelLayout === 'inset' ? 0 : 'min(216px, calc(100vw - 48px))', maxWidth: '100%' }}>
      <label htmlFor={`${id}-range`} className='shrink-0 text-xs font-semibold text-slate-700'>Size</label>
      <input ref={input} id={`${id}-range`} type='range' aria-label={`${label} size`} aria-valuetext={`${Math.round(width)} board units wide`}
        min='0' max={SIZE_TRACK_MAX} step='1' value={Math.round(widthToSizeTrack(width, range))} disabled={unavailable}
        className='object-size-slider min-h-11 min-w-0 flex-1 rounded-md focus-visible:outline-none' style={{ width: 160, '--size-progress': `${widthToSizeTrack(width, range) / SIZE_TRACK_MAX * 100}%` }}
        onPointerDown={event => { event.stopPropagation(); if (event.button === 0) begin('pointer', event.pointerId); }}
        onPointerUp={finishPointer} onPointerCancel={finishPointer}
        onBlur={() => finish()}
        onKeyDown={event => { event.stopPropagation(); escape(event); if (sizeKeys.has(event.key)) begin('key'); }}
        onKeyUp={event => { event.stopPropagation(); if (sizeKeys.has(event.key)) finish(); }}
        onChange={event => {
          const current = live.current;
          if (current.disabled) return;
          const currentRange = objectSizeRange(current.piece);
          const requested = sizeTrackToWidth(Number(event.target.value), currentRange);
          if (requested === null) return;
          const standAlone = !active.current;
          if (standAlone) begin('change');
          const next = pieceSize(current.piece.crop, requested, current.piece.content).w;
          pendingWidth.current = next;
          setDraft(next);
          current.onChange?.(next);
          if (standAlone) finish();
        }}
      />
    </div>}
  </div>;
}
