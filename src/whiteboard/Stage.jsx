import { DEFAULT_LINES } from '../../shared/lines.js';
import { guideRows } from './guides.js';
import { memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Hand from './Hand.jsx';
import AlphabetPickup, { isPickupCancellation, usePickupCancellation } from './AlphabetPickup.jsx';
import InkCanvas from './InkCanvas.jsx';
import Tile from './Tile.jsx';
import PieceImage from './PieceImage.jsx';
import PictureLayers from './PictureLayers.jsx';
import { soundBoxAt, soundBoxButtonRect, soundTapCanFinish, SOUND_TAP_SLOP } from './soundBoxInteraction.js';
import ObjectToolbar from './ObjectToolbar.jsx';
import { EraserMarker, PenMarker } from './Markers.jsx';
import { INK, STUDENT_LAYER, TUTOR_LAYER, insideBoard } from './board.js';
import { BOARD, CELL_WIDTH, LETTERS, STAGE, STRIP, boardRect, clamp, letterAt } from './stage.js';
import { MAX_TILES, TILE_HEIGHT, clampTile, snapTile, soundBoxTarget, soundBoxes, tileKind, tileWidth } from '../../shared/tiles.js';
import { clampPiece, isFacePiece, pieceSize } from '../../shared/pieces.js';
import { Minus, Plus, Scan } from 'lucide-react';
import { BELOW_STRIP, BoardFit, fillView, frame, viewAt, viewBoxOf } from './viewport.js';
import { picturePlacementBounds } from './picturePlacement.js';
import { pictureOverlapState } from './pictureGeometry.js';

const VIEW_BOX = `0 0 ${STAGE.width} ${STAGE.height}`;
// Handwriting guides (top line, dashed midline, baseline) stay put even when the board grows.
const PALM_MS = 1500; // touches this soon after an Apple Pencil event count as a resting palm
const CLICK_SLOP = 6; // a tile that moves less than this was clicked, not dragged

// The glove around its fingertip (the left hand is the right one mirrored).
const overHand = (p, hand) => {
  const dx = hand.side === 'l' ? hand.x - p.x : p.x - hand.x;
  return dx >= -50 && dx <= 52 && p.y >= hand.y - 10 && p.y <= hand.y + 146;
};
const overTile = (p, t) => p.x >= t.x && p.x <= t.x + tileWidth(t.text) && p.y >= t.y && p.y <= t.y + TILE_HEIGHT;

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
  nwse: 'cursor-nwse-resize',
  nesw: 'cursor-nesw-resize',
  ew: 'cursor-ew-resize',
  ns: 'cursor-ns-resize',
};
// Letter highlights: violet under the student's hand, blue under the tutor's.
// A letter a hand points at lights up in the hands' blue. `pointed` is those letters as one string.
function letterTone(letter, pointed) {
  if (!pointed.includes(letter)) return { cell: 'fill-white stroke-slate-200', text: 'fill-slate-800', width: 3 };
  return { cell: 'fill-blue-100 stroke-blue-500', text: 'fill-blue-800', width: 5 };
}

