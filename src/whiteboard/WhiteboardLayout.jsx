import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Minimize2, Pencil, X } from 'lucide-react';
import { BOARD_SHAPE } from './stage.js';
import VideoPanel from './VideoPanel.jsx';
import { BoardFit } from './viewport.js';
import { chooseArrangement } from './arrangement.js';

const FILL = { fill: true, bar: false };
const FILL_WITH_BAR = { fill: true, bar: true };
// Upright tablets fill the board like phones do, and keep it filled as the sheet slides.
const STACKED = { fill: true, bar: false, align: 'end', sticky: true };
const STACKED_WITH_BAR = { fill: true, bar: true, align: 'end', sticky: true };

// The one layout the tutor's and the student's screens share. Which arrangement a screen gets
// is worked out from the space it has (see arrangement.js), never from what the device is.
//  - Wide screens (1024px and up): tools | board | side column (video, then the panels).
//  - Narrower screens (tablets, phones): the board fills the space (upright phones start zoomed
//    to its height; pinch to zoom, two fingers to pan), with the tools behind a
//    floating pencil button, the video in a small window you can drag or shrink, and the
//    panels (letter tiles, pictures) in a sheet that slides up from a bar at the bottom.
//  - Focus mode, on any screen: just the board, the rest tucked away.
// The board is always the same 1600 x 1000 stage, scaled to fit, so both people see the
// same thing whatever their screens. `controls` lets a room open a panel or start focus mode.
function useArrangement() {
  const pick = () => ({
    arrangement: chooseArrangement(window.innerWidth, window.innerHeight),
    shortLandscape: window.innerHeight < 500 && window.innerWidth > window.innerHeight && window.innerWidth >= 568,
    viewportWidth: window.innerWidth,
  });
  const [arrangement, setArrangement] = useState(pick);
  useEffect(() => {
    const update = () => setArrangement(pick());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return arrangement;
}

// The drawing tools on narrower screens: a labelled Tools button that opens the tool rail.
function FloatingTools({ tools, focus, docked = false }) {
  // Open by default on tablets; closed on a phone held sideways, where it would cover the short board
  const [open, setOpen] = useState(() => window.innerWidth >= 640 && window.innerHeight >= 500);
  const trigger = useRef(null);
  const panel = useRef(null);
  const openedByUser = useRef(false);
  const id = useId();
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  useEffect(() => {
    if (focus) setOpen(false);
  }, [focus]);
  useEffect(() => {
    if (!open) return undefined;
    const escape = (event) => {
      if (event.key === 'Escape' && !event.target.closest?.('[role="dialog"], [role="menu"]')) {
        event.preventDefault();
        close();
      }
    };
    if (openedByUser.current) panel.current?.querySelector('button')?.focus({ preventScroll: true });
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open]);
  return (
    <div style={docked ? { minWidth: 100 } : undefined} className={`pointer-events-none z-40 flex flex-col items-start gap-2 ${docked ? 'relative h-full min-w-0 flex-1' : 'absolute bottom-[calc(var(--board-footer-height,0px)+0.75rem)] left-3 max-h-[calc(100%-var(--board-footer-height,0px)-1.5rem)] max-w-[calc(100%-1.5rem)] landscape:bottom-auto landscape:top-3'}`}>
      <button
        ref={trigger}
        type='button'
        aria-expanded={open}
        aria-controls={id}
        aria-label='Show drawing tools'
        title='Show drawing tools'
        onClick={() => {
          openedByUser.current = true;
          setOpen((was) => !was);
        }}
        className={`pointer-events-auto flex h-12 shrink-0 items-center gap-2 rounded-full bg-violet-600 px-4 text-sm font-bold text-white shadow-lg hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${open ? 'hidden' : ''}`}
      >
        <Pencil className='h-5 w-5' aria-hidden='true' />
        Tools
      </button>
      {/* Held upright, the tools sit in a grid that wraps, so every button stays on the screen */}
      {open && (
        <section ref={panel} id={id} aria-label='Drawing tools' className='pointer-events-auto flex w-full max-h-full max-w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl portrait:w-56'>
          <header className='flex shrink-0 items-center justify-between gap-1 border-b border-slate-100 pl-2 pr-1'>
            <h2 className='min-w-0 truncate text-sm font-bold text-slate-800'>{docked ? 'Tools' : 'Drawing tools'}</h2>
            <button type='button' onClick={close} aria-label='Close drawing tools' className='inline-flex h-11 min-w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-violet-500'>
              <X className='h-5 w-5' aria-hidden='true' />
            </button>
          </header>
          <div className='min-h-0 overflow-y-auto portrait:[&_nav]:grid portrait:[&_nav]:grid-cols-3 portrait:[&_nav]:gap-1 portrait:[&_nav>button]:w-full portrait:[&_nav>[aria-label=Hands]]:col-span-2 portrait:[&_nav>[aria-label=Hands]]:w-full landscape:[&_nav]:flex-row landscape:[&_nav]:flex-wrap landscape:[&_nav>[aria-label=Hands]]:w-auto [&_[aria-label=Hands]_button]:min-w-11 [&_nav]:w-full [&_nav]:rounded-none [&_nav]:shadow-none'>
            {tools}
          </div>
        </section>
      )}
    </div>
  );
}

// A small video window over the board that can be dragged anywhere in its area.
const VIDEO_CORNER = 'absolute right-3 top-3 z-20 flex w-48 max-w-[calc(100%-1.5rem)] touch-none justify-end sm:w-52';

function FloatingVideo({ children, place = VIDEO_CORNER, docked = false }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const box = useRef(null);
  const drag = useRef(null);
  useLayoutEffect(() => {
    // A short landscape material panel opens on the right; move video back into
    // the exposed board area, including a window the tutor previously dragged.
    drag.current = null;
    setOffset({ x: 0, y: 0 });
  }, [place, docked]);
  const onDown = (event) => {
    if (docked || event.target.closest('button')) return;
    drag.current = { id: event.pointerId, x: event.clientX - offset.x, y: event.clientY - offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onMove = (event) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const area = box.current.parentElement.getBoundingClientRect();
    const now = box.current.getBoundingClientRect();
    const left = now.left - offset.x;
    const top = now.top - offset.y;
    setOffset({
      x: Math.min(area.right - now.width - left, Math.max(area.left - left, event.clientX - d.x)),
      y: Math.min(area.bottom - now.height - top, Math.max(area.top - top, event.clientY - d.y)),
    });
  };
  const onUp = () => {
    drag.current = null;
  };
  return (
    <div
      ref={box}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      className={place}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {children}
    </div>
  );
}

// Narrow screens have a compact, labelled opener. The sheet remains modeless: tutors
// can keep using the board beside it. Native buttons provide the complete interaction;
// opening or closing never depends on finding a drag handle or making a precise gesture.
const SHARE = { open: 0.5, full: 0.88 };
const TABLET_SHARE = { open: 0.34, full: 0.88 };
// Leave a100px labelled Tools lane,208px video controls,12px gap and32px
// outer space exposed. Narrow landscape phones therefore get a smaller panel.
export const shortLandscapePanelWidth = (width) => Math.max(0, Math.min(320, width * 0.55, width - 352));
const GLIDE = 'transition-[height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none';

export function PanelSheet({ panels, active, state, onState, onTab, hidden, panelNodes, shares = SHARE, landscape = false, landscapeWidth = 320 }) {
  const slot = useRef(null);
  const bar = useRef(null);
  const trigger = useRef(null);
  const restoreFrame = useRef(null);
  const [barHeight, setBarHeight] = useState(56);
  const [landscapeTop, setLandscapeTop] = useState(0);
  const uid = useId();
  const open = state !== 'closed';
  const title = panels.length === 1 ? panels[0].label : 'Board materials';
  const bodyId = `${uid}-content`;
  const titleId = `${uid}-title`;
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return undefined;
    const measure = () => { if (element.offsetHeight) setBarHeight(element.offsetHeight); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!landscape || !slot.current) return undefined;
    const element = slot.current;
    const room = element.previousElementSibling;
    const parent = element.parentElement;
    // Anchor below the actual header, rather than estimating its height. Keep
    // the collapsed bar's space reserved so the visible board does not resize.
    const measure = () => setLandscapeTop(Math.max(0, room.getBoundingClientRect().top - parent.getBoundingClientRect().top));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    observer.observe(room);
    return () => observer.disconnect();
  }, [landscape]);
  useEffect(() => () => cancelAnimationFrame(restoreFrame.current), []);
  const close = () => {
    onState('closed');
    cancelAnimationFrame(restoreFrame.current);
    restoreFrame.current = requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  const height = state === 'closed' ? `${barHeight}px` : `${shares[state] * 100}%`;
  return (
    <div ref={slot} data-panel-sheet-slot style={{ height: landscape ? `${barHeight}px` : height }} className={`shrink-0 ${landscape ? '' : GLIDE} ${hidden ? 'hidden' : ''}`}>
    <section
      data-panel-sheet
      aria-labelledby={titleId}
      style={landscape && open ? { top: landscapeTop, bottom: 0, width: landscapeWidth } : { height: '100%' }}
      onKeyDown={(event) => {
        if (!open || event.defaultPrevented || event.key !== 'Escape' || event.target.closest?.('[role="dialog"], [role="menu"]')) return;
        event.preventDefault();
        close();
      }}
      className={`${landscape && open ? 'absolute right-0 rounded-l-2xl border-l' : 'relative rounded-t-2xl'} z-30 flex max-w-full flex-col overflow-hidden border-t border-slate-200 bg-white shadow-[0_-4px_16px_rgba(15,23,42,0.08)]`}
    >
      <div ref={bar} className='shrink-0'>
        <div className='flex min-h-14 items-center justify-between gap-2 px-3 py-1.5'>
          <h2 id={titleId} className='min-w-0 flex-1 text-sm font-bold text-slate-800'>
            <button
              ref={trigger}
              type='button'
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => open ? close() : onState(window.innerHeight < 500 ? 'full' : 'open')}
              className='inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg px-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-violet-500'
            >
              <span className='truncate'>{title}</span>
              {!open && <ChevronUp className='h-4 w-4 shrink-0 text-violet-600' aria-hidden='true' />}
            </button>
          </h2>
          {open && <>
            {!landscape && <button
              type='button'
              aria-label={`${state === 'full' ? 'Reduce' : 'Expand'} ${title} panel`}
              aria-controls={bodyId}
              title={`${state === 'full' ? 'Reduce' : 'Expand'} panel`}
              onClick={() => onState(state === 'full' ? 'open' : 'full')}
              className='inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-violet-500'
            >
              {state === 'full' ? <ChevronDown className='h-5 w-5' aria-hidden='true' /> : <ChevronUp className='h-5 w-5' aria-hidden='true' />}
            </button>}
            <button
              type='button'
              aria-label={`Close ${title}`}
              onClick={close}
              className='inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-violet-500'
            >
              <X className='h-4 w-4' aria-hidden='true' />
              Close
            </button>
          </>}
        </div>
        {open && panels.length > 1 && <div
          role='tablist'
          aria-label='Things for the board'
          className='mx-3 mb-2 grid gap-1 rounded-xl bg-slate-100 p-1'
          style={{ gridTemplateColumns: `repeat(${panels.length}, minmax(0, 1fr))` }}
        >
          {panels.map(({ id, label }) => (
            <button
              key={id}
              id={`${uid}-${id}-tab`}
              type='button'
              role='tab'
              aria-selected={active === id}
              aria-controls={`whiteboard-panel-${id}`}
              onClick={() => onTab(id)}
              className={`min-h-11 rounded-lg px-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-violet-500 ${active === id ? 'bg-violet-600 text-white' : 'text-slate-700 hover:bg-white'}`}
            >
              {label}
            </button>
          ))}
        </div>}
      </div>
      {/* MaterialsWorkspace owns its content scroller; the sheet adds no competing one. */}
      <div id={bodyId} aria-hidden={!open} inert={open ? undefined : ''} className={`min-h-0 flex-1 px-3 pb-3 ${panels.length === 1 ? 'overflow-hidden' : 'overflow-y-auto'} [&_[data-workspace-heading]]:sr-only`}>
        {panels.map(({ id, label, content }) => (
          <div key={id} id={`whiteboard-panel-${id}`} role={panels.length > 1 ? 'tabpanel' : undefined} aria-label={panels.length > 1 ? label : undefined} aria-labelledby={panels.length > 1 ? `${uid}-${id}-tab` : undefined} tabIndex={-1} ref={(node) => { panelNodes.current[id] = node; }} className={id === active ? `${panels.length === 1 ? 'flex h-full min-h-0 flex-col ' : ''}outline-none` : 'hidden'}>
            {content}
          </div>
        ))}
      </div>
    </section>
    </div>
  );
}

function ExitFocus({ onClick, inline = false }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`${inline ? 'inline-flex min-h-11' : 'absolute left-1/2 top-3 z-30 flex -translate-x-1/2'} items-center gap-1.5 rounded-full bg-slate-900/80 px-3 py-1.5 text-sm font-semibold text-white shadow-lg hover:bg-slate-900`}
    >
      <Minimize2 className='h-4 w-4' aria-hidden='true' />
      Exit focus
    </button>
  );
}

