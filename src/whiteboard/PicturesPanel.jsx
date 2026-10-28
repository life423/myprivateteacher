import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BoxSelect, Check, Eye, Gift, Image as ImageIcon, LayoutGrid, Plus, Wand2, X } from 'lucide-react';
import { mergePictureRegions, regionAt } from './regions.js';
import { pictureRegions } from './pictures.js';
import { MAX_PICTURES, startingWidth } from '../../shared/pieces.js';
import { defaultPictureCrop, picturePlacement } from './picturePlacement.js';
import { catalogCollections, collectionLabel, filterLibraryCards } from './libraryCatalog.js';
import './pictureLibrary.css';

const DRAG_START = 6; // screen pixels a press moves before it becomes a drag
const card = 'flex flex-col gap-3 rounded-2xl bg-white p-3 shadow';
const primary =
  'flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';
const secondary =
  'flex min-h-11 items-center justify-center gap-2 rounded-xl border border-violet-300 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';

const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const partOf = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, r: r.r || 0 });
const sameCrop = (a, b) => Boolean(a && b) && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const boxFrom = (a, b) => ({
  x: Math.round(Math.min(a.x, b.x)),
  y: Math.round(Math.min(a.y, b.y)),
  w: Math.round(Math.abs(a.x - b.x)),
  h: Math.round(Math.abs(a.y - b.y)),
  r: 0,
});
// The smallest given part under a point.
const offerAt = (list, p) =>
  list.filter((o) => inside(p, o.crop)).sort((a, b) => a.crop.w * a.crop.h - b.crop.w * b.crop.h)[0] || null;

// The part being dragged to the board, drawn under the finger.
function Ghost({ src, pic, crop, width }) {
  return (
    <svg
      width={width}
      height={(width * crop.h) / crop.w}
      viewBox={`${crop.x} ${crop.y} ${crop.w} ${crop.h}`}
      preserveAspectRatio='none'
      className='block'
    >
      <defs>
        <clipPath id='ghost-clip'>
          <rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} rx={crop.r} />
        </clipPath>
      </defs>
      <image href={src} width={pic.w} height={pic.h} clipPath='url(#ghost-clip)' preserveAspectRatio='none' />
    </svg>
  );
}

function Outline({ r, className, dashed = false }) {
  return (
    <rect
      x={r.x}
      y={r.y}
      width={r.w}
      height={r.h}
      rx={r.r || 0}
      strokeWidth='3'
      strokeDasharray={dashed ? '8 6' : undefined}
      vectorEffect='non-scaling-stroke'
      className={className}
    />
  );
}

// A small label pinned to the top-left corner of a given part.
function Badge({ offer, pic, children }) {
  return (
    <span
      className='pointer-events-none absolute rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-bold text-slate-900 shadow'
      style={{ left: `calc(${(offer.crop.x / pic.w) * 100}% + 4px)`, top: `calc(${(offer.crop.y / pic.h) * 100}% + 4px)` }}
    >
      {children}
    </span>
  );
}

// Catalog previews remain private and do not consume session-picture slots.
function LibraryPhoto({ card, loadImage, onOpen, disabled }) {
  const button = useRef(null);
  const [state, setState] = useState({ src: null, error: false, loading: false });
  const active = useRef(true);
  const load = () => {
    if (state.loading) return;
    setState({ src: null, error: false, loading: true });
    Promise.resolve().then(() => loadImage(card.id)).then((src) => {
      if (active.current) setState({ src, error: false, loading: false });
    }).catch(() => {
      if (active.current) setState({ src: null, error: true, loading: false });
    });
  };
  useEffect(() => {
    active.current = true;
    setState({ src: null, error: false, loading: false });
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); load(); }
    }, { rootMargin: '240px' });
    observer.observe(button.current);
    return () => { active.current = false; observer.disconnect(); };
  }, [card.id, loadImage]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button ref={button} type='button' onClick={() => state.error ? load() : onOpen()} disabled={disabled || (!state.src && !state.error)}
      aria-label={state.error ? `Retry picture for ${card.title}` : `Open ${card.title}`}
      className='relative block aspect-square min-h-11 w-full bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-violet-500'>
      {state.src ? <img src={state.src} alt={card.title} width={card.w} height={card.h} loading='lazy' decoding='async' draggable={false} className='block h-full w-full object-contain' /> : (
        <span className='absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-slate-500'>
          {state.error ? 'Picture unavailable. Tap to retry.' : <span role='status'>Loading picture…</span>}
        </span>
      )}
    </button>
  );
}