// The bottom layer: the alphabet strip (unless hidden), the board, its guide lines and the sound boxes.
const Backdrop = memo(function Backdrop({ pointed, strip, boxes, lines, viewBox, bar = false, activeBox = null, boxTaps = [] }) {
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
      {/* Handwriting lines: top line, dashed midline, and a slightly stronger baseline per row. */}
      {guideRows(board, lines).map((row) => (
        <g key={row.top} strokeWidth='3'>
          <line x1={board.x + 40} x2={board.x + board.width - 40} y1={row.top} y2={row.top} className='stroke-slate-200' />
          <line x1={board.x + 40} x2={board.x + board.width - 40} y1={row.mid} y2={row.mid} strokeDasharray='16 14' className='stroke-slate-200' />
          <line x1={board.x + 40} x2={board.x + board.width - 40} y1={row.base} y2={row.base} className='stroke-slate-300' />
        </g>
      ))}
      {soundBoxes(boxes).map((box, index) => {
        const pressed = boxTaps.includes(index);
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        return <g key={box.x}>
          <rect data-sound-box={index} data-sound-pressed={pressed ? 'true' : 'false'} data-drop-target={activeBox === index ? 'true' : undefined}
            x={box.x} y={box.y} width={box.width} height={box.height} rx='16' strokeWidth='4'
            strokeDasharray={activeBox === index || pressed ? undefined : '14 10'}
            className={activeBox === index || pressed ? 'fill-violet-50 stroke-violet-500' : 'fill-slate-50 stroke-slate-400'} />
          <circle cx={cx} cy={cy} r='25' strokeWidth='3' className={pressed ? 'fill-violet-600 stroke-violet-600' : 'fill-white stroke-violet-300'} />
          {pressed ? <path d={`M${cx - 11} ${cy}l8 8 15-18`} fill='none' stroke='white' strokeWidth='5' strokeLinecap='round' strokeLinejoin='round' /> : <circle cx={cx} cy={cy} r='7' className='fill-violet-200' />}
        </g>;
      })}

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
  boxTaps = [],
  boxEpoch = 0,
  onToggleSoundBox = null,
  canTapSoundBoxes = false,
  lines = DEFAULT_LINES,
  tiles = [],
  selectedTile = null,
  canManageTiles = false,
  lettersReady = true,
  tileActions,
  pieces = [],
  pictures = [],
  pictureSrc = () => '',
  pieceActions = null,
  canEditPieces = false,
  canDeletePieces = false,
  canDuplicatePieces = false,
  onSelectPiece = null, // selecting from Layers or adding a picture switches to Select
  onCropPiece = null, // tutor: open this session picture in the existing Magic Select editor
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
  const letterDrag = useRef(null);
  const counterTap = useRef(null);
  const [letterPreview, setLetterPreview] = useState(null);
  const [alphabetPickup, setAlphabetPickup] = useState(null);
  const [letterDrop, setLetterDrop] = useState(null);
  const lastPen = useRef(-Infinity); // no Apple Pencil yet, so no touch counts as a palm
  const live = useRef({});
  live.current = { onPoint, onLeave, onStroke, hands, handActions, canHoldHands, barApi, tiles, tileActions, canManageTiles, strip, boxes, boxTaps, boxEpoch, onToggleSoundBox, canTapSoundBoxes, tool };
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
  const [localTileId, setLocalTileId] = useState(null);
  const [activeBox, setActiveBox] = useState(null);
  const [layersOpen, setLayersOpen] = useState(false);
  useEffect(() => { counterTap.current = null; }, [boxes, boxEpoch, canTapSoundBoxes, tool]);
  // A release is only complete once the server's tile is in the shared board.
  useEffect(() => {
    if (letterDrop?.id && letterDrop.status !== 'placed' && tiles.some(tile => tile.id === letterDrop.id)) {
      setLetterDrop(current => current?.id === letterDrop.id ? { ...current, status: 'placed', message: `${current.text} added` } : current);
    }
  }, [tiles, letterDrop?.id, letterDrop?.status]);
  useEffect(() => {
    if (!letterDrop) return undefined;
    const timer = setTimeout(() => {
      setLetterDrop(current => current?.id !== letterDrop.id ? current : current?.status === 'pending'
        ? { ...current, status: 'error', message: `${current.text} hasn't appeared yet. Try again once the lesson is connected.` }
        : null);
    }, letterDrop.status === 'pending' ? 4000 : letterDrop.status === 'placed' ? 2000 : 6000);
    return () => clearTimeout(timer);
  }, [letterDrop?.id, letterDrop?.status, letterDrop?.message]);
  useEffect(() => setLocalTileId(selectedTile), [selectedTile]);
  const [placementNotice, setPlacementNotice] = useState('');
  // Pieces are handled with the pointer tools (Watch, Hand), never the pen or eraser.
  const movable = tool === 'none';
  const stackedPieces = [...pieces].sort((a, b) => a.z - b.z);
  const overlapState = useMemo(() => pictureOverlapState(pieces), [pieces]);
  const selectedPiece = movable ? pieces.find((p) => p.id === selectedPieceId) || null : null;
  const selectedLetter = movable && !selectedPiece ? tiles.find((tile) => tile.id === (selectedTile || localTileId)) || null : null;
  const selectLetter = (id) => { setSelectedPieceId(null); setLocalTileId(id); tileActions?.select?.(id); };
  const clearSelection = () => { setSelectedPieceId(null); setLocalTileId(null); tileActions?.select?.(null); };
  useEffect(() => {
    if (!selectedPiece && !selectedLetter) return undefined;
    const escape = event => { if (event.key === 'Escape' && !layersOpen && !event.target.closest?.('[role=dialog]')) clearSelection(); };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [selectedPiece?.id, selectedLetter?.id, layersOpen]);
  const selectedFace = Boolean(selectedPiece && isFacePiece(selectedPiece, pictures.find((picture) => picture.id === selectedPiece.pic)));
  const canResizeSelected = Boolean(selectedPiece && canEditPieces && (me === 'tutor' || !selectedFace));
  const selectPiece = (id) => {
    setSelectedPieceId(id);
    setLocalTileId(null);
    tileActions?.select?.(null);
    onSelectPiece?.(id);
    const piece = pieces.find((p) => p.id === id);
    if (piece && seen && (piece.x < seen.x || piece.y < seen.y || piece.x + piece.w > seen.x + seen.w || piece.y + piece.h > seen.y + seen.h)) {
      autoFill.current = false;
      const scale = Math.min(layoutRef.current.scale, size.width / (piece.w + 80), size.height / (piece.h + 80));
      setView({ scale, cx: piece.x + piece.w / 2, cy: piece.y + piece.h / 2 });
    }
  };
  const clearPiece = () => setSelectedPieceId(null);
  const visibleBounds = () => {
    const board = boardRect(strip);
    const left = Math.max(board.x, seen?.x ?? board.x);
    const right = Math.min(board.x + board.width, seen ? seen.x + seen.w : board.x + board.width);
    const top = Math.max(board.y, seen?.y ?? board.y);
    const bottom = Math.min(board.y + board.height, seen ? seen.y + seen.h : board.y + board.height);
    return picturePlacementBounds({ x: left, y: top, w: right - left, h: bottom - top });
  };
  const reportPlacement = (status) => setPlacementNotice(status?.error || (status?.crowded
    ? 'No open space in this view. The picture overlaps another picture; use Layers to separate them.'
    : status?.visible === false ? 'The picture is larger than this view. Zoom out or resize it.' : ''));
  const duplicatePiece = (id) => {
    const bounds = visibleBounds();
    const original = pieces.find((piece) => piece.id === id);
    const centre = original ? { x: original.x + original.w / 2, y: original.y + original.h / 2 } : null;
    const copy = pieceActions.duplicate(id, { bounds, centre });
    reportPlacement(pieceActions.placementStatus?.());
    if (!copy) return;
    selectPiece(copy);
  };
  const resizePiece = (factor) => {
    if (!selectedPiece || !canResizeSelected || !pieceActions || (selectedPiece.heldBy && selectedPiece.heldBy !== me)) return;
    const size = pieceSize(selectedPiece.crop, selectedPiece.w * factor);
    const at = clampPiece(size, selectedPiece.x + (selectedPiece.w - size.w) / 2, selectedPiece.y + (selectedPiece.h - size.h) / 2);
    pieceActions.grab(selectedPiece.id);
    pieceActions.drop(selectedPiece.id, at.x, at.y, size.w);
  };

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

  // Tile deletion belongs to the selected object's contextual toolbar.
  const pickTile = (p) => {
    const tile = [...live.current.tiles].sort((a, b) => b.z - a.z).find(tile => overTile(p, tile));
    return tile ? { tile } : null;
  };

  // The selected piece's resize handles. Other actions are real HTML buttons below.
  const pieceControl = (p) => {
    if (!selectedPiece) return null;
    if (!canResizeSelected) return null;
    const handle = handlesOf(selectedPiece).find((hd) => Math.abs(p.x - hd.x) <= HANDLE && Math.abs(p.y - hd.y) <= HANDLE);
    return handle ? { piece: selectedPiece, handle } : null;
  };
  const pickPiece = (p) => (movable ? [...stackedPieces].reverse().find((piece) => overRect(p, piece)) || null : null);
  const pieceGrip = (p) => {
    const control = pieceControl(p);
    if (control?.handle) return HANDLE_CURSOR[`${control.handle.hx},${control.handle.hy}`];
    return pickPiece(p) ? 'grab' : null;
  };

  const previewLetter = (text, clientX, clientY) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const inside = rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    const point = inside ? toStage(clientX, clientY) : null;
    if (!canManageTiles || !point || !insideBoard(point, boardRect(strip))) { setLetterPreview(null); setActiveBox(null); return false; }
    const at = clampTile(text, point.x - tileWidth(text) / 2, Math.max(boardRect(strip).y, point.y - TILE_HEIGHT / 2));
    const preview = { id: 'alphabet-preview', text, ...at, z: Infinity, kind: tileKind(text), heldBy: me };
    setLetterPreview(preview);
    setActiveBox(soundBoxTarget(preview, boxes, tiles)?.index ?? null);
    return true;
  };
  const clearLetterPreview = () => { setLetterPreview(null); setActiveBox(null); };
  const cancelAlphabetPickup = () => {
    const drag = letterDrag.current;
    letterDrag.current = null;
    if (drag) { live.current.handActions?.finishLetterPickup?.(); gesture.current.touches.delete(drag.pointerId); }
    if (!gesture.current.touches.size) gesture.current.pinch = null;
    setAlphabetPickup(null);
    setGrip(null);
    clearLetterPreview();
  };
  usePickupCancellation(alphabetPickup?.pointerId ?? null, cancelAlphabetPickup, alphabetPickup?.pointerType);
  useEffect(() => { if (!canManageTiles || !strip || fillTop) cancelAlphabetPickup(); }, [canManageTiles, strip, fillTop]); // eslint-disable-line react-hooks/exhaustive-deps
  const startAlphabetPickup = (event, raw) => {
    const letter = live.current.canManageTiles && !fillTop ? letterAt(raw.x, raw.y, live.current.strip) : null;
    if (!letter || letterDrag.current) return false;
    capture(event);
    const side = live.current.handActions?.beginLetterPickup?.(letter, { ...raw, letter });
    letterDrag.current = { pointerId: event.pointerId, pointerType: event.pointerType, text: letter, side: side || null, x: event.clientX, y: event.clientY, moved: false };
    setLetterDrop(null);
    setAlphabetPickup({ pointerId: event.pointerId, pointerType: event.pointerType, text: letter, side: side || null, x: event.clientX, y: event.clientY, onBoard: false });
    setGrip('grabbing');
    return true;
  };
  const addLetter = (text, point) => {
    if (!canManageTiles || !tileActions?.addAt) return null;
    const at = clampTile(text, point.x - tileWidth(text) / 2, Math.max(boardRect(strip).y, point.y - TILE_HEIGHT / 2));
    const target = snapTile({ id: 'alphabet-new', text, ...at }, boxes, tiles) || at;
    const id = tileActions.addAt(text, target.x, target.y);
    if (id) selectLetter(id);
    return id;
  };
  const dropLetter = (text, clientX, clientY) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const inside = rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    const point = inside ? toStage(clientX, clientY) : null;
    clearLetterPreview();
    if (!point || !insideBoard(point, boardRect(strip))) {
      setLetterDrop({ text, status: 'error', message: `Drop ${text} on the white writing area.` });
      return null;
    }
    if (!lettersReady) {
      setLetterDrop({ text, status: 'error', message: 'The lesson is reconnecting. Try again when it is connected.' });
      return null;
    }
    const id = addLetter(text, point);
    setLetterDrop(id
      ? { id, text, status: 'pending', message: `Placing ${text}…` }
      : { text, status: 'error', message: tiles.length >= MAX_TILES ? `The board has ${MAX_TILES} tiles. Remove one before adding another.` : `${text} could not be added. Try again.` });
    return id;
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
    if (isPickupCancellation(event) || isPalm(event) || event.button !== 0) return;
    const initialPoint = toStage(event.clientX, event.clientY);
    // A letter cell is a letter source, even when a shared pointing glove covers it.
    // The glove's palm/cuff below the strip still moves the shared pointer as before.
    if (initialPoint && !(event.pointerType === 'touch' && gesture.current.touches.size) && startAlphabetPickup(event, initialPoint)) {
      if (event.pointerType === 'touch') gesture.current.touches.set(event.pointerId, local(event.clientX, event.clientY));
      return;
    }
    // A visible tile wins over a glove covering its edge; the cuff remains grabbable.
    if (!letterDrag.current && !(initialPoint && live.current.tileActions && pickTile(initialPoint)) && grabHand(event)) return;
    if (event.pointerType === 'touch') {
      const g = gesture.current;
      g.touches.set(event.pointerId, local(event.clientX, event.clientY));
      if (g.touches.size === 2) {
        // A second finger: stop whatever the first was doing, and pinch or pan instead.
        if (letterDrag.current) { live.current.handActions?.finishLetterPickup?.(); letterDrag.current = null; setAlphabetPickup(null); setGrip(null); clearLetterPreview(); }
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
      selectLetter(tile.id);
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
      selectPiece(piece.id);
      if (piece.heldBy && piece.heldBy !== me) return; // the other person has it right now
      capture(event);
      pieceDrag.current = { pointerId: event.pointerId, id: piece.id, mode: 'move', dx: piece.x - raw.x, dy: piece.y - raw.y, x: piece.x, y: piece.y, w: piece.w, h: piece.h };
      setGrip('grabbing');
      pieceActions.grab(piece.id);
      if (tool !== 'none') point?.({ ...raw, letter: null });
      return;
    }
    if (movable) clearSelection();
    const target = event.button === 0 && movable && canTapSoundBoxes && onToggleSoundBox ? soundBoxAt(raw, live.current.boxes, layoutRef.current.scale) : null;
    if (target && !live.current.hands.some((hand) => overHand(raw, hand))) {
      capture(event);
      counterTap.current = { pointerId: event.pointerId, index: target.index, count: live.current.boxes, epoch: live.current.boxEpoch, pressed: !live.current.boxTaps.includes(target.index), x: event.clientX, y: event.clientY };
      return;
    }
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
    const ld = letterDrag.current;
    if (ld && ld.pointerId === event.pointerId) {
      if (Math.hypot(event.clientX - ld.x, event.clientY - ld.y) > CLICK_SLOP) ld.moved = true;
      const onBoard = ld.moved && previewLetter(ld.text, event.clientX, event.clientY);
      const point = toStage(event.clientX, event.clientY);
      if (point) live.current.handActions?.moveLetterPickup?.(point);
      setAlphabetPickup({ pointerId: event.pointerId, pointerType: ld.pointerType, text: ld.text, side: ld.side, x: event.clientX, y: event.clientY, onBoard: Boolean(onBoard) });
      return;
    }
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
    const tap = counterTap.current;
    if (tap?.pointerId === event.pointerId) {
      if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= SOUND_TAP_SLOP) return;
      counterTap.current = null;
      if (view) g.pan = { id: event.pointerId, at: boardPoint(local(tap.x, tap.y)) };
      else return;
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
      const pos = clampTile(td.text, raw.x + td.dx, Math.max(boardRect(live.current.strip).y, raw.y + td.dy));
      td.x = pos.x;
      td.y = pos.y;
      tileOps?.move(td.id, pos.x, pos.y);
      const target = soundBoxTarget({ id: td.id, text: td.text, ...pos }, live.current.boxes, live.current.tiles);
      setActiveBox(was => was === (target?.index ?? null) ? was : target?.index ?? null);
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
      if ((canManageTiles && !fillTop && letterAt(raw.x, raw.y, strip)) || handUnder(raw)) next = 'grab';
      else {
        const picked = tileOps ? pickTile(raw) : null;
        if (picked) next = 'grab';
        else if (pieceActions) next = pieceGrip(raw);
        if (!next && tool === 'none' && live.current.canTapSoundBoxes && !live.current.hands.some((hand) => overHand(raw, hand)) && soundBoxAt(raw, live.current.boxes, layoutRef.current.scale)) next = 'remove';
      }
      setGrip(next);
    }
    if (tool === 'none') return;
    if (event.pointerType !== 'touch') point?.(raw);
  };

  // Ends what a pointer was doing (a stroke, a drag). Also used when a second finger arrives.
  const endAction = (event) => {
    if (counterTap.current?.pointerId === event.pointerId) { counterTap.current = null; return; }
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
      setActiveBox(null);
      // The final movement may be coalesced or omitted; release is the final position.
      const released = event.type !== 'pointercancel' && Number.isFinite(event.clientX) && Number.isFinite(event.clientY) ? toStage(event.clientX, event.clientY) : null;
      if (released) {
        if (Math.abs(released.x - td.sx) + Math.abs(released.y - td.sy) > CLICK_SLOP) td.moved = true;
        Object.assign(td, clampTile(td.text, released.x + td.dx, Math.max(boardRect(live.current.strip).y, released.y + td.dy)));
      }
      if (!td.moved && manage) tileOps?.select?.(td.id);
      const at = snapTile(td, live.current.boxes, live.current.tiles) || { x: td.x, y: td.y };
      tileOps?.move(td.id, at.x, at.y);
      tileOps?.drop(td.id, at.x, at.y);
      return;
    }
    if (drawing.current === event.pointerId) {
      drawing.current = null;
      live.current.onStroke?.end();
    }
  };

  const onRelease = (event) => {
    const tap = counterTap.current;
    if (tap?.pointerId === event.pointerId) {
      counterTap.current = null;
      const g = gesture.current, pinching = Boolean(g.pinch);
      if (g.touches.delete(event.pointerId) && !g.touches.size) g.pinch = null;
      if (soundTapCanFinish(tap, event, { canTap: live.current.canTapSoundBoxes, tool: live.current.tool, count: live.current.boxes, epoch: live.current.boxEpoch, pinching, point: toStage(event.clientX, event.clientY), scale: layoutRef.current.scale })) live.current.onToggleSoundBox?.(tap.index, tap.pressed);
      return;
    }
    const ld = letterDrag.current;
    if (ld && ld.pointerId === event.pointerId) {
      letterDrag.current = null;
      setAlphabetPickup(null);
      setGrip(null);
      gesture.current.touches.delete(event.pointerId);
      if (!gesture.current.touches.size) gesture.current.pinch = null;
      const moved = ld.moved || Math.hypot(event.clientX - ld.x, event.clientY - ld.y) > CLICK_SLOP;
      const id = moved && event.type !== 'pointercancel' ? dropLetter(ld.text, event.clientX, event.clientY) : null;
      if (!id) clearLetterPreview();
      live.current.handActions?.finishLetterPickup?.(id ? toStage(event.clientX, event.clientY) : null);
      return;
    }
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
    if (event.pointerType !== 'mouse' || holding.current.size || tileDrag.current || pieceDrag.current || letterDrag.current) return;
    setGrip(null);
    if (tool === 'pen' || tool === 'eraser') live.current.onLeave?.();
  };

  let cursor = tool === 'none' ? '' : 'cursor-none';
  if (grip === 'grab') cursor = 'cursor-grab';
  if (grip === 'grabbing') cursor = 'cursor-grabbing';
  if (grip === 'remove') cursor = 'cursor-pointer';
  if (PIECE_CURSORS[grip]) cursor = PIECE_CURSORS[grip];
  const picById = new Map(pictures.map((p) => [p.id, p]));

  const showSoundBoxes = () => {
    const list = soundBoxes(boxes);
    if (!list.length || !size.width || !size.height) return;
    autoFill.current = false;
    const width = list.at(-1).x + list.at(-1).width - list[0].x;
    const scale = Math.min(size.width / (width + 80), size.height / (list[0].height + 100));
    zoomTo(scale, STAGE.width / 2, list[0].y + list[0].height / 2, size.width / 2, size.height / 2);
  };

  // Lets the Pictures panel drop a part exactly where the pointer lets go over the board.
  if (stageApi) {
    stageApi.current = {
      scale: layout.width / STAGE.width,
      bounds: visibleBounds,
      placementStatus: () => pieceActions?.placementStatus?.(),
      reportPlacement,
      centre() {
        const bounds = visibleBounds();
        return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
      },
      selectPiece, showSoundBoxes,
      previewLetter, clearLetterPreview, dropLetter,
      addLetter(text) { const bounds = visibleBounds(); return addLetter(text, { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }); },
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
  const paperTop = Math.max(8, layout.top + clip.y * layout.scale + 8);
  const reserved = []; // Resource controls share the existing footer, outside the paper.
  const zoomAroundCentre = (scale) => {
    const point = boardPoint({ x: size.width / 2, y: size.height / 2 });
    zoomTo(scale, point.x, point.y, size.width / 2, size.height / 2);
  };
  const zoomControl = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-violet-100 disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500';

  return (
    <div className='flex h-full w-full min-h-0 flex-col'>
      <div ref={wrapRef} data-board-surface className='relative min-h-0 flex-1 select-none overflow-hidden'>
      <Backdrop pointed={letters.join('') + (alphabetPickup?.text || '')} strip={strip} boxes={boxes} lines={lines} viewBox={viewBox} bar={Boolean(fillTop)} activeBox={activeBox} boxTaps={boxTaps} />
      <svg viewBox={viewBox} preserveAspectRatio='xMidYMid meet' className='pointer-events-none absolute inset-0 h-full w-full' aria-hidden='true'>
        {stackedPieces.map((piece) => (
          <PieceImage key={piece.id} piece={piece} pic={picById.get(piece.pic)} src={pictureSrc(piece.pic)} overlap={overlapState.get(piece.id)} />
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
        onLostPointerCapture={event => { if (letterDrag.current?.pointerId === event.pointerId) cancelAlphabetPickup(); }}
        onPointerLeave={onPointerLeave}
      >
        <rect width={STAGE.width} height={STAGE.height} fill='transparent' />
        {stacked.map((tile) => (
          <Tile key={tile.id} tile={tile} mine={me} selected={tile.id === selectedLetter?.id} />
        ))}
        {letterPreview && <g opacity='.8' data-alphabet-preview><Tile tile={letterPreview} mine={me} /></g>}
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
          <g className='pointer-events-none'>
            <rect x={selectedPiece.x} y={selectedPiece.y} width={selectedPiece.w} height={selectedPiece.h} fill='none' stroke='white' strokeWidth='6' vectorEffect='non-scaling-stroke' />
            <rect x={selectedPiece.x} y={selectedPiece.y} width={selectedPiece.w} height={selectedPiece.h} fill='none' strokeWidth='2.5' vectorEffect='non-scaling-stroke' className='stroke-violet-600' />
            {canResizeSelected && !(selectedPiece.heldBy && selectedPiece.heldBy !== me) &&
              handlesOf(selectedPiece).map((hd) => (
                <rect data-picture-resize-handle={`${hd.hx},${hd.hy}`} key={`${hd.hx},${hd.hy}`} x={hd.x - 11} y={hd.y - 11} width='22' height='22' rx='5' strokeWidth='4' className='fill-white stroke-violet-600' />
              ))}
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
            <Hand key={h.side} x={h.x} y={h.y} side={h.side} holder={h.by} smooth={h.by !== me} pose={h.by ? 'grab' : 'point'} />
          ))}
      </svg>
      <AlphabetPickup pickup={alphabetPickup} />
      {letterDrop && <div data-letter-drop-status={letterDrop.status} role='status'
        className={`pointer-events-none absolute bottom-3 left-1/2 z-20 max-w-[calc(100%-1rem)] -translate-x-1/2 rounded-xl border px-3 py-2 text-center text-sm font-semibold shadow-sm ${letterDrop.status === 'error' ? 'border-amber-200 bg-amber-50 text-amber-900' : letterDrop.status === 'placed' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-blue-200 bg-white text-blue-900'}`}>
        {letterDrop.message}
      </div>}

      {boxes > 0 && <div role='group' aria-label='Sound box counters' className='pointer-events-none absolute inset-0 z-10'>
        {soundBoxes(boxes).map((box, index) => {
          const rect = soundBoxButtonRect(box, layout);
          const visible = rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= size.width && rect.y + rect.h <= size.height;
          return <button key={index} type='button' data-sound-counter={index} aria-label={`Sound box ${index + 1} counter`} aria-pressed={boxTaps.includes(index)} aria-hidden={!visible || undefined} tabIndex={visible ? 0 : -1} disabled={!canTapSoundBoxes || !movable || !onToggleSoundBox}
            title={canTapSoundBoxes ? 'Select tool: tap one box for each sound' : 'Your tutor needs to turn on your tools first'}
            onClick={() => { if (canTapSoundBoxes && movable) onToggleSoundBox?.(index, !boxTaps.includes(index)); }}
            className='pointer-events-none absolute rounded-xl border border-transparent bg-transparent focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-violet-600'
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}><span className='sr-only'>Sound {index + 1}</span></button>;
        })}
      </div>}
      {movable && !layersOpen && !pieceDrag.current && !tileDrag.current && !letterDrag.current && !letterPreview && (selectedPiece || selectedLetter) && <ObjectToolbar
        object={selectedPiece || { ...selectedLetter, w: tileWidth(selectedLetter.text), h: TILE_HEIGHT }}
        kind={selectedPiece ? 'picture' : 'tile'}
        label={selectedPiece ? picById.get(selectedPiece.pic)?.title || 'Picture' : `Letter ${selectedLetter.text}`}
        layout={layout} viewport={size} topInset={paperTop} reserved={reserved}
        locked={Boolean((selectedPiece || selectedLetter).heldBy && (selectedPiece || selectedLetter).heldBy !== me)}
        resizeLocked={me === 'student' && selectedFace}
        placementNotice={selectedPiece ? placementNotice : ''}
        onCrop={selectedPiece && me === 'tutor' && onCropPiece ? () => onCropPiece(selectedPiece) : null}
        onDuplicate={selectedPiece ? canDuplicatePieces ? () => duplicatePiece(selectedPiece.id) : null : canManageTiles && tileActions?.duplicate ? () => { const copy = tileActions.duplicate(selectedLetter.id); if (copy) selectLetter(copy); } : null}
        onDelete={selectedPiece ? canDeletePieces ? () => { pieceActions.remove(selectedPiece.id); clearSelection(); } : null : canManageTiles ? () => { tileActions.remove(selectedLetter.id); clearSelection(); } : null}
        onClear={clearSelection}
      />}
      </div>
      <div data-board-footer className='relative z-50 flex h-11 shrink-0 items-center justify-between gap-1 border-t border-slate-200/70 bg-slate-50 px-1'>
        <div className='min-w-0'>
          {pieceActions && <PictureLayers
            inline above
            open={layersOpen}
            pieces={pieces}
            pictures={pictures}
            selected={selectedPiece}
            me={me}
            srcFor={pictureSrc}
            onSelect={selectPiece}
            onOpenChange={setLayersOpen}
            onClear={clearPiece}
            onLayer={pieceActions.layer}
            onResize={resizePiece}
            canResize={canResizeSelected}
            resizeLocked={me === 'student' && selectedFace}
            canShrink={selectedPiece && pieceSize(selectedPiece.crop, selectedPiece.w * 0.8).w < selectedPiece.w - 0.05}
            canGrow={selectedPiece && pieceSize(selectedPiece.crop, selectedPiece.w * 1.25).w > selectedPiece.w + 0.05}
            height={size.height}
            overlapState={overlapState}
          />}
        </div>
        <div data-board-zoom role='group' aria-label='Board zoom' className='flex shrink-0'>
          <button type='button' aria-label='Zoom out' disabled={layout.scale <= layout.fit * 1.02} onClick={() => zoomAroundCentre(layout.scale / 1.25)} className={zoomControl}><Minus className='h-4 w-4' aria-hidden='true' /></button>
          <button type='button' aria-label='Zoom to 100%' onClick={() => zoomAroundCentre(1)} className={`${zoomControl} min-w-14`}><span>{Math.round(layout.scale * 100)}%</span></button>
          <button type='button' aria-label='Zoom in' disabled={layout.scale >= layout.max * .999} onClick={() => zoomAroundCentre(layout.scale * 1.25)} className={zoomControl}><Plus className='h-4 w-4' aria-hidden='true' /></button>
          <button type='button' aria-label='Fit the whole board' onClick={() => { autoFill.current = false; setView(null); }} className={zoomControl}><Scan className='mr-1 h-4 w-4' aria-hidden='true' />Fit</button>
        </div>
      </div>
    </div>
  );
}