export default function WhiteboardLayout({ header, banner, tools, board, alphabet, call, peerName, panels = [], controls, onPanelChange, persistentControls }) {
  const { arrangement, shortLandscape, viewportWidth } = useArrangement();
  const landscapeWidth = shortLandscapePanelWidth(viewportWidth);
  const [active, setActive] = useState(panels[0]?.id);
  // The bottom sheet: closed, open or full. Upright tablets have room for it docked open.
  const [sheet, setSheet] = useState(() => (arrangement === 'stacked' ? 'open' : 'closed'));
  // Keep the tutor's open/closed choice when resizing or rotating the workspace.
  const [focus, setFocus] = useState(false);
  const panelNodes = useRef({});
  const revealFrame = useRef(null);
  const current = panels.some((p) => p.id === active) ? active : panels[0]?.id;
  const visiblePanel = !focus && (arrangement === 'side' || sheet !== 'closed') ? current : null;
  useEffect(() => {
    onPanelChange?.(visiblePanel);
  }, [onPanelChange, visiblePanel]);
  useEffect(() => () => cancelAnimationFrame(revealFrame.current), []);
  const showPanel = (id) => {
    if (!panels.some((panel) => panel.id === id)) return;
    setFocus(false);
    setActive(id);
    setSheet((was) => (was === 'closed' ? (window.innerHeight < 500 ? 'full' : 'open') : was));
    // A chooser must become visible even when its column was scrolled or focus mode hid it.
    cancelAnimationFrame(revealFrame.current);
    revealFrame.current = requestAnimationFrame(() => {
      const panel = panelNodes.current[id];
      panel?.scrollIntoView({ block: 'start' });
      panel?.focus({ preventScroll: true });
    });
  };
  if (controls) {
    controls.current = {
      show: showPanel,
      closeSheet() {
        setSheet('closed');
      },
      setFocus,
    };
  }

  const toolsBesideVideo = shortLandscape && sheet !== 'closed' && !focus;
  const sheetFor = (shares) =>
    panels.length > 0 && (
      <PanelSheet
        panels={panels}
        active={current}
        state={sheet}
        shares={shares}
        landscape={shortLandscape}
        landscapeWidth={landscapeWidth}
        hidden={focus}
        panelNodes={panelNodes}
        onState={setSheet}
        onTab={(id) => {
          setActive(id);
          setSheet((was) => (was === 'closed' ? (window.innerHeight < 500 ? 'full' : 'open') : was));
        }}
      />
    );

  // The normal header holds the resource shortcut. In focus mode this compact
  // replacement keeps it and Exit focus available without adding a second row.
  const resourceBar = focus && persistentControls && (
    <div data-focus-resource-controls className='relative z-30 flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-1 sm:px-4'>
      {persistentControls}
      <ExitFocus inline onClick={() => setFocus(false)} />
    </div>
  );

  // Tablets held upright: the labelled tools beside the board, the alphabet in its own bar, the
  // board filling the room below it (pinch to zoom, two fingers to pan, like phones), the video
  // floating in its corner, and tiles and pictures docked open below.
  if (arrangement === 'stacked') {
    return (
      <div className='relative flex h-dvh flex-col overflow-hidden bg-slate-200'>
        {!focus && header}
        {resourceBar}
        <div className='relative flex min-h-0 flex-1 gap-3 p-3'>
          {tools && <div className='flex shrink-0 items-center'>{tools}</div>}
          <div className='flex min-w-0 flex-1 flex-col gap-2'>
            {alphabet}
            <div className='relative min-h-0 flex-1'>
              <main className='relative isolate h-full w-full overflow-hidden rounded-2xl bg-slate-100 shadow'>
                <BoardFit.Provider value={alphabet ? STACKED_WITH_BAR : STACKED}>{board}</BoardFit.Provider>
              </main>
              <FloatingVideo place='absolute right-3 top-14 z-20 flex w-52 touch-none justify-end'>
                <VideoPanel call={call} peerName={peerName} floating collapse={focus} />
              </FloatingVideo>
              {focus && !persistentControls && <ExitFocus onClick={() => setFocus(false)} />}
            </div>
          </div>
        </div>
        {sheetFor(TABLET_SHARE)}
      </div>
    );
  }

  if (arrangement === 'side') {
    return (
      <div className='flex h-dvh flex-col bg-slate-200'>
        {!focus && header}
        {resourceBar}
        {!focus && banner}
        <div className='relative flex min-h-0 flex-1 items-start justify-center gap-4 p-4'>
          {tools}
          <main className='wb-board relative isolate min-w-0 rounded-2xl bg-slate-100 shadow' style={BOARD_SHAPE}>
            {board}
          </main>
          <aside data-workspace-sidebar aria-label='Lesson tools' className={`-m-1 flex h-full min-h-0 w-64 shrink-0 flex-col gap-2 overflow-hidden p-1 xl:w-72 ${focus ? 'hidden' : ''}`}>
            <div className='shrink-0'><VideoPanel call={call} peerName={peerName} fill /></div>
            {panels.length > 1 && (
              <div role='tablist' aria-label='Things for the board' className='sticky top-0 z-10 grid shrink-0 grid-cols-2 gap-1 rounded-2xl bg-white p-1 shadow'>
                {panels.map(({ id, label }) => (
                  <button
                    key={id}
                    type='button'
                    role='tab'
                    aria-selected={current === id}
                    onClick={() => setActive(id)}
                    className={`${panels.length === 3 && id === 'pictures' ? 'col-span-2 ' : ''}rounded-xl px-3 py-2 text-sm font-bold ${current === id ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-violet-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {panels.map(({ id, label, content }) => (
              <div key={id} id={`whiteboard-panel-${id}`} role={panels.length > 1 ? 'tabpanel' : undefined} aria-label={panels.length > 1 ? label : undefined} tabIndex={-1} ref={(node) => { panelNodes.current[id] = node; }} className={id === current ? `${panels.length === 1 ? 'flex min-h-0 flex-1 flex-col ' : ''}scroll-mt-24 outline-none` : 'hidden'}>
                {content}
              </div>
            ))}
          </aside>
          {focus && !persistentControls && <ExitFocus onClick={() => setFocus(false)} />}
        </div>
      </div>
    );
  }

  return (
    <div className='relative flex h-dvh flex-col overflow-hidden bg-slate-200'>
      {!focus && header}
      {resourceBar}
      {!focus && banner}
      <div className='relative min-h-0 flex-1 p-2'>
        {/* The floating tools and video live in the same space as the board, above the bottom bar. */}
        <div className='relative flex h-full w-full flex-col gap-2'>
          {/* The board omits its own strip whenever this bar is present. Keep the bar visible
              in landscape too, with compact rows that leave room for the writing area. */}
          {alphabet && <div data-external-alphabet className='shrink-0 [@media(max-height:500px)]:[&_[aria-label=Alphabet]]:gap-0.5 [@media(max-height:500px)]:[&_[aria-label=Alphabet]]:p-1 [@media(max-height:500px)]:[&_[data-letter]]:h-7 [@media(max-height:500px)]:[&_[data-letter]]:rounded-md [@media(max-height:500px)]:[&_[data-letter]]:text-base'>{alphabet}</div>}
          <main className='relative isolate min-h-0 w-full flex-1 overflow-hidden rounded-2xl bg-slate-100 shadow [&:has([data-board-footer])]:[--board-footer-height:44px]'>
            <BoardFit.Provider value={alphabet ? FILL_WITH_BAR : FILL}>{board}</BoardFit.Provider>
            {/* Inside the board, so they never sit over the alphabet bar */}
            <div
              data-video-boundary={toolsBesideVideo ? '' : undefined}
              style={toolsBesideVideo ? { right: landscapeWidth + 4, bottom: 'calc(var(--board-footer-height,0px) + 0.75rem)' } : undefined}
              className={toolsBesideVideo ? 'pointer-events-none absolute left-3 top-3 z-40 flex items-start gap-3' : 'contents'}
            >
              {tools && <FloatingTools tools={tools} focus={focus} docked={toolsBesideVideo} />}
              <FloatingVideo docked={toolsBesideVideo} place={toolsBesideVideo ? 'pointer-events-none relative flex h-full w-48 shrink-0 items-start justify-end sm:w-52 [&>aside]:pointer-events-auto' : VIDEO_CORNER}>
                <VideoPanel call={call} peerName={peerName} floating collapse={focus} />
              </FloatingVideo>
            </div>
          </main>
          {focus && !persistentControls && <ExitFocus onClick={() => setFocus(false)} />}
        </div>
      </div>
      {sheetFor(SHARE)}
    </div>
  );
}