// The Pictures tab. The tutor adds pictures (a file, or paste), lifts any part out with Magic
// Select (or a drawn box), and chooses which parts the student may take: each one once, while
// the student's tools are on. The student sees only those parts. Parts are copies, so the
// picture itself stays whole.
export default function PicturesPanel({
  pictures,
  offers = [],
  srcFor,
  canAdd = false,
  onAddFile,
  library = [],
  libraryState = { status: 'ready' },
  onRetryLibrary,
  loadLibraryImage,
  onAddFromLibrary,
  onGiveAll,
  onBrowse,
  layout = 'side', // 'side' (the column or sheet) or 'drawer' (the picture library slide-out)
  browseOnly = false, // session gallery without uploads or paste (the slide-out)
  showLibrary = false, // a tutor can browse the full resource catalog before adding session pictures
  peerPic = null, // the picture the student is looking at (shown to the tutor, violet)
  guidePic = null, // the picture the tutor is pointing at (blue)
  onGuide, // tutor: show a picture on the student's screen, or stop (null)
  onOpenChange, // told which picture is open (or null)
  notice = null, // a line at the top: { text, tone: 'violet' | 'sky', action?: { label, onClick } }
  onClear,
  onPlace,
  onPlaced,
  onOffer,
  onWithdraw,
  onReset,
  canTake = false,
  stageApi,
  onShow,
}) {
  const student = !canAdd;
  const [openId, setOpenId] = useState(null);
  const [regions, setRegions] = useState([]);
  const [findingRegions, setFindingRegions] = useState(false);
  const [mode, setMode] = useState('magic');
  const [hover, setHover] = useState(null);
  const [selection, setSelection] = useState(null);
  const [box, setBox] = useState(null);
  const [ghost, setGhost] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [armed, setArmed] = useState(false);
  const [libraryNote, setLibraryNote] = useState(null);
  const [placedNote, setPlacedNote] = useState(null);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogCollection, setCatalogCollection] = useState('');
  const catalogSearch = useRef(null);
  const collections = useMemo(() => catalogCollections(library), [library]);
  const activeCollection = collections.includes(catalogCollection) ? catalogCollection : '';
  const filteredLibrary = useMemo(() => filterLibraryCards(library, { collection: activeCollection, query: catalogQuery }), [library, activeCollection, catalogQuery]);
  const busyRef = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => {
    onOpenChangeRef.current?.(openId);
  }, [openId]);
  const fileRef = useRef(null);
  const svgRef = useRef(null);
  const press = useRef(null);

  const catalogVisible = canAdd && showLibrary;
  const catalogReady = libraryState.status === 'ready';
  const catalogIds = useMemo(() => new Set(library.map((item) => item.id)), [library]);
  // A library card appears once in the tutor's catalog, even after it enters the lesson.
  const sessionPictures = catalogVisible ? pictures.filter((item) => !item.library || (catalogReady && !catalogIds.has(item.library))) : pictures;
  const shown = pictures; // both people see every session picture

  const pic = shown.find((p) => p.id === openId) || null;
  const src = pic ? srcFor(pic.id) : null;
  const size = pic ? `${pic.w}x${pic.h}` : '';
  const picOffers = pic ? offers.filter((o) => o.pic === pic.id) : [];
  const available = picOffers.filter((o) => !o.taken);
  // First-party cards (the articulation cards) come with predefined regions, like the mouth
  // photo: Magic Select offers exactly those, and a student may take them with tools on.
  const predefined = pic?.regions?.length ? pic.regions : null;
  const predefinedKey = predefined ? predefined.map((r) => `${r.id}:${r.x},${r.y},${r.w},${r.h}`).join(';') : '';
  const takeable = student && predefined ? predefined : [];
  const inSession = (card) => pictures.some((p) => p.library === card.id);
  const uploads = pictures.filter((p) => !p.library).length; // library cards have their own limit
  const previewArea = useRef(null);
  const [previewSize, setPreviewSize] = useState(null);
  useLayoutEffect(() => {
    if (!pic || layout !== 'drawer' || !previewArea.current) return undefined;
    const area = previewArea.current;
    const fit = () => {
      const width = Math.min(area.clientWidth, area.clientHeight * pic.w / pic.h);
      setPreviewSize({ width: Math.max(1, width), height: Math.max(1, width * pic.h / pic.w) });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(area);
    fit();
    return () => observer.disconnect();
  }, [pic?.id, pic?.w, pic?.h, layout]);


  // Each picture's parts are found once, when the tutor first opens it.
  useEffect(() => {
    setRegions([]);
    setFindingRegions(false);
    setSelection(null);
    setHover(null);
    if (!src) return undefined;
    // Keep the curated mouth crop ready immediately, but let the tutor select
    // every other part too. Students retain only their allowed regions/offers.
    if (predefined) setRegions(predefined);
    if (student) return undefined;
    setFindingRegions(true);
    const [w, h] = size.split('x').map(Number);
    let live = true;
    pictureRegions(src, { w, h }).then((found) => {
      if (live) {
        setRegions(mergePictureRegions(found, predefined || []));
        setFindingRegions(false);
      }
    });
    return () => {
      live = false;
    };
  }, [src, size, student, predefinedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const working = (value) => {
    busyRef.current = value;
    setBusy(value);
  };

  const placePicture = (picture, title = 'Picture') => {
    const centre = stageApi?.current?.centre?.();
    const bounds = stageApi?.current?.bounds?.();
    const placement = picturePlacement(picture, centre, { bounds });
    if (!placement || !onPlace) return false;
    const pieceId = onPlace({ ...placement, automatic: true, centre, bounds });
    const status = stageApi?.current?.placementStatus?.();
    if (!pieceId) {
      setNote(status?.error || 'This picture could not be added to the board. Please try again.');
      return false;
    }
    stageApi?.current?.selectPiece?.(pieceId);
    stageApi?.current?.reportPlacement?.(status);
    setPlacedNote({ id: picture.id, text: `${title} added to the board. Drag to move it, or use a corner to resize.` });
    setOpenId(null);
    onPlaced?.();
    return true;
  };

  const addFile = async (file) => {
    if (!file || !canAdd || !onAddFile || busyRef.current) return;
    working(true);
    setNote(null);
    setPlacedNote(null);
    try {
      const result = await onAddFile(file);
      if (result?.error) setNote(result.error);
      else if (result?.id) {
        const picture = { ...pictures.find((p) => p.id === result.id), ...result };
        if (!placePicture(picture)) {
          setOpenId(result.id);
          setNote('Picture uploaded. Add it to the board below, or choose a part.');
        }
      }
    } catch {
      setNote('The picture couldn’t be uploaded. Please try again.');
    } finally {
      working(false);
    }
  };

  // Share the catalog selection, so a search or collection filter also limits bulk sharing.
  const giveAll = async () => {
    if (!onGiveAll || busyRef.current || !filteredLibrary.length) return;
    working(true);
    setLibraryNote(null);
    try {
      const result = await onGiveAll(filteredLibrary);
      setLibraryNote(result?.error || (result?.added ? `${result.added} card${result.added === 1 ? '' : 's'} added. Your student can open them from Pictures.` : 'These cards are already in this session.'));
    } catch {
      setLibraryNote('The library couldn’t be shared. Please try again.');
    } finally {
      working(false);
    }
  };

  // Add is one step. Choosing a part remains an explicit, separate action.
  const addCard = async (card, action = 'place') => {
    if (!canAdd || !onAddFromLibrary || busyRef.current) return;
    working(true);
    setNote(null);
    setPlacedNote(null);
    try {
      const result = await onAddFromLibrary(card);
      if (result?.error) setNote(result.error);
      else if (result?.id) {
        const picture = { ...card, ...pictures.find((p) => p.id === result.id), ...result };
        if (action === 'show') onGuide?.(guidePic === result.id ? null : result.id);
        else if (action === 'part' || !placePicture(picture, card.title || 'Picture')) setOpenId(result.id);
      }
    } catch {
      setNote('That picture couldn’t be added. Please try again.');
    } finally {
      working(false);
    }
  };

  // Pasting an image anywhere on the page adds it (tutor only).
  useEffect(() => {
    if (!canAdd || browseOnly) return undefined;
    const onPaste = (event) => {
      const file = [...(event.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      event.preventDefault();
      onShow?.();
      addFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  // A deliberate drop keeps its location. Button placement finds open space.
  const place = (crop, clientX, clientY, offerId, regionId) => {
    const centre = stageApi?.current?.centre?.();
    const bounds = stageApi?.current?.bounds?.();
    let placement = picturePlacement(pic, centre, { bounds, crop });
    if (!placement) return false;
    const automatic = clientX === undefined;
    if (!automatic) {
      const at = stageApi?.current?.pointAt(clientX, clientY);
      if (!at) return false;
      const w = startingWidth(crop);
      placement = { pic: pic.id, crop, x: at.x - w / 2, y: at.y - w * crop.h / crop.w / 2, w };
    }
    const pieceId = onPlace({ ...placement, offer: offerId, region: regionId,
      ...(automatic ? { automatic: true, centre, bounds } : {}) });
    const status = stageApi?.current?.placementStatus?.();
    if (!pieceId) {
      setNote(status?.error || 'This picture could not be added to the board. Please try again.');
      return false;
    }
    stageApi?.current?.selectPiece?.(pieceId);
    stageApi?.current?.reportPlacement?.(status);
    setNote('Added to the board. Drag to move it, or use a corner to resize.');
    onPlaced?.();
    if (student) setSelection(null);
    return true;
  };

  const toPic = (event) => {
    const r = svgRef.current.getBoundingClientRect();
    return {
      x: Math.min(pic.w, Math.max(0, ((event.clientX - r.left) / r.width) * pic.w)),
      y: Math.min(pic.h, Math.max(0, ((event.clientY - r.top) / r.height) * pic.h)),
    };
  };

  const pickUp = (event, part, offerId, regionId) => {
    press.current = { kind: 'part', part, offer: offerId, region: regionId, sx: event.clientX, sy: event.clientY, dragging: false };
  };

  // Press on a part to pick it up. The tutor can also press anywhere else to draw a box.
  const onDown = (event) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // works without capture too
    }
    setNote(null);
    const p = toPic(event);
    if (student) {
      const offer = offerAt(available, p);
      const region = offer ? null : takeable.find((r) => inside(p, r));
      if (!offer && !region) return;
      if (!canTake) {
        setNote('Your tutor needs to turn on your tools first.');
        return;
      }
      const crop = offer ? offer.crop : partOf(region);
      setSelection(crop);
      pickUp(event, crop, offer?.id, region?.id);
      return;
    }
    let part = selection && inside(p, selection) ? selection : null;
    if (!part) {
      const offer = offerAt(picOffers, p);
      if (offer) part = offer.crop;
    }
    if (!part && mode === 'magic') {
      const region = regionAt(regions, p.x, p.y);
      if (region) part = { x: region.x, y: region.y, w: region.w, h: region.h, r: region.r };
    }
    if (part) {
      setSelection(part);
      pickUp(event, part);
    } else {
      press.current = { kind: 'box', start: p };
      setBox(boxFrom(p, p));
    }
  };

  const onMove = (event) => {
    const current = press.current;
    if (!current) {
      if (event.pointerType !== 'mouse') return;
      const p = toPic(event);
      if (student) setHover(offerAt(available, p)?.crop || null);
      else if (mode === 'magic') setHover(regionAt(regions, p.x, p.y));
      return;
    }
    if (current.kind === 'box') {
      setBox(boxFrom(current.start, toPic(event)));
      return;
    }
    if (!current.dragging && Math.hypot(event.clientX - current.sx, event.clientY - current.sy) < DRAG_START) return;
    current.dragging = true;
    const scale = stageApi?.current?.scale || 0.6;
    setGhost({ x: event.clientX, y: event.clientY, width: startingWidth(current.part) * scale, part: current.part });
  };

  const onUp = (event) => {
    const current = press.current;
    press.current = null;
    if (!current) return;
    if (current.kind === 'box') {
      const drawn = boxFrom(current.start, toPic(event));
      setBox(null);
      const min = Math.max(12, Math.min(pic.w, pic.h) * 0.02);
      if (drawn.w >= min && drawn.h >= min) setSelection(drawn);
      return;
    }
    setGhost(null);
    if (current.dragging && event.type === 'pointerup' && !place(current.part, event.clientX, event.clientY, current.offer, current.region)) {
      setNote('Drop it on the board to place it.');
    }
  };

  if (pic) {
    const offered = !student && selection ? picOffers.find((o) => sameCrop(o.crop, selection)) : null;
    const chosen = student && selection ? available.find((o) => sameCrop(o.crop, selection)) : null;
    const chosenRegion = student && selection ? takeable.find((r) => sameCrop(partOf(r), selection)) : null;
    let hint = 'Tap a part to select it, or drag across the picture to draw a box.';
    if (mode === 'box') hint = 'Drag across the picture to draw a box around what you want.';
    if (mode === 'magic') hint = findingRegions
      ? 'Finding selectable parts… You can still draw a box.'
      : 'Tap a photo, heading, diagram or text to select it. Draw a box for any other area.';
    if (selection) hint = 'Drag the selected part onto the board, or use the buttons below.';
    if (offered) hint = offered.taken ? 'Your student has taken this part.' : 'Your student can take this part once, while their tools are on.';
    if (student && takeable.length) {
      const what = takeable[0].label.toLowerCase();
      hint = canTake ? `Drag the ${what} onto the board.` : `Your tutor will turn on your tools so you can take the ${what}.`;
    } else if (student) {
      if (available.length && canTake) hint = 'Drag the bright part onto the board. You can take it once.';
      else if (available.length) hint = 'Your tutor will turn on your tools so you can take the bright part.';
      else if (picOffers.length) hint = 'You’ve used the part your tutor gave you.';
      else hint = 'Your tutor hasn’t given you a part of this picture yet.';
    }
    const bright = [...available.map((o) => o.crop), ...takeable];
    const dim = `M0 0H${pic.w}V${pic.h}H0Z${bright.map((c) => `M${c.x} ${c.y}h${c.w}v${c.h}h${-c.w}Z`).join('')}`;
    return (
      <section aria-label='Pictures' className={`${card} ${layout === 'drawer' ? 'picture-editor h-full min-h-0 gap-2 overflow-hidden' : ''}`}>
        <div data-editor-control className='flex shrink-0 items-center justify-between gap-2'>
        <button
          type='button'
          onClick={() => setOpenId(null)}
          className='flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-sm font-semibold text-violet-700 hover:bg-violet-50'
        >
          <ArrowLeft className='h-4 w-4' aria-hidden='true' />
          All pictures
        </button>
        {student && guidePic && guidePic !== pic.id && (
          <div role='status' className='flex flex-wrap items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800'>
            <span className='h-2 w-2 shrink-0 rounded-full bg-sky-500' aria-hidden='true' />
            <span className='min-w-0 flex-1'>Your tutor picked a different picture.</span>
            <button type='button' onClick={() => setOpenId(guidePic)} className='rounded-full bg-white px-2.5 py-0.5 text-xs font-bold shadow-sm ring-1 ring-sky-200 hover:bg-sky-50'>
              Show me
            </button>
          </div>
        )}
        {student && guidePic === pic.id && <p className='text-sm font-semibold text-sky-700'>Your tutor picked this one.</p>}
        {!student && peerPic === pic.id && <p className='text-sm font-semibold text-violet-700'>Your student is looking at this too.</p>}
        {onGuide && (
          <button
            type='button'
            aria-pressed={guidePic === pic.id}
            onClick={() => onGuide(guidePic === pic.id ? null : pic.id)}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${
              guidePic === pic.id ? 'bg-sky-500 text-white hover:bg-sky-600' : 'bg-sky-50 text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100'
            }`}
          >
            <Eye className='h-4 w-4' aria-hidden='true' />
            {guidePic === pic.id ? 'Showing on your student’s screen · Stop' : 'Show student'}
          </button>
        )}
        </div>
        <div data-editor-preview ref={previewArea} className={layout === 'drawer' ? 'flex min-h-0 flex-1 items-center justify-center' : ''}>
        <div style={layout === 'drawer' && previewSize ? previewSize : undefined} className='relative max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white'>
          <img
            src={src}
            alt=''
            draggable={false}
            className={layout === 'drawer' ? 'block h-full w-full select-none object-contain' : 'block w-full select-none'}
          />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${pic.w} ${pic.h}`}
            preserveAspectRatio='none'
            className={`absolute inset-0 h-full w-full touch-none ${student ? 'cursor-pointer' : 'cursor-crosshair'}`}
            role='img'
            aria-label={student ? 'Picture. Drag the bright part onto the board.' : 'Picture. Tap a part to select it, then drag it onto the board.'}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={() => setHover(null)}
          >
            {student && bright.length > 0 && <path d={dim} fillRule='evenodd' className='fill-slate-900/40' />}
            {(student ? available : picOffers).map((o) => (
              <Outline key={o.id} r={o.crop} className='fill-none stroke-amber-400' />
            ))}
            {hover && !sameCrop(hover, selection) && <Outline r={hover} dashed className='fill-violet-500/10 stroke-violet-400' />}
            {selection && <Outline r={selection} className='fill-violet-500/15 stroke-violet-600' />}
            {box && <Outline r={box} dashed className='fill-sky-500/10 stroke-sky-600' />}
          </svg>
          {picOffers
            .filter((o) => !student || o.taken)
            .map((o) => (
              <Badge key={o.id} offer={o} pic={pic}>
                {student ? 'Used' : o.taken ? 'Taken' : 'For student'}
              </Badge>
            ))}
        </div>
        </div>
        {!student && (
          <div data-editor-control role='group' aria-label='How to select' className='grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1'>
            {[
              ['magic', 'Magic select', Wand2],
              ['box', 'Draw a box', BoxSelect],
            ].map(([value, label, Icon]) => (
              <button
                key={value}
                type='button'
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold ${
                  mode === value ? 'bg-white text-violet-700 shadow' : 'text-slate-600 hover:text-violet-700'
                }`}
              >
                <Icon className='h-4 w-4' aria-hidden='true' />
                {label}
              </button>
            ))}
          </div>
        )}
        <p data-editor-control className='shrink-0 text-xs text-slate-500'>{hint}</p>
        <div data-editor-control className='flex shrink-0 flex-wrap gap-2 [&>button]:min-h-11 [&>button]:flex-1'>
        {(!student || (selection && (chosen || chosenRegion) && canTake)) && (
          <button type='button' onClick={() => place(selection || defaultPictureCrop(pic), undefined, undefined, chosen?.id, chosenRegion?.id)} className={primary}>
            <Plus className='h-4 w-4' aria-hidden='true' />
            {selection ? 'Add selected part to board' : 'Add picture to board'}
          </button>
        )}
        {!student && selection && !offered && (
          <button type='button' onClick={() => onOffer({ pic: pic.id, crop: selection })} className={secondary}>
            <Gift className='h-4 w-4' aria-hidden='true' />
            Give to student
          </button>
        )}
        {offered?.taken && (
          <button type='button' onClick={() => onReset(offered.id)} className={secondary}>
            Let them take it again
          </button>
        )}
        {offered && (
          <button type='button' onClick={() => onWithdraw(offered.id)} className='text-xs font-semibold text-slate-500 hover:text-rose-600'>
            Take it back from your student
          </button>
        )}
        </div>
        {note && (
          <p data-editor-control role='status' className='text-xs font-semibold text-amber-700'>
            {note}
          </p>
        )}
        {ghost && (
          <div
            className='pointer-events-none fixed z-50 opacity-90 drop-shadow-xl'
            style={{ left: ghost.x - ghost.width / 2, top: ghost.y - (ghost.width * ghost.part.h) / ghost.part.w / 2 }}
          >
            <Ghost src={src} pic={pic} crop={ghost.part} width={ghost.width} />
          </div>
        )}
      </section>
    );
  }

  return (
    <section aria-label='Pictures' aria-busy={busy || (catalogVisible && libraryState.status === 'loading')} className={card}>
      <div className={`flex items-center justify-between ${browseOnly ? 'hidden' : ''}`}>
        <h2 className='text-sm font-bold text-slate-700'>Pictures</h2>
        {!student && (
          <span className='text-xs font-semibold text-slate-500'>
            {uploads}/{MAX_PICTURES} uploads
          </span>
        )}
      </div>
      {!student && layout === 'side' && onBrowse && (
        <button type='button' onClick={onBrowse} className={secondary}>
          <LayoutGrid className='h-4 w-4' aria-hidden='true' />
          Open picture library
        </button>
      )}
      {canAdd && !browseOnly && (
        <>
          <button
            type='button'
            disabled={busy || uploads >= MAX_PICTURES}
            onClick={() => fileRef.current?.click()}
            className={primary}
          >
            <Plus className='h-4 w-4' aria-hidden='true' />
            {busy ? 'Adding…' : 'Upload picture'}
          </button>
          <input
            ref={fileRef}
            type='file'
            accept='image/*'
            className='hidden'
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              addFile(file);
            }}
          />
          <p className='-mt-1 text-xs leading-relaxed text-slate-500'>Upload or paste to add straight to the board. Choose a part afterwards if you need it. Pictures stay for this session only.</p>
        </>
      )}
      {placedNote && (
        <div role='status' className='rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900'>
          <p className='flex items-start gap-2'><Check className='mt-0.5 h-4 w-4 shrink-0' aria-hidden='true' />{placedNote.text}</p>
          <button type='button' onClick={() => setOpenId(placedNote.id)} className='mt-1 min-h-10 rounded-lg px-2 text-xs font-bold underline underline-offset-2 hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700'>
            Choose a part of this picture
          </button>
        </div>
      )}
      {note && (
        <p data-editor-control role='status' className='text-xs font-semibold text-amber-700'>
          {note}
        </p>
      )}
      {catalogVisible && (
        <section aria-label='Picture library catalog' className='flex flex-col gap-1.5'>
          {libraryState.status === 'waiting' && <p role='status' className='rounded-xl bg-slate-100 px-3 py-3 text-sm text-slate-700'>Reconnecting to your lesson. The picture library will load automatically.</p>}
          {libraryState.status === 'loading' && <p role='status' className='rounded-xl bg-violet-50 px-3 py-3 text-sm font-semibold text-violet-800'>Loading picture library…</p>}
          {libraryState.status === 'error' && (
            <div role='alert' className='rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900'>
              <p>{libraryState.message || 'The picture library could not be loaded. Please try again.'}</p>
              <button type='button' onClick={onRetryLibrary} className='mt-2 inline-flex min-h-11 items-center rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-bold hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700'>Retry picture library</button>
            </div>
          )}
          <div className='flex items-center justify-between gap-2'>
            <h3 className='text-xs font-bold uppercase tracking-wide text-slate-500'>Library</h3>
            {onGiveAll && (
              <button
                type='button'
                disabled={busy || !catalogReady || !filteredLibrary.length || filteredLibrary.every(inSession)}
                onClick={giveAll}
                className='inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500'
              >
                <Gift className='h-3.5 w-3.5' aria-hidden='true' />
                {busy ? 'Adding…' : `Give all ${filteredLibrary.length} to student`}
              </button>
            )}
          </div>
          <label className='mt-1 flex min-w-0 flex-col gap-1'>
            <span className='text-xs font-semibold text-slate-600'>Find a card</span>
            <input
              ref={catalogSearch}
              type='search'
              aria-label='Search picture library'
              placeholder='Sound, keyword or instruction'
              value={catalogQuery}
              onChange={(event) => { setCatalogQuery(event.target.value); setLibraryNote(null); }}
              autoComplete='off'
              spellCheck={false}
              className='min-h-11 min-w-0 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500'
            />
          </label>
          <label className='flex min-w-0 flex-col gap-1'>
            <span className='text-xs font-semibold text-slate-600'>Collection</span>
            <select
              aria-label='Card collection'
              value={activeCollection}
              onChange={(event) => { setCatalogCollection(event.target.value); setLibraryNote(null); }}
              className='min-h-11 min-w-0 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500'
            >
              <option value=''>All collections</option>
              {collections.map((name) => <option key={name} value={name}>{collectionLabel(name)}</option>)}
            </select>
          </label>
          <div className='flex flex-wrap items-center justify-between gap-x-2'>
            {catalogReady && <p role='status' className='text-xs text-slate-500'>{filteredLibrary.length} of {library.length} cards</p>}
            {(catalogQuery || activeCollection) && <button type='button' onClick={() => { setCatalogQuery(''); setCatalogCollection(''); setLibraryNote(null); catalogSearch.current?.focus(); }} className='min-h-11 rounded-lg px-2 text-xs font-semibold text-violet-700 hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500'>Clear filters</button>}
          </div>
          {libraryNote && (
            <p role='status' className='text-xs font-semibold text-slate-600'>
              {libraryNote}
            </p>
          )}
          <ul aria-label='Library cards' className='grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3'>
            {filteredLibrary.map((item) => {
              const existing = pictures.find((picture) => picture.library === item.id);
              const showing = existing?.id === guidePic;
              return (
                <li key={item.id} data-library-card={item.id} className={`relative flex min-w-0 flex-col overflow-hidden rounded-xl border-2 bg-white ${showing ? 'border-sky-400' : existing?.id === peerPic ? 'border-violet-400 ring-2 ring-violet-200' : 'border-slate-200'}`}>
                  <LibraryPhoto card={item} loadImage={loadLibraryImage} disabled={busy || !catalogReady} onOpen={() => addCard(item, 'part')} />
                  <h3 className='border-t border-slate-100 px-2 py-2 text-sm font-bold text-slate-800'>{item.title}</h3>
                  <button type='button' disabled={busy || !catalogReady} aria-label={`Add ${item.title} to board`} onClick={() => addCard(item)} className='flex min-h-11 items-center justify-center gap-1.5 border-t border-violet-100 bg-violet-50 px-2 py-2 text-xs font-bold text-violet-800 hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-violet-500'>
                    <Plus className='h-4 w-4' aria-hidden='true' /> Add to board
                  </button>
                  {onGuide && <button type='button' disabled={busy || !catalogReady} aria-label={`Show ${item.title} to student`} aria-pressed={showing} onClick={() => addCard(item, 'show')} className={`flex min-h-11 items-center justify-center gap-1.5 border-t px-2 py-2 text-xs font-bold ${showing ? 'border-sky-500 bg-sky-500 text-white hover:bg-sky-600' : 'border-slate-100 text-sky-700 hover:bg-sky-50'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-sky-500`}>
                    <Eye className='h-4 w-4' aria-hidden='true' /> {showing ? 'Showing · Stop' : 'Show student'}
                  </button>}
                  <button type='button' disabled={busy || !catalogReady} aria-label={`Choose a part of ${item.title}`} onClick={() => addCard(item, 'part')} className='flex min-h-11 items-center justify-center gap-1.5 border-t border-slate-100 px-2 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-violet-500'>
                    <BoxSelect className='h-4 w-4' aria-hidden='true' /> Choose a part
                  </button>
                </li>
              );
            })}
          </ul>
          {catalogReady && !filteredLibrary.length && <p className='rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-600'>{library.length ? 'No cards match. Try another sound or keyword, or clear the filters.' : 'No library cards are available yet.'}</p>}
        </section>
      )}
      {notice && (
        <div
          role='status'
          className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-2 text-sm font-semibold ${
            notice.tone === 'sky' ? 'bg-sky-50 text-sky-800' : 'bg-violet-50 text-violet-800'
          }`}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${notice.tone === 'sky' ? 'bg-sky-500' : 'bg-violet-500'}`} aria-hidden='true' />
          {/* The text keeps room to read; in a narrow column the button wraps onto its own line. */}
          <span className='min-w-0 flex-1 basis-40'>{notice.text}</span>
          {notice.action && (
            <button type='button' onClick={notice.action.onClick} className='shrink-0 rounded-full bg-white px-2.5 py-0.5 text-xs font-bold shadow-sm ring-1 ring-current/20 hover:bg-slate-50'>
              {notice.action.label}
            </button>
          )}
        </div>
      )}
      {!student && sessionPictures.length > 0 && (
        <h3 className='mt-1 text-xs font-bold uppercase tracking-wide text-slate-500'>{catalogVisible ? 'Your session uploads' : 'In this session'} · {sessionPictures.length}</h3>
      )}
      {student && layout === 'side' && onBrowse && shown.length > 0 && (
        <button type='button' onClick={onBrowse} className={secondary}>
          <LayoutGrid className='h-4 w-4' aria-hidden='true' />
          Open picture library
        </button>
      )}
      {sessionPictures.length === 0 ? (catalogVisible ? null : (
        <p className='text-sm text-slate-500'>
          {student ? 'Your tutor hasn’t added any pictures yet.' : 'Pick a library picture or upload your own. It appears on the board, ready to move and resize.'}
        </p>
      )) : (
        <ul aria-label='Session pictures' className={layout === 'drawer' ? 'grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3' : '-mx-1 flex max-h-[45vh] flex-col gap-2 overflow-y-auto px-1'}>
          {sessionPictures.map((p, i) => (
            <li
              key={p.id}
              // shrink-0: in the scrolling column a card keeps its height; without it, many pictures squash flat.
              className={`relative flex shrink-0 flex-col overflow-hidden rounded-xl border-2 bg-white hover:border-violet-400 ${
                p.id === guidePic
                  ? 'border-sky-400'
                  : p.id === peerPic
                    ? 'border-violet-400 ring-4 ring-violet-300'
                    : 'border-slate-200'
              }`}
            >
              {p.id === guidePic && (
                // Only the outline pulses: the picture itself stays solid.
                <span aria-hidden='true' className='pointer-events-none absolute inset-0 z-10 rounded-[10px] ring-4 ring-inset ring-sky-300 motion-safe:animate-pulse' />
              )}
              {((student && p.id === guidePic) || (!student && p.id === peerPic)) && (
                <span
                  className={`pointer-events-none absolute left-2 top-2 z-10 rounded-full px-2 py-0.5 text-xs font-bold text-white shadow ${
                    student ? 'bg-sky-500' : 'bg-violet-600'
                  }`}
                >
                  {student ? 'Your tutor picked this' : 'Student is here'}
                </span>
              )}
              <button
                type='button'
                aria-label={student ? `Open ${p.title || `picture ${i + 1}`}` : `Choose a part of ${p.title || `picture ${i + 1}`}`}
                onClick={() => {
                  setNote(null);
                  setOpenId(p.id);
                }}
                className='block w-full'
              >
                <img
                  src={srcFor(p.id)}
                  alt=''
                  draggable={false}
                  loading='lazy'
                  decoding='async'
                  className={layout === 'drawer' ? 'block aspect-square h-auto w-full object-contain' : 'mx-auto block max-h-40 w-auto'}
                />
                {layout === 'drawer' && p.title && (
                  <span className='block truncate border-t border-slate-100 px-2 py-1.5 text-left text-sm font-bold text-slate-800'>{p.title}</span>
                )}
              </button>
              {!student && (
                <button
                  type='button'
                  aria-label={`Add ${p.title || `picture ${i + 1}`} to board`}
                  onClick={() => {
                    setNote(null);
                    placePicture(p, p.title || `Picture ${i + 1}`);
                  }}
                  className='flex min-h-11 items-center justify-center gap-2 border-t border-violet-100 bg-violet-50 px-3 py-2 text-sm font-bold text-violet-800 hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-violet-500'
                >
                  <Plus className='h-4 w-4' aria-hidden='true' />
                  Add to board
                </button>
              )}
              {onGuide && (
                <button
                  type='button'
                  aria-pressed={p.id === guidePic}
                  title={p.id === guidePic ? 'On your student’s screen now: click to stop' : 'Put this picture on your student’s screen'}
                  onClick={() => onGuide(p.id === guidePic ? null : p.id)}
                  className={`flex min-h-11 items-center justify-center gap-1.5 border-t px-2 py-2 text-sm font-bold ${
                    p.id === guidePic ? 'border-sky-500 bg-sky-500 text-white hover:bg-sky-600' : 'border-slate-100 text-sky-700 hover:bg-sky-50'
                  }`}
                >
                  <Eye className='h-4 w-4' aria-hidden='true' />
                  {p.id === guidePic ? 'Showing · Stop' : 'Show student'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAdd && !browseOnly && pictures.length > 0 && (
        <button
          type='button'
          onClick={() => {
            if (!armed) return setArmed(true);
            setArmed(false);
            onClear();
          }}
          onBlur={() => setArmed(false)}
          className={`rounded-full px-3 py-2 text-sm font-semibold ${armed ? 'bg-rose-600 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}
        >
          {armed ? 'Sure? Pictures and their pieces go' : 'Remove all pictures'}
        </button>
      )}
    </section>
  );
}

// The picture library slide-out: the session's pictures as a grid, and a big view of the one
// opened, sliding in over the board from the right (the whole screen on phones).
export function PictureDrawer({ id, open, onClose, title = 'Picture library', children }) {
  const closeButton = useRef(null);
  const dialog = useRef(null);
  const returnFocus = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    returnFocus.current = document.activeElement;
    closeButton.current?.focus({ preventScroll: true });
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === 'Tab') {
        const stops = [...dialog.current.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter((node) => node.getClientRects().length);
        const first = stops[0], last = stops.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      returnFocus.current?.focus({ preventScroll: true });
    };
  }, [open]);
  return (
    <div className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open} inert={open ? undefined : ''}>
      <div
        className={`absolute inset-0 bg-slate-900/20 transition-opacity duration-300 motion-reduce:transition-none ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        id={id}
        ref={dialog}
        role='dialog'
        aria-modal='true'
        aria-label={title}
        className={`absolute inset-y-0 right-0 flex w-full flex-col bg-slate-50 shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none sm:w-[min(52rem,92vw)] ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className='picture-library-header flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-4'>
          <span className='flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white'>
            <LayoutGrid className='h-5 w-5' aria-hidden='true' />
          </span>
          <h2 className='text-lg font-extrabold text-slate-900'>{title}</h2>
          <button
            ref={closeButton}
            type='button'
            onClick={onClose}
            className='ml-auto inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500'
          >
            <X className='h-4 w-4' aria-hidden='true' />
            Close
          </button>
        </header>
        <div className='min-h-0 flex-1 overflow-y-auto p-4'>{open && children}</div>
      </aside>
    </div>
  );
}
