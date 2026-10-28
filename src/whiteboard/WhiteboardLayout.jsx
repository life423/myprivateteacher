import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Minimize2, Pencil, X } from 'lucide-react';
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
  const pick = () => chooseArrangement(window.innerWidth, window.innerHeight);
  const [arrangement, setArrangement] = useState(pick);
  useEffect(() => {
    const update = () => setArrangement(pick());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return arrangement;
}

// The drawing tools on narrower screens: a labelled Tools button that opens the tool rail.
function FloatingTools({ tools, focus }) {
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
    <div className='pointer-events-none absolute bottom-3 left-3 z-20 flex max-h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] flex-col items-start gap-2 landscape:bottom-auto landscape:top-3'>
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
        <section ref={panel} id={id} aria-label='Drawing tools' className='pointer-events-auto flex max-h-full max-w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl portrait:w-56'>
          <header className='flex shrink-0 items-center justify-between gap-4 border-b border-slate-100 pl-3 pr-1'>
            <h2 className='text-sm font-bold text-slate-800'>Drawing tools</h2>
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
const VIDEO_CORNER = 'absolute right-3 top-3 z-20 flex w-40 touch-none justify-end sm:w-52';

function FloatingVideo({ children, place = VIDEO_CORNER }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const box = useRef(null);
  const drag = useRef(null);
  const onDown = (event) => {
    if (event.target.closest('button')) return;
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

// The bar at the bottom of narrower screens, and the sheet it opens. It has three positions:
// collapsed (just the bar), half open and expanded. It follows the finger while dragged and
// glides to a position when let go: a short swipe moves one position, a long one all the way.
// Tap the handle to open or close it; tap a tab to open that panel. The sheet takes its room
// from the board area rather than covering it, so the board glides along with it.
const PULLED = {
  up: { closed: 'open', open: 'full', full: 'full' },
  down: { closed: 'closed', open: 'closed', full: 'open' },
};
const SHARE = { open: 0.5, full: 0.88 }; // of the screen's height
const TABLET_SHARE = { open: 0.34, full: 0.88 }; // docked open on upright tablets, leaving the board room
const GLIDE = 'transition-[height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none';

function PanelSheet({ panels, active, state, onState, onTab, hidden, panelNodes, shares = SHARE }) {
  const sheet = useRef(null);
  const bar = useRef(null);
  const pull = useRef(null);
  const [barHeight, setBarHeight] = useState(78);
  const [dragHeight, setDragHeight] = useState(null); // while a finger is moving it
  const open = state !== 'closed';
  useLayoutEffect(() => {
    if (bar.current) setBarHeight(bar.current.offsetHeight);
  }, []);
  // The bar keeps following the finger even when it leaves the bar, so a tap on a tab is
  // handled here too, once it's clear the finger didn't pull.
  const onDown = (event) => {
    pull.current = {
      id: event.pointerId,
      y: event.clientY,
      start: sheet.current.offsetHeight,
      moved: false,
      tab: event.target.closest('[role=tab]')?.dataset.panel,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onMove = (event) => {
    const p = pull.current;
    if (!p || p.id !== event.pointerId) return;
    const dy = event.clientY - p.y;
    if (!p.moved && Math.abs(dy) < 8) return;
    p.moved = true;
    const room = sheet.current.parentElement.clientHeight;
    setDragHeight(Math.min(room * 0.92, Math.max(barHeight, p.start - dy)));
  };
  const onUp = (event) => {
    const p = pull.current;
    pull.current = null;
    setDragHeight(null); // glide from wherever the finger left it
    if (!p) return;
    const dy = event.clientY - p.y;
    if (p.moved) {
      if (Math.abs(dy) < 24) return; // barely moved: it glides back
      const far = Math.abs(dy) > 160;
      if (dy < 0) onState(far ? 'full' : PULLED.up[state]);
      else onState(far ? 'closed' : PULLED.down[state]);
      return;
    }
    if (p.tab) onTab(p.tab);
    else onState(open ? 'closed' : 'open'); // a tap on the handle toggles it
  };
  const height = dragHeight !== null ? `${dragHeight}px` : state === 'closed' ? `${barHeight}px` : `${shares[state] * 100}%`;
  return (
    <div
      ref={sheet}
      style={{ height }}
      className={`relative z-30 flex shrink-0 flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_-8px_24px_rgba(15,23,42,0.12)] ${
        dragHeight === null ? GLIDE : ''
      } ${hidden ? 'hidden' : ''}`}
    >
      <div
        ref={bar}
        className='shrink-0 cursor-grab touch-none select-none'
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          pull.current = null;
          setDragHeight(null);
        }}
      >
        <div
          role='button'
          tabIndex={0}
          aria-label={open ? 'Close the panel' : 'Open the panel'}
          aria-expanded={open}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') onState(open ? 'closed' : 'open');
          }}
          className='flex justify-center pb-2 pt-3'
        >
          <span className='h-1.5 w-12 rounded-full bg-slate-300' aria-hidden='true' />
        </div>
        <div
          role='tablist'
          aria-label='Things for the board'
          className='mx-3 mb-2 grid gap-1 rounded-2xl bg-slate-100 p-1'
          style={{ gridTemplateColumns: `repeat(${panels.length}, minmax(0, 1fr))` }}
        >
          {panels.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type='button'
              role='tab'
              aria-selected={open && active === id}
              data-panel={id}
              onClick={(event) => {
                if (event.detail === 0) onTab(id); // the keyboard; taps are handled by the bar
              }}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${
                open && active === id ? 'bg-violet-600 text-white shadow' : 'text-slate-700 hover:bg-white'
              }`}
            >
              {Icon && <Icon className='h-4 w-4' aria-hidden='true' />}
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* The panels stay in place while the sheet slides, so closing it glides rather than emptying first. */}
      <div aria-hidden={!open} inert={open ? undefined : ''} className='min-h-0 flex-1 overflow-y-auto px-3 pb-3'>
        {panels.map(({ id, label, content }) => (
          <div key={id} id={`whiteboard-panel-${id}`} role='tabpanel' aria-label={label} tabIndex={-1} ref={(node) => { panelNodes.current[id] = node; }} className={id === active ? 'outline-none' : 'hidden'}>
            {content}
          </div>
        ))}
      </div>
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
  const arrangement = useArrangement();
  const [active, setActive] = useState(panels[0]?.id);
  // The bottom sheet: closed, open or full. Upright tablets have room for it docked open.
  const [sheet, setSheet] = useState(() => (arrangement === 'stacked' ? 'open' : 'closed'));
  useEffect(() => {
    setSheet(arrangement === 'stacked' ? 'open' : 'closed');
  }, [arrangement]);
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
    setSheet((was) => (was === 'closed' ? 'open' : was));
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

  const sheetFor = (shares) =>
    panels.length > 0 && (
      <PanelSheet
        panels={panels}
        active={current}
        state={sheet}
        shares={shares}
        hidden={focus}
        panelNodes={panelNodes}
        onState={setSheet}
        onTab={(id) => {
          setActive(id);
          setSheet((was) => (was === 'closed' ? 'open' : was));
        }}
      />
    );

  // The instructor's resource shortcut stays in the same place, outside scrollable panels.
  // A small dedicated row also keeps it clear of video, Layers and selected-picture controls.
  const resourceBar = persistentControls && (
    <div className='relative z-30 flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-1 sm:px-4'>
      {persistentControls}
      {focus && <ExitFocus inline onClick={() => setFocus(false)} />}
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
              <main className='relative h-full w-full overflow-hidden rounded-2xl bg-slate-100 shadow'>
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
          <main className='wb-board relative min-w-0 rounded-2xl bg-slate-100 shadow' style={BOARD_SHAPE}>
            {board}
          </main>
          <div className={`-m-1 flex max-h-full w-64 shrink-0 flex-col gap-4 overflow-y-auto p-1 xl:w-72 ${focus ? 'hidden' : ''}`}>
            <VideoPanel call={call} peerName={peerName} fill />
            {panels.length > 1 && (
              <div role='tablist' aria-label='Things for the board' className='sticky top-0 z-10 grid shrink-0 grid-cols-2 gap-1 rounded-2xl bg-white p-1 shadow'>
                {panels.map(({ id, label }) => (
                  <button
                    key={id}
                    type='button'
                    role='tab'
                    aria-selected={current === id}
                    onClick={() => setActive(id)}
                    className={`rounded-xl px-3 py-2 text-sm font-bold ${current === id ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-violet-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {panels.map(({ id, label, content }) => (
              <div key={id} id={`whiteboard-panel-${id}`} role='tabpanel' aria-label={label} tabIndex={-1} ref={(node) => { panelNodes.current[id] = node; }} className={id === current ? 'scroll-mt-24 outline-none' : 'hidden'}>
                {content}
              </div>
            ))}
          </div>
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
          {/* On a short screen (a phone held sideways) the alphabet would take most of the board's height, so it steps aside */}
          {alphabet && <div className='[@media(max-height:500px)]:hidden'>{alphabet}</div>}
          <main className='relative min-h-0 w-full flex-1 overflow-hidden rounded-2xl bg-slate-100 shadow'>
            <BoardFit.Provider value={alphabet ? FILL_WITH_BAR : FILL}>{board}</BoardFit.Provider>
            {/* Inside the board, so they never sit over the alphabet bar */}
            {tools && <FloatingTools tools={tools} focus={focus} />}
            <FloatingVideo>
              <VideoPanel call={call} peerName={peerName} floating collapse={focus} />
            </FloatingVideo>
          </main>
          {focus && !persistentControls && <ExitFocus onClick={() => setFocus(false)} />}
        </div>
      </div>
      {sheetFor(SHARE)}
    </div>
  );
}
