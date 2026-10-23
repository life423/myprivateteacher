import { memo, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Hand from './Hand.jsx';
import InkCanvas from './InkCanvas.jsx';
import Tile from './Tile.jsx';
import PieceImage from './PieceImage.jsx';
import { EraserMarker, PenMarker } from './Markers.jsx';
import { INK, STUDENT_LAYER, TUTOR_LAYER, insideBoard } from './board.js';
import { BOARD, CELL_WIDTH, LETTERS, STAGE, STRIP, boardRect, clamp, letterAt } from './stage.js';
import { TILE_HEIGHT, clampTile, soundBoxes, tileWidth } from '../../shared/tiles.js';
import { clampPiece, pieceSize } from '../../shared/pieces.js';
import { Copy, Expand, Shrink, Trash2 } from 'lucide-react';
import { BELOW_STRIP, BoardFit, fillView, frame, viewAt, viewBoxOf } from './viewport.js';

const VIEW_BOX = `0 0 ${STAGE.width} ${STAGE.height}`;
// Handwriting guides (top line, dashed midline, baseline) stay put even when the board grows.
const GUIDE_LINES = [0.3, 0.55, 0.8].map((f) => BOARD.y + BOARD.height * f);
const PALM_MS = 1500; // touches this soon after an Apple Pencil event count as a resting palm
const CLICK_SLOP = 6; // a tile that moves less than this was clicked, not dragged

// The glove around its fingertip (the left hand is the right one mirrored).
const overHand = (p, hand) => {
  const dx = hand.side === 'l' ? hand.x - p.x : p.x - hand.x;
  return dx >= -50 && dx <= 52 && p.y >= hand.y - 10 && p.y <= hand.y + 146;
};
const overTile = (p, t) => p.x >= t.x && p.x <= t.x + tileWidth(t.text) && p.y >= t.y && p.y <= t.y + TILE_HEIGHT;
const overRemove = (p, t) => Math.hypot(p.x - (t.x + tileWidth(t.text)), p.y - t.y) <= 26;

// Picture pieces: selected with the pointer tools, then moved, resized (keeping their shape),
// duplicated or deleted. Sizes here are in stage units.
const HANDLE = 24; // how close counts as touching a resize handle
const overRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
// The eight resize handles, corners and edge middles; hx and hy say which side (-1, 0 or 1).
const handlesOf = (piece) =>
  [-1, 0, 1]
    .flatMap((hx) => [-1, 0, 1].map((hy) => ({ hx, hy })))
    .filter(({ hx, hy }) => hx || hy)
    .map(({ hx, hy }) => ({ hx, hy, x: piece.x + ((hx + 1) / 2) * piece.w, y: piece.y + ((hy + 1) / 2) * piece.h }));
const HANDLE_CURSOR = { '-1,-1': 'nwse', '1,1': 'nwse', '1,-1': 'nesw', '-1,1': 'nesw', '-1,0': 'ew', '1,0': 'ew', '0,-1': 'ns', '0,1': 'ns' };
const PIECE_CURSORS = {
  button: 'cursor-pointer',
  nwse: 'cursor-nwse-resize',
  nesw: 'cursor-nesw-resize',
  ew: 'cursor-ew-resize',
  ns: 'cursor-ns-resize',
};
// The small toolbar over a selected piece (under it when there's no room above).
function toolbarOf(piece, actions) {
  const bw = 128;
  const w = bw * actions.length;
  const h = 64;
  const x = Math.min(STAGE.width - 24 - w, Math.max(24, piece.x + piece.w / 2 - w / 2));
  const above = piece.y - h - 14;
  const y = above >= 24 ? above : Math.min(STAGE.height - 24 - h, piece.y + piece.h + 14);
  return { x, y, w, h, buttons: actions.map((action, i) => ({ action, x: x + i * bw, y, w: bw, h })) };
}

// Letter highlights: violet under the student's hand, blue under the tutor's.
// A letter a hand points at lights up in the hands' blue. `pointed` is those letters as one string.
function letterTone(letter, pointed) {
  if (!pointed.includes(letter)) return { cell: 'fill-white stroke-slate-200', text: 'fill-slate-800', width: 3 };
  return { cell: 'fill-blue-100 stroke-blue-500', text: 'fill-blue-800', width: 5 };
}

// The bottom layer: the alphabet strip (unless hidden), the board, its guide lines and the sound boxes.
const Backdrop = memo(function Backdrop({ pointed, strip, boxes, viewBox, bar = false }) {
  const board = boardRect(strip);
  return (
    <svg viewBox={viewBox} preserveAspectRatio='xMidYMid meet' className='absolute inset-0 h-full w-full' aria-hidden='true'>
      <rect width={STAGE.width} height={STAGE.height} rx='28' className='fill-slate-100' />
      {strip &&
        !bar && // the alphabet has its own bar (phones): no second alphabet on the board
        LETTERS.map((letter, i) => {
          const tone = letterTone(letter, pointed);
          const x = STRIP.x + i * CELL_WIDTH;
          return (
            <g key={letter}>
              <rect x={x + 3} y={STRIP.y} width={CELL_WIDTH - 6} height={STRIP.height} rx='14' strokeWidth={tone.width} className={tone.cell} />
              <text
                x={x + CELL_WIDTH / 2}
                y={STRIP.y + STRIP.height / 2}
                textAnchor='middle'
                dominantBaseline='central'
                className={tone.text}
                style={{ fontSize: 56, fontWeight: 800 }}
              >
                {letter}
              </text>
            </g>
          );
        })}
      <rect x={board.x} y={board.y} width={board.width} height={board.height} rx='20' strokeWidth='3' className='fill-white stroke-slate-200' />
      {GUIDE_LINES.map((y, i) => (
        <line
          key={y}
          x1={BOARD.x + 40}
          x2={BOARD.x + BOARD.width - 40}
          y1={y}
          y2={y}
          strokeWidth='3'
          strokeDasharray={i === 1 ? '16 14' : undefined}
          className='stroke-slate-200'
        />
      ))}
      {soundBoxes(boxes).map((box) => (
        <rect
          key={box.x}
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          rx='16'
          strokeWidth='4'
          strokeDasharray='14 10'
          className='fill-slate-50 stroke-slate-400'
        />
      ))}
    </svg>
  );
});

// Each person's pen or eraser where they are. (The hands are shared, and drawn separately.)
function Marker({ kind, x, y, by, smooth }) {
  if (kind === 'pen') return <PenMarker x={x} y={y} color={INK[by]} smooth={smooth} />;
  if (kind === 'eraser') return <EraserMarker x={x} y={y} smooth={smooth} />;
  return null;
}

// The shared stage in layers: the letters and board, the tutor's ink, the student's
// ink, then tiles and pointers on top. `tool` decides what this viewer's pointer does.
// Tiles can be dragged whatever the tool; the two shared hands with the pointer tools
// whatever the tool. Everything is in the fixed 1600 x 1000 stage space.
export default function Stage({
  board,
  me = 'student',
  letters = [], // the letters the hands point at
  strip = true,
  boxes = 0,
  tiles = [],
  selectedTile = null,
  canManageTiles = false,
  tileActions,
  pieces = [],
  pictures = [],
  pictureSrc = () => '',
  pieceActions = null,
  canEditPieces = false,
  canDeletePieces = false,
  canDuplicatePieces = false,
  stageApi = null,
  onView = null, // told which part of the board this screen shows
  peerView = null, // the part of the board the other person can see, outlined
  focus = null, // { x, y, w, h, n }: show this part of the board (the tutor asked)
  tool = 'none',
  markers = [],
  hands = [], // the two shared hands that are out: { side, x, y, letter, by }
  handActions = null, // { grab(side), move(side, point), drop(side) }
  canHoldHands = false,
  barApi = null, // on phones: the alphabet bar, which says where a finger over it points
  onPoint,
  onLeave,
  onStroke,
}) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const drawing = useRef(null);
  const holding = useRef(new Map()); // pointer id -> { side, dx, dy }: the hands this screen is moving
  const tileDrag = useRef(null);
  const pieceDrag = useRef(null);
  const lastPen = useRef(-Infinity); // no Apple Pencil yet, so no touch counts as a palm
  const live = useRef({});
  live.current = { onPoint, onLeave, onStroke, hands, handActions, canHoldHands, barApi, tiles, tileActions, canManageTiles, strip };
  // The board's frame on screen: all of it fitted (view is null), or zoomed and panned by this
  // person alone. The board's own coordinates never change, so the other screen never notices.
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState(null);
  const { fill, bar: alphabetBar, align, sticky } = useContext(BoardFit);
  const fillTop = alphabetBar && strip ? BELOW_STRIP : 0; // the alphabet has its own bar, so start at the writing
  // With sound boxes on, a phone filling its screen with the board centres on them (they're a
  // centred row), rather than starting at the board's left edge.
  const fillCentre = boxes ? STAGE.width / 2 : null;
  const filled = useRef(false);
  // On tablets the automatic fill keeps filling as the space changes (the sheet sliding up or
  // down), until someone zooms, pans or fits the board themselves.
  const autoFill = useRef(false);
  const layout = frame(size.width, size.height, view, align, fillTop);
  const viewBox = viewBoxOf(layout, size.width, size.height);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const gesture = useRef({ touches: new Map(), pinch: null, pan: null });

  // The part of the board this screen shows, for the other person's outline.
  const seen = layout.scale
    ? (() => {
        const x = clamp(-layout.left / layout.scale, 0, STAGE.width);
        const y = clamp(-layout.top / layout.scale, 0, STAGE.height);
        const right = clamp((size.width - layout.left) / layout.scale, 0, STAGE.width);
        const bottom = clamp((size.height - layout.top) / layout.scale, 0, STAGE.height);
        return { x: Math.round(x), y: Math.round(y), w: Math.round(right - x), h: Math.round(bottom - y) };
      })()
    : null;
  const seenKey = seen ? `${seen.x},${seen.y},${seen.w},${seen.h}` : '';
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  useEffect(() => {
    if (seen) onViewRef.current?.(seen);
  }, [seenKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The tutor asked this screen to show a part of the board: as big as fits, in the middle.
  useEffect(() => {
    if (!focus || !size.width) return;
    autoFill.current = false;
    const scale = Math.min(size.width / focus.w, size.height / focus.h);
    if (scale <= frame(size.width, size.height, null, 'center', fillTop).fit * 1.02) setView(null);
    else setView({ scale, cx: focus.x + focus.w / 2, cy: focus.y + focus.h / 2 });
  }, [focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const [grip, setGrip] = useState(null); // 'grab', 'grabbing' or 'remove', for the cursor
  const [selectedPieceId, setSelectedPieceId] = useState(null);
  // Pieces are handled with the pointer tools (Watch, Hand), never the pen or eraser.
  const movable = tool === 'none';
  const stackedPieces = [...pieces].sort((a, b) => a.z - b.z);
  const selectedPiece = movable ? pieces.find((p) => p.id === selectedPieceId) || null : null;
  const pieceButtons = [canDuplicatePieces && 'duplicate', canDeletePieces && 'delete'].filter(Boolean);
  const bar = selectedPiece && pieceButtons.length ? toolbarOf(selectedPiece, pieceButtons) : null;

  // When the tutor switches sound boxes on, a phone showing the board at its screen-filling zoom
  // moves over to them. A view the person zoomed or panned themselves is left where it is.
  const hadBoxes = useRef(Boolean(boxes));
  useEffect(() => {
    const had = hadBoxes.current;
    hadBoxes.current = Boolean(boxes);
    if (!boxes || had || !view || !size.width) return;
    const onBoxes = fillView(size.width, size.height, fillTop, STAGE.width / 2);
    if (Math.abs(view.scale - onBoxes.scale) < 0.01) setView(onBoxes);
  }, [boxes]); // eslint-disable-line react-hooks/exhaustive-deps

  // The space the board has. Upright phones start with the board filling the height.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    const update = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setSize({ width, height });
      if (fill && !filled.current && width && height / width > (STAGE.height / STAGE.width) * 1.15) {
        filled.current = true;
        autoFill.current = Boolean(sticky);
        setView(fillView(width, height, fillTop, fillCentre));
      } else if (autoFill.current && width && height) {
        setView(fillView(width, height, fillTop, fillCentre));
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fill, fillTop, sticky]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zooming and panning. Everything is in the board box's own pixels.
  const local = (clientX, clientY) => {
    const box = wrapRef.current.getBoundingClientRect();
    return { x: clientX - box.left, y: clientY - box.top };
  };
  const boardPoint = (p) => {
    const f = layoutRef.current;
    return { x: (p.x - f.left) / f.scale, y: (p.y - f.top) / f.scale };
  };
  // Shows board point (x, y) at box point (px, py) at a scale; all the way out means 'fit'.
  const zoomTo = (scale, x, y, px, py) => {
    autoFill.current = false;
    const f = layoutRef.current;
    if (scale <= f.fit * 1.02) return setView(null);
    const { width, height } = sizeRef.current;
    setView(viewAt(width, height, Math.min(scale, f.max), x, y, px, py));
  };

  // Trackpad pinch (or Ctrl + scroll) zooms; scrolling pans once zoomed in.
  useEffect(() => {
    const el = wrapRef.current;
    const onWheel = (event) => {
      const f = layoutRef.current;
      if (!f.scale) return;
      const p = local(event.clientX, event.clientY);
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const at = boardPoint(p);
        zoomTo(f.scale * Math.exp(-event.deltaY * 0.01), at.x, at.y, p.x, p.y);
      } else if (f.scale > f.fit * 1.02) {
        event.preventDefault();
        const { width, height } = sizeRef.current;
        const middle = boardPoint({ x: width / 2, y: height / 2 });
        zoomTo(f.scale, middle.x + event.deltaX / f.scale, middle.y + event.deltaY / f.scale, width / 2, height / 2);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Changing tools (or losing them) ends any stroke in progress.
  useEffect(() => {
    if (drawing.current === null) return;
    drawing.current = null;
    live.current.onStroke?.end();
  }, [tool]);

  const toStage = (clientX, clientY, lift = 0) => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: clamp(p.x, 0, STAGE.width), y: clamp(p.y - lift, 0, STAGE.height) };
  };

  const withLetter = (p) => ({ ...p, letter: letterAt(p.x, p.y, live.current.strip) });

  const isPalm = (event) => {
    if (event.pointerType === 'pen') lastPen.current = performance.now();
    return event.pointerType === 'touch' && performance.now() - lastPen.current < PALM_MS;
  };

  // Capture keeps a stroke or drag going if the finger slides off the stage; some browsers refuse it.
  const capture = (event) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // it still works without capture
    }
  };

  // The tile under a point, topmost first. For the tutor, a tile's delete button counts too.
  const pickTile = (p) => {
    const { tiles: list, canManageTiles: manage } = live.current;
    const top = [...list].sort((a, b) => b.z - a.z);
    if (manage) {
      const doomed = top.find((t) => overRemove(p, t));
      if (doomed) return { tile: doomed, remove: true };
    }
    const tile = top.find((t) => overTile(p, t));
    return tile ? { tile, remove: false } : null;
  };

  // The selected piece's controls under a point: a toolbar button or a resize handle.
  const pieceControl = (p) => {
    if (!selectedPiece) return null;
    const button = bar?.buttons.find((b) => overRect(p, b));
    if (button) return { piece: selectedPiece, button: button.action };
    if (!canEditPieces) return null;
    const handle = handlesOf(selectedPiece).find((hd) => Math.abs(p.x - hd.x) <= HANDLE && Math.abs(p.y - hd.y) <= HANDLE);
    return handle ? { piece: selectedPiece, handle } : null;
  };
  const pickPiece = (p) => (movable ? [...stackedPieces].reverse().find((piece) => overRect(p, piece)) || null : null);
  const pieceGrip = (p) => {
    const control = pieceControl(p);
    if (control?.button) return 'button';
    if (control?.handle) return HANDLE_CURSOR[`${control.handle.hx},${control.handle.hy}`];
    return pickPiece(p) ? 'grab' : null;
  };

  // The hand under a point that this person may hold (the right one wins where they overlap):
  // the tutor can take either, even from the student; the student only one the tutor isn't holding.
  const handUnder = (raw, skip) => {
    const { hands: all, handActions: actions, canHoldHands: can } = live.current;
    if (!can || !actions || !all?.length) return null;
    return [...all].reverse().find((h) => !skip?.has(h.side) && overHand(raw, h) && (!h.by || h.by === me || me === 'tutor')) || null;
  };

  // Pressing on a hand holds it until let go. Each finger can hold one, so two fingers can hold
  // both; a finger holding a hand never counts towards a pinch.
  const grabHand = (event) => {
    const raw = toStage(event.clientX, event.clientY);
    if (!raw) return false;
    const hand = handUnder(raw, new Set([...holding.current.values()].map((h) => h.side)));
    if (!hand || !live.current.handActions.grab(hand.side)) return false;
    capture(event);
    holding.current.set(event.pointerId, { side: hand.side, dx: hand.x - raw.x, dy: hand.y - raw.y });
    setGrip('grabbing');
    return true;
  };

  const onPointerDown = (event) => {
    if (isPalm(event)) return;
    if (grabHand(event)) return;
    if (event.pointerType === 'touch') {
      const g = gesture.current;
      g.touches.set(event.pointerId, local(event.clientX, event.clientY));
      if (g.touches.size === 2) {
        // A second finger: stop whatever the first was doing, and pinch or pan instead.
        for (const id of g.touches.keys()) if (id !== event.pointerId) endAction({ pointerId: id });
        g.pan = null;
        const [a, b] = [...g.touches.values()];
        const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        g.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: layoutRef.current.scale, at: boardPoint(middle) };
        capture(event);
        return;
      }
      if (g.touches.size > 2) return;
    }
    const { onPoint: point, onStroke: stroke, tileActions: tileOps } = live.current;
    const raw = toStage(event.clientX, event.clientY);
    if (!raw) return;
    const control = pieceActions ? pieceControl(raw) : null;
    if (control) {
      const { piece } = control;
      if (control.button === 'duplicate') pieceActions.duplicate(piece.id);
      if (control.button === 'delete') {
        pieceActions.remove(piece.id);
        setSelectedPieceId(null);
      }
      if (control.handle && !(piece.heldBy && piece.heldBy !== me)) {
        capture(event);
        const { hx, hy } = control.handle;
        pieceDrag.current = {
          pointerId: event.pointerId,
          id: piece.id,
          mode: 'resize',
          hx,
          hy,
          crop: piece.crop,
          ax: hx === 1 ? piece.x : hx === -1 ? piece.x + piece.w : piece.x + piece.w / 2,
          ay: hy === 1 ? piece.y : hy === -1 ? piece.y + piece.h : piece.y + piece.h / 2,
          x: piece.x,
          y: piece.y,
          w: piece.w,
        };
        pieceActions.grab(piece.id);
      }
      return;
    }
    const picked = tileOps ? pickTile(raw) : null;
    if (picked) {
      const { tile } = picked;
      if (picked.remove) {
        tileOps.remove(tile.id);
        return;
      }
      if (tile.heldBy && tile.heldBy !== me) return; // the other person has it right now
      capture(event);
      tileDrag.current = {
        pointerId: event.pointerId,
        id: tile.id,
        text: tile.text,
        dx: tile.x - raw.x,
        dy: tile.y - raw.y,
        sx: raw.x,
        sy: raw.y,
        x: tile.x,
        y: tile.y,
        moved: false,
      };
      setGrip('grabbing');
      tileOps.grab(tile.id);
      if (tool !== 'none') point?.({ ...raw, letter: null });
      return;
    }
    const piece = pieceActions ? pickPiece(raw) : null;
    if (piece) {
      setSelectedPieceId(piece.id);
      if (piece.heldBy && piece.heldBy !== me) return; // the other person has it right now
      capture(event);
      pieceDrag.current = { pointerId: event.pointerId, id: piece.id, mode: 'move', dx: piece.x - raw.x, dy: piece.y - raw.y, x: piece.x, y: piece.y, w: piece.w, h: piece.h };
      setGrip('grabbing');
      pieceActions.grab(piece.id);
      if (tool !== 'none') point?.({ ...raw, letter: null });
      return;
    }
    if (movable) setSelectedPieceId(null);
    if (tool === 'none') {
      // Watching: dragging the empty board pans it when zoomed in.
      if (view) {
        capture(event);
        gesture.current.pan = { id: event.pointerId, at: boardPoint(local(event.clientX, event.clientY)) };
      }
      return;
    }
    point?.(raw);
    if (drawing.current !== null || !insideBoard(raw, boardRect(live.current.strip))) return;
    capture(event);
    drawing.current = event.pointerId;
    stroke?.start(raw);
  };

  const onPointerMove = (event) => {
    const held = holding.current.get(event.pointerId);
    if (held) {
      const hand = live.current.hands.find((h) => h.side === held.side);
      if (!hand || (hand.by && hand.by !== me)) {
        // Switched off, or the tutor took it: it stops following this pointer.
        holding.current.delete(event.pointerId);
        setGrip(null);
        return;
      }
      // Dragged up onto a phone's alphabet bar: the hand goes right under the finger, on that letter.
      const overBar = live.current.barApi?.current?.pointAt(event.clientX, event.clientY);
      if (overBar) {
        live.current.handActions.move(held.side, overBar);
        return;
      }
      const raw = toStage(event.clientX, event.clientY);
      if (!raw) return;
      live.current.handActions.move(held.side, withLetter({ x: clamp(raw.x + held.dx, 0, STAGE.width), y: clamp(raw.y + held.dy, 0, STAGE.height) }));
      return;
    }
    const g = gesture.current;
    if (event.pointerType === 'touch' && g.touches.has(event.pointerId)) {
      g.touches.set(event.pointerId, local(event.clientX, event.clientY));
      if (g.pinch && g.touches.size >= 2) {
        const [a, b] = [...g.touches.values()];
        const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const scale = g.pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / g.pinch.dist);
        zoomTo(scale, g.pinch.at.x, g.pinch.at.y, middle.x, middle.y);
        return;
      }
      if (g.pinch) return; // the finger left after a pinch does nothing until it lifts
    }
    if (g.pan && g.pan.id === event.pointerId) {
      const p = local(event.clientX, event.clientY);
      zoomTo(layoutRef.current.scale, g.pan.at.x, g.pan.at.y, p.x, p.y);
      return;
    }
    if (isPalm(event)) return;
    const { onPoint: point, onStroke: stroke, tileActions: tileOps } = live.current;
    const pd = pieceDrag.current;
    if (pd && pd.pointerId === event.pointerId) {
      const raw = toStage(event.clientX, event.clientY);
      if (!raw) return;
      if (pd.mode === 'move') {
        const pos = clampPiece({ w: pd.w, h: pd.h }, raw.x + pd.dx, raw.y + pd.dy);
        pd.x = pos.x;
        pd.y = pos.y;
        pieceActions?.move(pd.id, pos.x, pos.y);
      } else {
        // Resizing keeps the shape and pins the opposite side (or the middle, for edge handles).
        const ratio = pd.crop.h / pd.crop.w;
        const dx = Math.abs(raw.x - pd.ax);
        const dy = Math.abs(raw.y - pd.ay) / ratio;
        const size = pieceSize(pd.crop, pd.hx && pd.hy ? Math.max(dx, dy) : pd.hx ? dx : dy);
        const x = pd.hx === 1 ? pd.ax : pd.hx === -1 ? pd.ax - size.w : pd.ax - size.w / 2;
        const y = pd.hy === 1 ? pd.ay : pd.hy === -1 ? pd.ay - size.h : pd.ay - size.h / 2;
        const pos = clampPiece(size, x, y);
        Object.assign(pd, pos, { w: size.w });
        pieceActions?.move(pd.id, pos.x, pos.y, size.w);
      }
      if (tool !== 'none') point?.({ ...raw, letter: null });
      return;
    }
    const td = tileDrag.current;
    if (td && td.pointerId === event.pointerId) {
      const raw = toStage(event.clientX, event.clientY);
      if (!raw) return;
      if (Math.abs(raw.x - td.sx) + Math.abs(raw.y - td.sy) > CLICK_SLOP) td.moved = true;
      const pos = clampTile(td.text, raw.x + td.dx, raw.y + td.dy);
      td.x = pos.x;
      td.y = pos.y;
      tileOps?.move(td.id, pos.x, pos.y);
      if (tool !== 'none') point?.({ ...raw, letter: null });
      return;
    }
    if (drawing.current === event.pointerId) {
      const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
      const pts = (coalesced.length ? coalesced : [event]).map((e) => toStage(e.clientX, e.clientY)).filter(Boolean);
      stroke?.move(pts);
      if (pts.length) point?.({ ...pts[pts.length - 1], letter: null });
      return;
    }
    const raw = toStage(event.clientX, event.clientY);
    if (!raw) return;
    if (event.pointerType === 'mouse') {
      let next = null;
      if (handUnder(raw)) next = 'grab';
      else {
        const picked = tileOps ? pickTile(raw) : null;
        if (picked) next = picked.remove ? 'remove' : 'grab';
        else if (pieceActions) next = pieceGrip(raw);
      }
      setGrip(next);
    }
    if (tool === 'none') return;
    if (event.pointerType !== 'touch') point?.(raw);
  };

  // Ends what a pointer was doing (a stroke, a drag). Also used when a second finger arrives.
  const endAction = (event) => {
    const held = holding.current.get(event.pointerId);
    if (held) {
      holding.current.delete(event.pointerId);
      setGrip(null);
      live.current.handActions?.drop(held.side);
      return;
    }
    const pd = pieceDrag.current;
    if (pd && pd.pointerId === event.pointerId) {
      pieceDrag.current = null;
      setGrip(null);
      pieceActions?.drop(pd.id, pd.x, pd.y, pd.mode === 'resize' ? pd.w : undefined);
      return;
    }
    const td = tileDrag.current;
    if (td && td.pointerId === event.pointerId) {
      tileDrag.current = null;
      setGrip(null);
      const { tileActions: tileOps, canManageTiles: manage } = live.current;
      if (!td.moved && manage) tileOps?.select?.(td.id); // a click picks the tile for changing
      tileOps?.drop(td.id, td.x, td.y);
      return;
    }
    if (drawing.current === event.pointerId) {
      drawing.current = null;
      live.current.onStroke?.end();
    }
  };

  const onRelease = (event) => {
    if (holding.current.has(event.pointerId)) return endAction(event);
    const g = gesture.current;
    if (g.touches.delete(event.pointerId) && g.touches.size === 0) g.pinch = null;
    if (g.pinch) return;
    if (g.pan && g.pan.id === event.pointerId) {
      g.pan = null;
      return;
    }
    endAction(event);
  };

  const onPointerLeave = (event) => {
    if (event.pointerType !== 'mouse' || holding.current.size || tileDrag.current || pieceDrag.current) return;
    setGrip(null);
    if (tool === 'pen' || tool === 'eraser') live.current.onLeave?.();
  };

  let cursor = tool === 'none' ? '' : 'cursor-none';
  if (grip === 'grab') cursor = 'cursor-grab';
  if (grip === 'grabbing') cursor = 'cursor-grabbing';
  if (grip === 'remove') cursor = 'cursor-pointer';
  if (PIECE_CURSORS[grip]) cursor = PIECE_CURSORS[grip];
  const picById = new Map(pictures.map((p) => [p.id, p]));

  // Lets the Pictures panel drop a part exactly where the pointer lets go over the board.
  if (stageApi) {
    stageApi.current = {
      scale: layout.width / STAGE.width,
      pointAt(clientX, clientY) {
        const box = wrapRef.current?.getBoundingClientRect();
        if (!box || !layout.width) return null;
        if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) return null;
        const x = clientX - box.left - layout.left;
        const y = clientY - box.top - layout.top;
        if (x < 0 || y < 0 || x > layout.width || y > layout.height) return null;
        return { x: (x / layout.width) * STAGE.width, y: (y / layout.height) * STAGE.height };
      },
    };
  }
  const clip = boardRect(strip);
  const stacked = [...tiles].sort((a, b) => a.z - b.z);

  return (
    <div ref={wrapRef} className='relative h-full w-full select-none overflow-hidden'>
      {layout.scale > 0 && (view || size.height / size.width > 0.72) && (
        <button
          type='button'
          onClick={() => {
            autoFill.current = !view && Boolean(sticky);
            setView(view ? null : fillView(size.width, size.height, fillTop, fillCentre));
          }}
          aria-label={view ? 'Fit the whole board' : 'Fill the screen with the board'}
          title={view ? 'Fit the whole board' : 'Fill the screen with the board'}
          className='absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow ring-1 ring-slate-200 hover:bg-white'
        >
          {view ? <Shrink className='h-4 w-4' aria-hidden='true' /> : <Expand className='h-4 w-4' aria-hidden='true' />}
        </button>
      )}
      <Backdrop pointed={letters.join('')} strip={strip} boxes={boxes} viewBox={viewBox} bar={Boolean(fillTop)} />
      <svg viewBox={viewBox} preserveAspectRatio='xMidYMid meet' className='pointer-events-none absolute inset-0 h-full w-full' aria-hidden='true'>
        {stackedPieces.map((piece) => (
          <PieceImage key={piece.id} piece={piece} pic={picById.get(piece.pic)} src={pictureSrc(piece.pic)} />
        ))}
      </svg>
      <InkCanvas board={board} layout={layout} include={TUTOR_LAYER} clip={clip} />
      <InkCanvas board={board} layout={layout} include={STUDENT_LAYER} clip={clip} />
      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio='xMidYMid meet'
        className={`absolute inset-0 h-full w-full ${cursor} touch-none`}
        style={{ WebkitTouchCallout: 'none' }}
        role='img'
        aria-label={letters.length ? `Alphabet strip, pointing at ${letters.join(' and ')}` : 'Alphabet strip and whiteboard'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onRelease}
        onPointerCancel={onRelease}
        onPointerLeave={onPointerLeave}
      >
        <rect width={STAGE.width} height={STAGE.height} fill='transparent' />
        {stacked.map((tile) => (
          <Tile key={tile.id} tile={tile} mine={me} selected={tile.id === selectedTile} removable={canManageTiles} />
        ))}
        {peerView && (peerView.w < STAGE.width - 10 || peerView.h < STAGE.height - 10) && (
          <g className='pointer-events-none'>
            <rect
              x={peerView.x}
              y={peerView.y}
              width={peerView.w}
              height={peerView.h}
              rx='10'
              fill='none'
              strokeWidth='4'
              strokeDasharray='16 10'
              className='stroke-violet-500/70'
            />
            <text x={peerView.x + 14} y={peerView.y + 30} className='fill-violet-600/80' style={{ fontSize: 20, fontWeight: 700 }}>
              Student’s screen
            </text>
          </g>
        )}
        {stackedPieces
          .filter((p) => p.heldBy && p.heldBy !== me)
          .map((p) => (
            <rect
              key={`held-${p.id}`}
              x={p.x}
              y={p.y}
              width={p.w}
              height={p.h}
              rx='8'
              fill='none'
              strokeWidth='4'
              strokeDasharray='12 8'
              className={p.heldBy === 'tutor' ? 'stroke-blue-500' : 'stroke-violet-500'}
            />
          ))}
        {selectedPiece && (
          <g>
            <rect x={selectedPiece.x} y={selectedPiece.y} width={selectedPiece.w} height={selectedPiece.h} fill='none' strokeWidth='4' className='stroke-violet-600' />
            {canEditPieces &&
              handlesOf(selectedPiece).map((hd) => (
                <rect key={`${hd.hx},${hd.hy}`} x={hd.x - 11} y={hd.y - 11} width='22' height='22' rx='5' strokeWidth='4' className='fill-white stroke-violet-600' />
              ))}
            {bar && (
              <g>
                <rect x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx='16' strokeWidth='2' className='fill-white stroke-slate-200' />
                {bar.buttons.map((b) => {
                  const danger = b.action === 'delete';
                  const Icon = danger ? Trash2 : Copy;
                  return (
                    <g key={b.action} className={danger ? 'text-rose-600' : 'text-slate-700'}>
                      <Icon x={b.x + b.w / 2 - 14} y={b.y + 8} size={28} />
                      <text x={b.x + b.w / 2} y={b.y + 54} textAnchor='middle' fill='currentColor' style={{ fontSize: 16, fontWeight: 700 }}>
                        {danger ? 'Delete' : 'Duplicate'}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}
          </g>
        )}
        {/* With the alphabet in its own bar (phones, upright tablets), a hand pointing above the part
            of the board on screen shows in the bar, on its letter, rather than peeking out under it.
            Scrolled up to the board's own strip, the hand shows there as usual. */}
        {markers
          .filter((m) => !(fillTop && seen && m.y < seen.y))
          .map(({ key, ...marker }) => (
            <Marker key={key} {...marker} />
          ))}
        {/* With the alphabet in its own bar, a hand above the board shows there instead. */}
        {hands
          .filter((h) => !(fillTop && h.y < BOARD.y))
          .map((h) => (
            <Hand key={h.side} x={h.x} y={h.y} side={h.side} holder={h.by} smooth={h.by !== me} />
          ))}
      </svg>
    </div>
  );
}
