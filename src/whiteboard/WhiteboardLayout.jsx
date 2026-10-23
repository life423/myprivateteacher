import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  const [open, setOpen] = useState(() => window.innerWidth >= 640);
  useEffect(() => {
    if (focus) setOpen(false);
  }, [focus]);
  return (
    <div className='pointer-events-none absolute bottom-3 left-3 z-20 flex max-h-[calc(100%-1.5rem)] items-end gap-2 landscape:bottom-auto landscape:top-3 landscape:items-start'>
      <button
        type='button'
        aria-expanded={open}
        aria-label={open ? 'Hide drawing tools' : 'Show drawing tools'}
        title={open ? 'Hide drawing tools' : 'Show drawing tools'}
        onClick={() => setOpen((was) => !was)}
        className='pointer-events-auto flex h-12 shrink-0 items-center gap-2 rounded-full bg-violet-600 px-4 text-sm font-bold text-white shadow-lg hover:bg-violet-700'
      >
        {open ? <X className='h-5 w-5' aria-hidden='true' /> : <Pencil className='h-5 w-5' aria-hidden='true' />}
        {open ? 'Close' : 'Tools'}
      </button>
      {open && <div className='pointer-events-auto max-h-full overflow-y-auto rounded-2xl portrait:[&_nav]:flex-row'>{tools}</div>}
    </div>
  );
}

// A small video window over the board that can be dragged anywhere in its area.
const VIDEO_CORNER = 'absolute bottom-20 right-3 z-20 flex w-40 touch-none justify-end sm:w-52 landscape:bottom-auto landscape:top-3';

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

function PanelSheet({ panels, active, state, onState, onTab, hidden, shares = SHARE }) {
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
        {panels.map(({ id, content }) => (
          <div key={id} className={id === active ? '' : 'hidden'}>
            {content}
          </div>
        ))}
      </div>
    </div>
  );
}

function ExitFocus({ onClick }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-slate-900/80 px-3 py-1.5 text-sm font-semibold text-white shadow-lg hover:bg-slate-900'
    >
      <Minimize2 className='h-4 w-4' aria-hidden='true' />
      Exit focus
    </button>
  );
}

export default function WhiteboardLayout({ header, banner, tools, board, alphabet, call, peerName, panels = [], controls }) {
  const arrangement = useArrangement();
  const [active, setActive] = useState(panels[0]?.id);
  // The bottom sheet: closed, open or full. Upright tablets have room for it docked open.
  const [sheet, setSheet] = useState(() => (arrangement === 'stacked' ? 'open' : 'closed'));
  useEffect(() => {
    setSheet(arrangement === 'stacked' ? 'open' : 'closed');
  }, [arrangement]);
  const [focus, setFocus] = useState(false);
  const current = panels.some((p) => p.id === active) ? active : panels[0]?.id;
  if (controls) {
    controls.current = {
      show(id) {
        setActive(id);
        setSheet((was) => (was === 'closed' ? 'open' : was));
      },
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
        onState={setSheet}
        onTab={(id) => {
          setActive(id);
          setSheet((was) => (was === 'closed' ? 'open' : was));
        }}
      />
    );

  // Tablets held upright: the labelled tools beside the board, the alphabet in its own bar, the
  // board filling the room below it (pinch to zoom, two fingers to pan, like phones), the video
  // floating in its corner, and tiles and pictures docked open below.
  if (arrangement === 'stacked') {
    return (
      <div className='relative flex h-dvh flex-col overflow-hidden bg-slate-200'>
        {!focus && header}
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
              {focus && <ExitFocus onClick={() => setFocus(false)} />}
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
        {!focus && banner}
        <div className='relative flex min-h-0 flex-1 items-start justify-center gap-4 p-4'>
          {tools}
          <main className='wb-board relative min-w-0 rounded-2xl bg-slate-100 shadow' style={BOARD_SHAPE}>
            {board}
          </main>
          <div className={`-m-1 flex max-h-full w-64 shrink-0 flex-col gap-4 overflow-y-auto p-1 xl:w-72 ${focus ? 'hidden' : ''}`}>
            <VideoPanel call={call} peerName={peerName} fill />
            {panels.length > 1 && (
              <div role='tablist' aria-label='Things for the board' className='grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 shadow'>
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
            {panels.map(({ id, content }) => (
              <div key={id} className={id === current ? '' : 'hidden'}>
                {content}
              </div>
            ))}
          </div>
          {focus && <ExitFocus onClick={() => setFocus(false)} />}
        </div>
      </div>
    );
  }

  return (
    <div className='relative flex h-dvh flex-col overflow-hidden bg-slate-200'>
      {!focus && header}
      {!focus && banner}
      <div className='relative min-h-0 flex-1 p-2'>
        {/* The floating tools and video live in the same space as the board, above the bottom bar. */}
        <div className='relative flex h-full w-full flex-col gap-2'>
          {alphabet}
          <main className='relative min-h-0 w-full flex-1 overflow-hidden rounded-2xl bg-slate-100 shadow'>
            <BoardFit.Provider value={alphabet ? FILL_WITH_BAR : FILL}>{board}</BoardFit.Provider>
          </main>
          {tools && <FloatingTools tools={tools} focus={focus} />}
          <FloatingVideo>
            <VideoPanel call={call} peerName={peerName} floating collapse={focus} />
          </FloatingVideo>
          {focus && <ExitFocus onClick={() => setFocus(false)} />}
        </div>
      </div>
      {sheetFor(SHARE)}
    </div>
  );
}
