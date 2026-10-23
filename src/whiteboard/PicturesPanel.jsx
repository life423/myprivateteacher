import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BoxSelect, Check, Eye, Gift, Image as ImageIcon, LayoutGrid, Plus, Wand2, X } from 'lucide-react';
import { regionAt } from './regions.js';
import { pictureRegions } from './pictures.js';
import { MAX_PICTURES, startingWidth } from '../../shared/pieces.js';

const DRAG_START = 6; // screen pixels a press moves before it becomes a drag
const card = 'flex flex-col gap-3 rounded-2xl bg-white p-3 shadow';
const primary =
  'flex items-center justify-center gap-2 rounded-full bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50';
const secondary =
  'flex items-center justify-center gap-2 rounded-full border border-violet-300 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50';

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
  onAddFromLibrary,
  onGiveAll,
  onBrowse,
  layout = 'side', // 'side' (the column or sheet) or 'drawer' (the picture library slide-out)
  browseOnly = false, // just the pictures: no adding, library or paste (the slide-out)
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
  const [mode, setMode] = useState('magic');
  const [hover, setHover] = useState(null);
  const [selection, setSelection] = useState(null);
  const [box, setBox] = useState(null);
  const [ghost, setGhost] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [armed, setArmed] = useState(false);
  const [libraryNote, setLibraryNote] = useState(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => {
    onOpenChangeRef.current?.(openId);
  }, [openId]);
  const fileRef = useRef(null);
  const svgRef = useRef(null);
  const press = useRef(null);

  const shown = pictures; // both people see every picture
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

  // Each picture's parts are found once, when the tutor first opens it.
  useEffect(() => {
    setRegions([]);
    setSelection(null);
    setHover(null);
    if (!src) return undefined;
    if (predefined) {
      setRegions(predefined); // first-party regions: no detection needed
      return undefined;
    }
    if (student) return undefined;
    const [w, h] = size.split('x').map(Number);
    let live = true;
    pictureRegions(src, { w, h }).then((found) => {
      if (live) setRegions(found);
    });
    return () => {
      live = false;
    };
  }, [src, size, student, predefinedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFile = async (file) => {
    if (!file || !canAdd) return;
    setBusy(true);
    setNote(null);
    const result = await onAddFile(file);
    setBusy(false);
    if (result?.error) setNote(result.error);
    else if (result?.id) setOpenId(result.id);
  };

  // Every library card joins the session, so the student can open any of them.
  const giveAll = async () => {
    if (!onGiveAll) return;
    setBusy(true);
    setLibraryNote(null);
    const result = await onGiveAll(library);
    setBusy(false);
    setLibraryNote(result?.error || (result?.added ? `${result.added} cards added. Your student can open them from Pictures.` : 'Every library card is already in this session.'));
  };

  // A card from the picture library joins the session and opens, ready for Magic Select.
  const addCard = async (card) => {
    if (!canAdd || !onAddFromLibrary) return;
    setBusy(true);
    setNote(null);
    const result = await onAddFromLibrary(card);
    setBusy(false);
    if (result?.error) setNote(result.error);
    else if (result?.id) setOpenId(result.id);
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

  // Puts a part on the board: where it was dropped, or in the middle of the board.
  const place = (crop, clientX, clientY, offerId, regionId) => {
    const w = startingWidth(crop);
    const h = (w * crop.h) / crop.w;
    let at = { x: 800, y: 580 };
    if (clientX !== undefined) {
      at = stageApi?.current?.pointAt(clientX, clientY);
      if (!at) return false;
    }
    onPlace({ offer: offerId, region: regionId, pic: pic.id, crop, x: at.x - w / 2, y: at.y - h / 2, w });
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
    if (predefined && mode === 'magic') hint = `Tap the ${predefined[0].label.toLowerCase()} to select it.`;
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
      <section aria-label='Pictures' className={card}>
        <button
          type='button'
          onClick={() => setOpenId(null)}
          className='flex items-center gap-1 self-start text-sm font-semibold text-violet-700 hover:underline'
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
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold ${
              guidePic === pic.id ? 'bg-sky-500 text-white hover:bg-sky-600' : 'bg-sky-50 text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100'
            }`}
          >
            <Eye className='h-4 w-4' aria-hidden='true' />
            {guidePic === pic.id ? 'Showing on your student’s screen · Stop' : 'Show student'}
          </button>
        )}
        <div className={`relative overflow-hidden rounded-xl border border-slate-200 bg-white ${layout === 'drawer' ? 'mx-auto w-fit' : ''}`}>
          <img
            src={src}
            alt=''
            draggable={false}
            className={layout === 'drawer' ? 'block h-auto max-h-[calc(100dvh-15rem)] w-auto max-w-full select-none' : 'block w-full select-none'}
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
        {!student && (
          <div role='group' aria-label='How to select' className='grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1'>
            {[
              ['magic', 'Magic select', Wand2],
              ['box', 'Draw a box', BoxSelect],
            ].map(([value, label, Icon]) => (
              <button
                key={value}
                type='button'
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold ${
                  mode === value ? 'bg-white text-violet-700 shadow' : 'text-slate-600 hover:text-violet-700'
                }`}
              >
                <Icon className='h-4 w-4' aria-hidden='true' />
                {label}
              </button>
            ))}
          </div>
        )}
        <p className='text-xs text-slate-500'>{hint}</p>
        {selection && (!student || ((chosen || chosenRegion) && canTake)) && (
          <button type='button' onClick={() => place(selection, undefined, undefined, chosen?.id, chosenRegion?.id)} className={primary}>
            Add to board
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
        {note && (
          <p role='status' className='text-xs font-semibold text-amber-700'>
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
    <section aria-label='Pictures' className={card}>
      <div className={`flex items-center justify-between ${browseOnly ? 'hidden' : ''}`}>
        <h2 className='text-sm font-bold text-slate-700'>Pictures</h2>
        {!student && (
          <span className='text-xs font-semibold text-slate-500'>
            {uploads}/{MAX_PICTURES} uploads
          </span>
        )}
      </div>
      {!student && layout === 'side' && onBrowse && shown.length > 0 && (
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
            {busy ? 'Adding…' : 'Add picture'}
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
          <p className='-mt-1 text-xs text-slate-500'>Or paste an image. Pictures are kept for this session only.</p>
        </>
      )}
      {note && (
        <p role='status' className='text-xs font-semibold text-amber-700'>
          {note}
        </p>
      )}
      {canAdd && !browseOnly && library.length > 0 && (
        <div className='flex flex-col gap-1.5'>
          <div className='flex items-center justify-between gap-2'>
            <h3 className='text-xs font-bold uppercase tracking-wide text-slate-500'>Library</h3>
            {library.length > 1 && onGiveAll && (
              <button
                type='button'
                disabled={busy || library.every(inSession)}
                onClick={giveAll}
                className='inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50'
              >
                <Gift className='h-3.5 w-3.5' aria-hidden='true' />
                {busy ? 'Adding…' : 'Give all to student'}
              </button>
            )}
          </div>
          {libraryNote && (
            <p role='status' className='text-xs font-semibold text-slate-600'>
              {libraryNote}
            </p>
          )}
          <ul className='flex flex-col gap-1.5'>
            {library.map((card) => (
              <li key={card.id}>
                <button
                  type='button'
                  disabled={busy || inSession(card)}
                  onClick={() => addCard(card)}
                  className='flex w-full items-center gap-3 rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-left hover:border-violet-400 disabled:opacity-50'
                >
                  <ImageIcon className='h-5 w-5 shrink-0 text-violet-600' aria-hidden='true' />
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate text-sm font-bold text-slate-800'>{card.title}</span>
                    <span className='block truncate text-xs text-slate-500'>
                      {[card.collection, (card.sounds || []).map((s) => `/${s}/`).join(' ')].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {inSession(card) ? (
                    <span className='inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700'>
                      <Check className='h-4 w-4' aria-hidden='true' />
                      In session
                    </span>
                  ) : (
                    <Plus className='h-4 w-4 shrink-0 text-violet-600' aria-hidden='true' />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
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
      {!student && layout === 'side' && shown.length > 0 && (
        <h3 className='mt-1 text-xs font-bold uppercase tracking-wide text-slate-500'>In this session · {shown.length}</h3>
      )}
      {student && layout === 'side' && onBrowse && shown.length > 0 && (
        <button type='button' onClick={onBrowse} className={secondary}>
          <LayoutGrid className='h-4 w-4' aria-hidden='true' />
          Open picture library
        </button>
      )}
      {shown.length === 0 ? (
        <p className='text-sm text-slate-500'>
          {student ? 'Your tutor hasn’t added any pictures yet.' : 'Add a worksheet or picture, then lift parts out of it with Magic Select.'}
        </p>
      ) : (
        <ul className={layout === 'drawer' ? 'grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3' : '-mx-1 flex max-h-[45vh] flex-col gap-2 overflow-y-auto px-1'}>
          {shown.map((p, i) => (
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
                aria-label={`Open ${p.title || `picture ${i + 1}`}`}
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
                  className={layout === 'drawer' ? 'block aspect-square h-auto w-full object-contain' : 'mx-auto block max-h-40 w-auto'}
                />
                {layout === 'drawer' && p.title && (
                  <span className='block truncate border-t border-slate-100 px-2 py-1.5 text-left text-sm font-bold text-slate-800'>{p.title}</span>
                )}
              </button>
              {onGuide && (
                <button
                  type='button'
                  aria-pressed={p.id === guidePic}
                  title={p.id === guidePic ? 'On your student’s screen now: click to stop' : 'Put this picture on your student’s screen'}
                  onClick={() => onGuide(p.id === guidePic ? null : p.id)}
                  className={`flex items-center justify-center gap-1.5 border-t px-2 py-2 text-sm font-bold ${
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
export function PictureDrawer({ open, onClose, title = 'Picture library', children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <div className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-slate-900/20 transition-opacity duration-300 motion-reduce:transition-none ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        role='dialog'
        aria-modal='true'
        aria-label={title}
        className={`absolute inset-y-0 right-0 flex w-full flex-col bg-slate-50 shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none sm:w-[min(52rem,92vw)] ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className='flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-4'>
          <span className='flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white'>
            <LayoutGrid className='h-5 w-5' aria-hidden='true' />
          </span>
          <h2 className='text-lg font-extrabold text-slate-900'>{title}</h2>
          <button
            type='button'
            onClick={onClose}
            className='ml-auto inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50'
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
