import { DEFAULT_LINES, isLineSize } from '../../shared/lines.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board, MAX_STROKE_NUMBERS } from './board.js';
import { BOX_COUNTS, MAX_TILES, cleanTileText } from '../../shared/tiles.js';
import { cleanBoxTap, cleanSoundBoxState } from '../../shared/soundBoxes.js';
import { MAX_PIECES, cleanCrop, clampPiece, pieceSize } from '../../shared/pieces.js';
import { findPicturePlacement, picturePlacement, picturePlacementObstacles, PICTURE_RESERVATION_MS } from './picturePlacement.js';
import { newPictureId, pictureUrl, shrinkPicture } from './pictures.js';
import { createPictureUploads, uploadPicture } from './pictureUploads.js';
import { createPageSession } from './pageSession.js';
import { MAX_PAGES, isPageId, cleanPageTitle } from '../../shared/pages.js';

const FLUSH_MS = 40; // stroke points go out about 25 times a second
const THROTTLE_MS = 33; // pointers and dragged tiles about 30 times a second
const CHUNK = 128; // numbers per message
const round1 = (n) => Math.round(n * 10) / 10;
const makeId = (prefix) => `${prefix[0]}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// Reconnect restoration uses exactly the retained bytes, including PDF page PNGs.
async function sendPicture(room, id, image) {
  try { return (await uploadPicture(room, id, image)).ok; }
  catch { return false; }
}

// Copies a card from the picture library into the room as one of its pictures. True once it's there.
async function sendFromLibrary(room, id, cardId) {
  try {
    const res = await fetch(`${pictureUrl(room.code, id)}/from-library/${cardId}`, {
      method: 'POST',
      headers: { 'X-Room-Key': room.key, ...(room.pageId !== undefined ? { 'X-Page-Id': room.pageId, 'X-Page-Epoch': String(room.pageEpoch) } : {}) },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// State that updates at most once per animation frame, for pointer-driven things.
export function useFrameState(initial) {
  const [value, setValue] = useState(initial);
  const next = useRef(initial);
  const frame = useRef(0);
  const pending = useRef(false);
  const mounted = useRef(false);
  const schedule = useCallback(() => {
    if (!mounted.current || frame.current || !pending.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (!mounted.current || !pending.current) return;
      pending.current = false;
      setValue(next.current);
    });
  }, []);
  useEffect(() => {
    mounted.current = true;
    // StrictMode and Fast Refresh replay effects while retaining refs. A canceled
    // frame must not block future updates, and its latest value still needs paint.
    schedule();
    return () => {
      mounted.current = false;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [schedule]);
  const set = useCallback((v) => {
    next.current = v;
    pending.current = true;
    schedule();
  }, [schedule]);
  return [value, set];
}

// Keeps a local copy of the shared board (strokes, tiles and settings) in step with the
// server, and sends this person's strokes in small batches and their pointer and tile
// drags throttled.
export function useWhiteboard(role, send) {
  const [board] = useState(() => new Board());
  const [, setVersion] = useState(0);
  const [settings, setSettings] = useState({ strip: true, ...cleanSoundBoxState(), lines: DEFAULT_LINES });
  const [, setTileFrame] = useFrameState(0);
  const sendRef = useRef(send);
  sendRef.current = send;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const active = useRef(null);
  const flushTimer = useRef(null);
  const channels = useRef({});
  const tiles = useRef(new Map());
  const pieces = useRef(new Map());
  const pendingPieces = useRef(new Map());
  const lastPlacement = useRef(null);
  const pictures = useRef(new Map()); // id -> { id, w, h }
  const libraryRequests = useRef(new Map()); // one in-flight copy per room/card
  const retainedRequests = useRef(new Map());
  const retentionGeneration = useRef(0);
  const libraryGeneration = useRef(0); // discard late copies after reset/reconnect
  const kept = useRef(new Map()); // the tutor's copies of pictures they added, in case the server restarts
  const offers = useRef(new Map()); // parts the tutor gave the student, each theirs to take once
  const pageSession = useRef(null);
  const [pagePending, setPagePending] = useState(false);
  const [pageError, setPageError] = useState(null);
  const pageCommandTimer = useRef(null);
  const pendingPageCommand = useRef(false);
  const pageCommandDeadline = useRef(0);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const renderTiles = useCallback(() => setTileFrame(performance.now()), [setTileFrame]);

  const pictureUploads = useRef(null);
  if (!pageSession.current) pageSession.current = createPageSession({
    capture: () => ({
      strokes: board.strokes.map(stroke => ({ ...stroke, pts: [...stroke.pts] })),
      tiles: [...tiles.current.values()].map(tile => ({ ...tile, heldBy: null })),
      pieces: [...pieces.current.values()].map(piece => ({ ...piece, crop: { ...piece.crop }, heldBy: null })),
      offers: [...offers.current.values()].map(offer => ({ ...offer, crop: { ...offer.crop } })),
      ...settingsRef.current,
    }),
    boundary: () => {
      // Never flush old ink or deferred movement into a newly active page.
      active.current = null;
      clearTimeout(flushTimer.current); flushTimer.current = null;
      for (const channel of Object.values(channels.current)) {
        clearTimeout(channel.timer); channel.timer = null; channel.message = null;
      }
      pendingPieces.current.clear(); lastPlacement.current = null;
      pictureUploads.current?.invalidate();
      retentionGeneration.current++;
      for (const request of retainedRequests.current.values()) request.controller.abort();
      retainedRequests.current.clear();
      libraryGeneration.current++; libraryRequests.current.clear();
    },
    changed: bump,
  });
  const session = pageSession.current;
  const actionScope = session.scope();
  const actionVersion = session.version;
  const pageScope = useCallback(() => pageSession.current.scope(), []);
  const scopeMessage = useCallback((message, origin) => pageSession.current.scopeMessage(message, origin), []);
  const sendPageMessage = useCallback((message, origin) => {
    const scoped = pageSession.current.scopeMessage(message, origin);
    if (!scoped) return false;
    if (message.t === 'game') pageSession.current.rememberGame(message.game, origin);
    return sendRef.current(scoped) !== false;
  }, []);
  const finishPageCommand = useCallback((error = null) => {
    clearTimeout(pageCommandTimer.current); pageCommandTimer.current = null;
    pendingPageCommand.current = false; pageCommandDeadline.current = 0; setPagePending(false); setPageError(error);
  }, []);
  const acceptMessage = useCallback((message) => pageSession.current.accept(message), []);
  const writeSettings = (value) => {
    const next = typeof value === 'function' ? value(settingsRef.current) : value;
    settingsRef.current = next; setSettings(next);
  };
  if (!pictureUploads.current) pictureUploads.current = createPictureUploads({
    role, getPictures: () => pictures.current, prepare: shrinkPicture, createId: newPictureId,
    onAdded: (picture, copy) => {
      pageSession.current.notePicture(picture.id);
      kept.current.set(picture.id, copy);
      pictures.current.set(picture.id, picture);
      renderTiles();
    },
  });
  const cancelPictureWrites = useCallback(() => {
    pictureUploads.current.invalidate();
    retentionGeneration.current++;
    for (const request of retainedRequests.current.values()) request.controller.abort();
    retainedRequests.current.clear();
    libraryGeneration.current++;
    libraryRequests.current.clear();
    pageSession.current.invalidateRestore();
    bump();
  }, [bump]);

  // Strokes
  const flush = useCallback(() => {
    clearTimeout(flushTimer.current);
    flushTimer.current = null;
    const current = active.current;
    if (!current || !current.pending.length) return;
    for (let i = 0; i < current.pending.length; i += CHUNK) {
      sendPageMessage({ t: 'm', id: current.id, pts: current.pending.slice(i, i + CHUNK) }, current.scope);
    }
    current.pending = [];
  }, []);

  const end = useCallback(() => {
    const current = active.current;
    if (!current) return;
    flush();
    active.current = null;
    board.finish(current.id);
    sendPageMessage({ t: 'e', id: current.id }, current.scope);
  }, [board, flush]);

  useEffect(() => () => {
    // Effect replay retains these refs. Finish pending ink, then discard obsolete pointer
    // movement and reset timer handles so the next gesture can schedule fresh transport.
    end();
    clearTimeout(flushTimer.current);
    flushTimer.current = null;
    for (const channel of Object.values(channels.current)) {
      clearTimeout(channel.timer);
      channel.timer = null;
      channel.message = null;
    }
    pictureUploads.current.invalidate();
    retentionGeneration.current++;
    for (const request of retainedRequests.current.values()) request.controller.abort();
    retainedRequests.current.clear();
    libraryGeneration.current++; libraryRequests.current.clear();
    pageSession.current.invalidateRestore();
  }, [end]);

  const start = useCallback(
    (tool, { x, y }) => {
      if (!pageSession.current.ready || !pageSession.current.current(actionScope)) return;
      if (active.current) end();
      const id = makeId(role);
      const pts = [round1(x), round1(y)];
      active.current = { id, scope: actionScope, pending: [], lastX: pts[0], lastY: pts[1], size: 2 };
      board.add({ id, by: role, tool, pts });
      sendPageMessage({ t: 's', id, tool, x: pts[0], y: pts[1] }, actionScope);
      bump();
    },
    [board, bump, end, role, actionVersion],
  );

  const move = useCallback(
    (points) => {
      const current = active.current;
      if (!current) return;
      const fresh = [];
      for (const { x, y } of points) {
        const rx = round1(x);
        const ry = round1(y);
        if (Math.abs(rx - current.lastX) + Math.abs(ry - current.lastY) < 1) continue;
        current.lastX = rx;
        current.lastY = ry;
        fresh.push(rx, ry);
      }
      if (!fresh.length) return;
      if (current.size + fresh.length > MAX_STROKE_NUMBERS) {
        end();
        return;
      }
      current.size += fresh.length;
      board.append(current.id, fresh);
      current.pending.push(...fresh);
      if (!flushTimer.current) flushTimer.current = setTimeout(flush, FLUSH_MS);
    },
    [board, end, flush],
  );

  const undo = useCallback(() => sendPageMessage({ t: 'undo' }, actionScope), [actionVersion]);

  // At most one message per channel every THROTTLE_MS; the newest one always wins.
  const sendThrottled = useCallback((name, message) => {
    const channel = channels.current[name] || (channels.current[name] = { timer: null, last: 0, message: null });
    channel.message = message;
    channel.scope = message.pageId !== undefined ? { pageId: message.pageId, pageEpoch: message.pageEpoch } : pageSession.current.scope();
    if (channel.timer) return;
    channel.timer = setTimeout(
      () => {
        channel.timer = null;
        channel.last = performance.now();
        const message = channel.message;
        channel.message = null;
        if (message) sendPageMessage(message, channel.scope);
      },
      Math.max(0, THROTTLE_MS - (performance.now() - channel.last)),
    );
  }, []);

  const cancelThrottled = useCallback((name) => {
    const channel = channels.current[name];
    if (!channel) return;
    clearTimeout(channel.timer);
    channel.timer = null;
    channel.message = null;
  }, []);

  const sendPointer = useCallback((message) => sendThrottled('p', message), [sendThrottled]);

  // Tiles. Dragging is shown here straight away; the server confirms the final spot on drop.
  const tileActions = useMemo(
    () => {
      const allowed = () => pageSession.current.ready && pageSession.current.current(actionScope);
      const sendBound = message => sendPageMessage(message, actionScope);
      return {
        grab(id) {
          if (!allowed()) return null;
          const tile = tiles.current.get(id);
          if (!tile) return;
          tile.heldBy = role;
          tile.z = Math.max(0, ...[...tiles.current.values()].map((t) => t.z)) + 1;
          renderTiles();
          sendBound({ t: 'tile:grab', id });
        },
        move(id, x, y) {
          if (!allowed()) return null;
          const tile = tiles.current.get(id);
          if (!tile) return;
          tile.x = x;
          tile.y = y;
          renderTiles();
          sendThrottled('tile', { t: 'tile:move', id, x, y });
        },
        drop(id, x, y) {
          if (!allowed()) return null;
          cancelThrottled('tile');
          const tile = tiles.current.get(id);
          if (tile) tile.heldBy = null;
          renderTiles();
          sendBound({ t: 'tile:drop', id, x, y });
        },
        remove(id) {
          if (!allowed()) return null;
          if (role === 'tutor') sendBound({ t: 'tile:delete', id });
        },
        duplicate(id) {
          if (!allowed()) return null;
          if (role !== 'tutor' || !tiles.current.has(id) || tiles.current.size >= MAX_TILES) return null;
          const copyId = makeId('tile');
          sendBound({ t: 'tile:duplicate', id, copyId });
          return copyId;
        },
      };
    },
    [role, renderTiles, sendThrottled, cancelThrottled, actionVersion],
  );


  // Picture pieces work like tiles: shown straight away here, confirmed by the server on drop.
  const pieceActions = useMemo(
    () => {
      const allowed = () => pageSession.current.ready && pageSession.current.current(actionScope);
      const sendBound = message => sendPageMessage(message, actionScope);
      return {
        add({ offer, region, pic, crop, x, y, w, automatic = false, centre, bounds }) {
          if (!allowed()) return null;
          const obstacles = picturePlacementObstacles([...pieces.current.values()], pendingPieces.current);
          if (obstacles.length >= MAX_PIECES) {
            lastPlacement.current = { error: `Up to ${MAX_PIECES} pictures or parts fit on this board. Remove one before adding another.` };
            return null;
          }
          const picture = pictures.current.get(pic);
          const chosen = cleanCrop(crop, picture);
          if (!chosen) {
            lastPlacement.current = { error: 'This picture is not available in the lesson yet. Please try again.' };
            return null;
          }
          const size = pieceSize(chosen, w);
          const placed = automatic
            ? picturePlacement(picture, centre, { pieces: obstacles, bounds, crop: chosen })
            : clampPiece(size, x, y);
          if (!placed) return null;
          const id = makeId('piece');
          const piece = { id, offer, region, pic, crop: chosen, x: placed.x, y: placed.y, w: automatic ? placed.w : size.w };
          const reserved = { ...piece, h: piece.w * chosen.h / chosen.w };
          pendingPieces.current.set(id, { piece: reserved, expiresAt: Date.now() + PICTURE_RESERVATION_MS });
          lastPlacement.current = placed.placement || { crowded: false, visible: true, overlaps: 0 };
          sendBound({ t: 'piece:add', piece });
          return id;
        },
        duplicate(id, { bounds, centre } = {}) {
          if (!allowed()) return null;
          const p = pieces.current.get(id);
          if (!p) return null;
          const obstacles = picturePlacementObstacles([...pieces.current.values()], pendingPieces.current);
          if (obstacles.length >= MAX_PIECES) {
            lastPlacement.current = { error: `Up to ${MAX_PIECES} pictures or parts fit on this board. Remove one before adding another.` };
            return null;
          }
          const size = pieceSize(p.crop, p.w);
          const at = findPicturePlacement(size, centre || { x: p.x + p.w / 2, y: p.y + p.h / 2 }, { pieces: obstacles, bounds });
          if (!at) return null;
          const copyId = makeId('piece');
          const piece = { id: copyId, pic: p.pic, crop: p.crop, x: at.x, y: at.y, w: p.w };
          pendingPieces.current.set(copyId, { piece: { ...piece, h: size.h }, expiresAt: Date.now() + PICTURE_RESERVATION_MS });
          lastPlacement.current = at;
          sendBound({ t: 'piece:add', piece });
          return copyId;
        },
        placementStatus() { return lastPlacement.current; },
        grab(id) {
          if (!allowed()) return null;
          const p = pieces.current.get(id);
          if (!p) return;
          p.heldBy = role;
          renderTiles();
          sendBound({ t: 'piece:grab', id });
        },
        move(id, x, y, w) {
          if (!allowed()) return null;
          const p = pieces.current.get(id);
          if (!p) return;
          const width = w ?? p.w;
          Object.assign(p, { x, y, w: width, h: (width * p.crop.h) / p.crop.w });
          renderTiles();
          sendThrottled('piece', { t: 'piece:move', id, x, y, w });
        },
        drop(id, x, y, w) {
          if (!allowed()) return null;
          cancelThrottled('piece');
          const p = pieces.current.get(id);
          if (p) p.heldBy = null;
          renderTiles();
          sendBound({ t: 'piece:drop', id, x, y, w });
        },
        remove(id) {
          if (!allowed()) return null;
          sendBound({ t: 'piece:delete', id });
        },
        crop(id, crop) {
          if (!allowed()) return null;
          const piece = pieces.current.get(id);
          const chosen = piece && cleanCrop(crop, pictures.current.get(piece.pic));
          if (role !== 'tutor' || !chosen || (piece.heldBy && piece.heldBy !== 'tutor')) return false;
          sendBound({ t: 'piece:crop', id, crop: chosen });
          return true;
        },
        layer(id, direction) {
          if (!allowed()) return null;
          if (role === 'tutor' && (direction === 'front' || direction === 'back')) {
            sendBound({ t: 'piece:layer', id, direction });
          }
        },
      };
    },
    [role, renderTiles, sendThrottled, cancelThrottled, actionVersion],
  );


  // PDF pages are already rendered and encoded, so retain their resolution and
  // format. Ordinary images still use the same bounded shrink path.
  const addPicture = useCallback((file, room, options) => {
    if (!pageSession.current.ready || !pageSession.current.current(actionScope)) return Promise.resolve({ cancelled: true, error: 'The board changed. Try adding the picture again.' });
    return pictureUploads.current.addFile(file, room && { ...room, ...actionScope }, options);
  }, [actionVersion]);
  const addPreparedPicture = useCallback((image, room, options) => {
    if (!pageSession.current.ready || !pageSession.current.current(actionScope)) return Promise.resolve({ cancelled: true, error: 'The board changed. Try importing the page again.' });
    return pictureUploads.current.addPrepared(image, room && { ...room, ...actionScope }, options);
  }, [actionVersion]);

  // Tutor only: which parts the student may take.
  const offerActions = useMemo(
    () => {
      const allowed = () => pageSession.current.ready && pageSession.current.current(actionScope);
      const sendBound = message => sendPageMessage(message, actionScope);
      return {
        give({ pic, crop }) {
          if (!allowed()) return null;
          sendBound({ t: 'offer:add', offer: { id: makeId('offer'), pic, crop } });
        },
        withdraw(id) {
          if (!allowed()) return null;
          sendBound({ t: 'offer:remove', id });
        },
        reset(id) {
          if (!allowed()) return null;
          sendBound({ t: 'offer:reset', id });
        },
      };
    },
    [actionVersion],
  );


  // Concurrent face additions share one source image, while each placement remains
  // a separate board piece. Previewing the catalog never calls this function.
  const addLibraryCard = useCallback((card, room) => {
    if (!pageSession.current.ready || !pageSession.current.current(actionScope)) return Promise.resolve({ cancelled: true, error: 'The board changed. Try adding the card again.' });
    if (!room?.code || !room?.key) return Promise.resolve({ error: 'Not connected yet. Try again in a moment.' });
    const destination = { ...room, ...actionScope };
    const here = [...pictures.current.values()].find((p) => p.library === card.id);
    if (here && pageSession.current.hasPicture(here.id)) return Promise.resolve({ ...here, existing: true });
    const requestKey = `${room.code}:${room.key}:${card.id}`;
    if (libraryRequests.current.has(requestKey)) return libraryRequests.current.get(requestKey);
    const generation = libraryGeneration.current;
    const request = (async () => {
      const id = here?.id || newPictureId();
      if (!(await sendFromLibrary(destination, id, card.id))) return { error: 'That card couldn’t be added. Try again.' };
      if (generation !== libraryGeneration.current) return { error: 'The lesson changed. Please try adding the picture again.' };
      pageSession.current.notePicture(id);
      kept.current.set(id, { library: card.id });
      const picture = { id, w: card.w, h: card.h, regions: card.regions || [], library: card.id, title: card.title };
      pictures.current.set(id, picture);
      renderTiles();
      return picture;
    })().finally(() => {
      if (libraryRequests.current.get(requestKey) === request) libraryRequests.current.delete(requestKey);
    });
    libraryRequests.current.set(requestKey, request);
    return request;
  }, [renderTiles, actionVersion]);

  // A full browser refresh loses Blob copies, even though the server still has
  // the deck. Hydrate its global source registry before a later server restart.
  const retainPictures = useCallback(async (room) => {
    if (role !== 'tutor' || !room?.code || !room?.key) return false;
    const generation = retentionGeneration.current;
    const work = [];
    for (const picture of pictures.current.values()) {
      if (kept.current.has(picture.id)) continue;
      if (picture.library) { kept.current.set(picture.id, { library: picture.library }); continue; }
      const key = `${room.code}:${room.key}:${generation}:${picture.id}`;
      let request = retainedRequests.current.get(key);
      if (!request) {
        const controller = new AbortController();
        request = { controller };
        request.promise = Promise.resolve().then(async () => {
          try {
            const response = await fetch(pictureUrl(room.code, picture.id), { headers: { 'X-Room-Key': room.key }, signal: controller.signal });
            if (!response.ok) return false;
            const blob = await response.blob();
            if (controller.signal.aborted || generation !== retentionGeneration.current || !pictures.current.has(picture.id)) return false;
            kept.current.set(picture.id, { blob, w: picture.w, h: picture.h, material: picture.material, title: picture.title });
            return true;
          } catch { return false; }
          finally { if (retainedRequests.current.get(key) === request) retainedRequests.current.delete(key); }
        });
        retainedRequests.current.set(key, request);
      }
      work.push(request.promise);
    }
    return (await Promise.all(work)).every(Boolean);
  }, [role]);

  // Tutor only: every card of a library list into this session, skipping those already here.
  const addLibraryCards = useCallback(
    async (cards, room) => {
      let added = 0;
      for (const card of cards) {
        const result = await addLibraryCard(card, room);
        if (result.error) return { added, error: result.error };
        if (!result.existing) added += 1;
      }
      return { added };
    },
    [addLibraryCard],
  );

  const clearPictures = useCallback(() => {
    if (!pageSession.current.ready || !pageSession.current.current(actionScope)) return false;
    cancelPictureWrites();
    sendPageMessage({ t: 'pieces:clear' }, actionScope);
  }, [cancelPictureWrites, actionVersion]);

  // Tutor controls. Spaces separate tiles, so sh stays one tile and c a t makes three.
  const addTiles = useCallback((input) => {
    if (!pageSession.current.ready || !pageSession.current.current(actionScope)) return { added: 0, skipped: 0, full: false };
    const tokens = String(input)
      .split(' ')
      .map((s) => s.trim())
      .filter(Boolean);
    const good = tokens.map(cleanTileText).filter(Boolean);
    const sending = good.slice(0, Math.max(0, MAX_TILES - tiles.current.size));
    if (sending.length) sendPageMessage({ t: 'tile:add', tiles: sending.map((text) => ({ id: makeId('tile'), text })) }, actionScope);
    return { added: sending.length, skipped: tokens.length - good.length, full: good.length > sending.length };
  }, [actionVersion]);

  const editTile = useCallback((id, input) => {
    const text = cleanTileText(input);
    if (!text || !tiles.current.has(id)) return false;
    if (!sendPageMessage({ t: 'tile:edit', id, text }, actionScope)) return false;
    return true;
  }, [actionVersion]);

  const resetTiles = useCallback(() => sendPageMessage({ t: 'tiles:reset' }, actionScope), [actionVersion]);
  const clearTiles = useCallback(() => sendPageMessage({ t: 'tiles:clear' }, actionScope), [actionVersion]);
  const setStrip = useCallback((on) => sendPageMessage({ t: 'strip:set', on }, actionScope), [actionVersion]);
  const setBoxes = useCallback((count) => {
    if (role !== 'tutor' || !BOX_COUNTS.includes(count)) return false;
    return sendPageMessage({ t: 'boxes:set', count }, actionScope);
  }, [role, actionVersion]);
  const toggleSoundBox = useCallback((index, pressed) => {
    const { boxes, boxTaps, boxEpoch } = settingsRef.current;
    const tap = cleanBoxTap({ index, pressed: pressed === undefined ? !boxTaps.includes(index) : pressed, epoch: boxEpoch }, boxes, boxEpoch);
    if (!tap) return false;
    return sendPageMessage({ t: 'boxes:tap', ...tap }, actionScope);
  }, [actionVersion]);
  const resetSoundBoxes = useCallback(() => {
    if (role !== 'tutor') return false;
    return sendPageMessage({ t: 'boxes:reset' }, actionScope);
  }, [role, actionVersion]);
  const setLines = useCallback((size) => sendPageMessage({ t: 'lines:set', size }, actionScope), [actionVersion]);

  // After a server restart, the tutor hands back the board they still have: strokes,
  // tiles (in stacking order) and settings.
  const restore = useCallback(async (tools, room) => {
    if (role !== 'tutor' || !room?.code || !room?.key) return false;
    const snapshot = pageSession.current.restoreSnapshot();
    if (!snapshot.complete) { setPageError('Some board pages have not finished loading. Reconnect to load the complete lesson before restoring.'); return false; }
    for (const picture of pictures.current.values()) if (picture.library && !kept.current.has(picture.id)) kept.current.set(picture.id, { library: picture.library });
    const required = new Set(snapshot.boards.flatMap(page => [...(page.pictureIds || []), ...(page.pieces || []).map(piece => piece.pic), ...(page.offers || []).map(offer => offer.pic)]));
    if ([...required].some(id => !kept.current.has(id))) { setPageError('Some lesson pictures have not finished loading. Keep this lesson open and retry restoring.'); return false; }
    const retained = [...kept.current.entries()].filter(([id]) => required.has(id));
    setPageError(null);
    const destination = { ...room, ...pageSession.current.scope() };
    const restoreId = makeId('restore');
    const current = () => pageSession.current.restoreCurrent(snapshot.generation);
    sendRef.current({ t: 'pages:restore', pages: snapshot.pages, activePageId: snapshot.activePageId, restoreId });
    for (const [id, copy] of retained) {
      if (!current()) return false;
      const uploaded = await (copy.library ? sendFromLibrary(destination, id, copy.library) : sendPicture(destination, id, copy));
      if (!current()) return false;
      if (!uploaded) { setPageError('The lesson pictures could not be restored. Check the connection and retry restoring.'); return false; }
    }
    for (const page of snapshot.boards) {
      if (!current()) return false;
      const { id: pageId, strokes = [], tiles: pageTiles = [], pieces: pagePieces = [], offers: pageOffers = [], ...settings } = page;
      sendRef.current({ t: 'page:restore', id: pageId, restoreId, ...settings });
      for (const offer of pageOffers) sendRef.current({ t: 'rs-offer', offer, pageId, restoreId });
      for (const stroke of strokes) sendRef.current({ t: 'rs', id: stroke.id, by: stroke.by, tool: stroke.tool, pts: stroke.pts, pageId, restoreId });
      for (const tile of [...pageTiles].sort((a, b) => a.z - b.z)) sendRef.current({ t: 'rs-tile', tile, pageId, restoreId });
      for (const piece of [...pagePieces].sort((a, b) => a.z - b.z)) sendRef.current({ t: 'rs-piece', piece, pageId, restoreId });
    }
    if (!current()) return false;
    sendRef.current({ t: 'restored', restoreId, activePageId: snapshot.activePageId, tools });
    return true;
  }, [role]);

  const disconnect = useCallback(() => {
    pageSession.current.disconnect();
    finishPageCommand();
  }, [finishPageCommand]);
  const pageActions = useMemo(() => {
    const command = (t, extra = {}) => {
      if (role !== 'tutor' || pendingPageCommand.current || !pageSession.current.ready || !pageSession.current.current(actionScope)) return false;
      if ((t === 'page:add' || t === 'page:duplicate') && pageSession.current.pages.length >= MAX_PAGES) { setPageError(`A lesson can have up to ${MAX_PAGES} boards.`); return false; }
      // Commit the last old-page sample before the ordered switch command.
      end();
      for (const channel of Object.values(channels.current)) {
        clearTimeout(channel.timer); channel.timer = null;
        const message = channel.message; channel.message = null;
        if (message) sendPageMessage(message, channel.scope);
      }
      const sent = sendPageMessage({ t, ...extra }, actionScope);
      if (!sent) { setPageError('Reconnect before changing board pages.'); return false; }
      pendingPageCommand.current = true; setPagePending(true); setPageError(null);
      clearTimeout(pageCommandTimer.current);
      pageCommandDeadline.current = Date.now() + 8000;
      pageCommandTimer.current = setTimeout(() => finishPageCommand('The board change was not confirmed. Try again.'), 8000);
      return true;
    };
    return {
      add: () => command('page:add'),
      duplicate: (id = pageSession.current.pageId) => isPageId(id) && command('page:duplicate', { id }),
      switch: id => isPageId(id) && command('page:switch', { id }),
      rename: (id, title) => isPageId(id) && command('page:rename', { id, title: cleanPageTitle(title) }),
      remove: id => isPageId(id) && command('page:delete', { id }),
    };
  }, [role, actionVersion, sendPageMessage, finishPageCommand, end]);
  useEffect(() => {
    if (pendingPageCommand.current) pageCommandTimer.current = setTimeout(() => finishPageCommand('The board change was not confirmed. Try again.'), Math.max(0, pageCommandDeadline.current - Date.now()));
    return () => { clearTimeout(pageCommandTimer.current); pageCommandTimer.current = null; };
  }, [finishPageCommand]);

  // Messages from the server. Returns true when the message was about the board.
  const handle = useCallback(
    (msg) => {
      if (!acceptMessage(msg)) return true;
      const putTile = (tile) => {
        if (tile && tile.id) tiles.current.set(tile.id, tile);
      };
      switch (msg.t) {
        case 'room': return false;
        case 'pages': finishPageCommand(); return true;
        case 'page:cache': if (role === 'tutor') pageSession.current.cacheBoard(msg.board); return true;
        case 'error':
          if (typeof msg.reason === 'string' && msg.reason.startsWith('page-')) { finishPageCommand(msg.message || 'This board change could not be completed. Try again.'); return true; }
          return false;
        case 'game': pageSession.current.rememberGame(msg.game); return true;
        case 'board':
          finishPageCommand();
          cancelPictureWrites();
          active.current = null;
          pendingPieces.current.clear();
          lastPlacement.current = null;
          board.replace(Array.isArray(msg.strokes) ? msg.strokes : []);
          tiles.current = new Map((Array.isArray(msg.tiles) ? msg.tiles : []).map((t) => [t.id, t]));
          pictures.current = new Map((Array.isArray(msg.pictures) ? msg.pictures : []).map((p) => [p.id, p]));
          for (const id of kept.current.keys()) if (!pictures.current.has(id)) kept.current.delete(id);
          pieces.current = new Map((Array.isArray(msg.pieces) ? msg.pieces : []).map((p) => [p.id, p]));
          offers.current = new Map((Array.isArray(msg.offers) ? msg.offers : []).map((o) => [o.id, o]));
          writeSettings({
            strip: msg.strip !== false,
            ...cleanSoundBoxState(msg),
            lines: isLineSize(msg.lines) ? msg.lines : DEFAULT_LINES,
          });
          pageSession.current.applyBoard(msg);
          renderTiles();
          bump();
          return true;
        case 's':
          board.add({ id: msg.id, by: msg.by, tool: msg.tool, pts: [msg.x, msg.y], seq: msg.seq });
          return true;
        case 'm':
          board.append(msg.id, msg.pts);
          return true;
        case 'e':
          board.finish(msg.id);
          return true;
        case 'ack':
          board.setSeq(msg.id, msg.seq);
          return true;
        case 'undo':
          if (active.current?.id === msg.id) active.current = null;
          board.remove(msg.id);
          bump();
          return true;
        case 'tile:add':
          for (const tile of msg.tiles || []) putTile(tile);
          // Creation is a discrete server-confirmed change, not pointer motion.
          // Render it immediately; tile movement remains animation-frame batched.
          bump();
          return true;
        case 'tile:grab': {
          const tile = tiles.current.get(msg.id);
          if (tile) Object.assign(tile, { heldBy: msg.by, z: msg.z });
          renderTiles();
          return true;
        }
        case 'tile:move': {
          const tile = tiles.current.get(msg.id);
          if (tile) Object.assign(tile, { x: msg.x, y: msg.y });
          renderTiles();
          return true;
        }
        case 'tile:drop':
        case 'tile:edit':
        case 'tile:denied':
          putTile(msg.tile);
          renderTiles();
          return true;
        case 'tile:delete':
          tiles.current.delete(msg.id);
          renderTiles();
          return true;
        case 'tiles':
          tiles.current = new Map((msg.tiles || []).map((t) => [t.id, t]));
          renderTiles();
          return true;
        case 'pic:add':
          if (msg.pic?.id) {
            pageSession.current.notePicture(msg.pic.id);
            pictures.current.set(msg.pic.id, msg.pic);
            pictureUploads.current.acceptPicture(msg.pic);
          }
          renderTiles();
          return true;
        case 'piece:add':
        case 'piece:drop':
        case 'piece:denied':
          if (msg.piece?.id) pendingPieces.current.delete(msg.piece.id);
          if (msg.piece?.id) pieces.current.set(msg.piece.id, msg.piece);
          renderTiles();
          return true;
        case 'piece:grab': {
          const p = pieces.current.get(msg.id);
          if (p) Object.assign(p, { heldBy: msg.by, z: msg.z });
          renderTiles();
          return true;
        }
        case 'piece:layer':
          for (const layer of msg.layers || []) {
            const p = pieces.current.get(layer.id);
            if (p && Number.isFinite(layer.z)) p.z = layer.z;
          }
          renderTiles();
          return true;
        case 'piece:move': {
          const p = pieces.current.get(msg.id);
          if (p) Object.assign(p, { x: msg.x, y: msg.y, w: msg.w, h: msg.h });
          renderTiles();
          return true;
        }
        case 'offer':
          if (msg.offer?.id) offers.current.set(msg.offer.id, msg.offer);
          renderTiles();
          return true;
        case 'offer:remove':
          offers.current.delete(msg.id);
          renderTiles();
          return true;
        case 'piece:delete':
          pendingPieces.current.delete(msg.id);
          pieces.current.delete(msg.id);
          renderTiles();
          return true;
        case 'pieces':
          cancelPictureWrites();
          pendingPieces.current.clear();
          lastPlacement.current = null;
          pieces.current = new Map((msg.pieces || []).map((p) => [p.id, p]));
          pictures.current = new Map((msg.pictures || []).map((p) => [p.id, p]));
          offers.current = new Map((msg.offers || []).map((o) => [o.id, o]));
          if (Array.isArray(msg.pictureIds)) pageSession.current.setPictureIds(msg.pictureIds);
          for (const id of kept.current.keys()) if (!pictures.current.has(id)) kept.current.delete(id);
          renderTiles();
          return true;
        case 'strip:set':
          writeSettings((s) => ({ ...s, strip: Boolean(msg.on) }));
          return true;
        case 'boxes:set':
          writeSettings((s) => ({ ...s, ...cleanSoundBoxState({ boxes: msg.count, boxTaps: msg.taps, boxEpoch: msg.epoch }) }));
          return true;
        case 'lines:set':
          writeSettings((s) => ({ ...s, lines: isLineSize(msg.size) ? msg.size : s.lines }));
          return true;
        default:
          return false;
      }
    },
    [board, bump, renderTiles, cancelPictureWrites, acceptMessage, finishPageCommand, role],
  );

  return {
    board,
    handle,
    pageId: session.pageId, pageEpoch: session.pageEpoch, pages: session.pages,
    pageReady: session.ready, pagePending, pageError, pageActions,
    pageScope, scopeMessage, sendPageMessage, acceptMessage, disconnect,
    get currentGame() { return pageSession.current.game; },
    stroke: { start, move, end },
    undo,
    canUndo: board.lastBy(role) !== null,
    sendPointer,
    sendThrottled,
    cancelThrottled,
    restore,
    tiles: [...tiles.current.values()],
    tileActions,
    pieces: [...pieces.current.values()],
    pictures: [...pictures.current.values()],
    pieceActions,
    offers: [...offers.current.values()],
    offerActions,
    addPicture,
    addPreparedPicture,
    cancelPictureWrites,
    pictureWriteContext: pictureUploads.current.context,
    addLibraryCard,
    addLibraryCards,
    retainPictures,
    clearPictures,
    addTiles,
    editTile,
    resetTiles,
    clearTiles,
    strip: settings.strip,
    boxes: settings.boxes,
    boxTaps: settings.boxTaps,
    boxEpoch: settings.boxEpoch,
    lines: settings.lines,
    setStrip,
    setBoxes,
    toggleSoundBox,
    resetSoundBoxes,
    setLines,
  };
}
