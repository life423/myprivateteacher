import { cleanPictureMetadata } from '../../shared/pictureMetadata.js';
import { DEFAULT_LINES, isLineSize } from '../../shared/lines.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board, MAX_STROKE_NUMBERS } from './board.js';
import { BOX_COUNTS, MAX_TILES, cleanTileText } from '../../shared/tiles.js';
import { cleanBoxTap, cleanSoundBoxState } from '../../shared/soundBoxes.js';
import { MAX_PICTURES, MAX_PIECES, cleanCrop, clampPiece, pieceSize } from '../../shared/pieces.js';
import { findPicturePlacement, picturePlacement, picturePlacementObstacles, PICTURE_RESERVATION_MS } from './picturePlacement.js';
import { newPictureId, pictureUrl, shrinkPicture } from './pictures.js';
import { createPictureUploads, uploadPicture } from './pictureUploads.js';

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
      headers: { 'X-Room-Key': room.key },
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
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const set = useCallback((v) => {
    next.current = v;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setValue(next.current);
    });
  }, []);
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
  const libraryGeneration = useRef(0); // discard late copies after reset/reconnect
  const kept = useRef(new Map()); // the tutor's copies of pictures they added, in case the server restarts
  const offers = useRef(new Map()); // parts the tutor gave the student, each theirs to take once

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const renderTiles = useCallback(() => setTileFrame(performance.now()), [setTileFrame]);

  const pictureUploads = useRef(null);
  if (!pictureUploads.current) pictureUploads.current = createPictureUploads({
    role, getPictures: () => pictures.current, prepare: shrinkPicture, createId: newPictureId,
    onAdded: (picture, copy) => {
      kept.current.set(picture.id, copy);
      pictures.current.set(picture.id, picture);
      renderTiles();
    },
  });
  const cancelPictureWrites = useCallback(() => {
    pictureUploads.current.invalidate();
    libraryGeneration.current++;
    libraryRequests.current.clear();
    bump();
  }, [bump]);

  useEffect(
    () => () => {
      clearTimeout(flushTimer.current);
      pictureUploads.current.invalidate();
      libraryGeneration.current++;
      for (const channel of Object.values(channels.current)) clearTimeout(channel.timer);
    },
    [],
  );

  // Strokes
  const flush = useCallback(() => {
    clearTimeout(flushTimer.current);
    flushTimer.current = null;
    const current = active.current;
    if (!current || !current.pending.length) return;
    for (let i = 0; i < current.pending.length; i += CHUNK) {
      sendRef.current({ t: 'm', id: current.id, pts: current.pending.slice(i, i + CHUNK) });
    }
    current.pending = [];
  }, []);

  const end = useCallback(() => {
    const current = active.current;
    if (!current) return;
    flush();
    active.current = null;
    board.finish(current.id);
    sendRef.current({ t: 'e', id: current.id });
  }, [board, flush]);

  const start = useCallback(
    (tool, { x, y }) => {
      if (active.current) end();
      const id = makeId(role);
      const pts = [round1(x), round1(y)];
      active.current = { id, pending: [], lastX: pts[0], lastY: pts[1], size: 2 };
      board.add({ id, by: role, tool, pts });
      sendRef.current({ t: 's', id, tool, x: pts[0], y: pts[1] });
      bump();
    },
    [board, bump, end, role],
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

  const undo = useCallback(() => sendRef.current({ t: 'undo' }), []);

  // At most one message per channel every THROTTLE_MS; the newest one always wins.
  const sendThrottled = useCallback((name, message) => {
    const channel = channels.current[name] || (channels.current[name] = { timer: null, last: 0, message: null });
    channel.message = message;
    if (channel.timer) return;
    channel.timer = setTimeout(
      () => {
        channel.timer = null;
        channel.last = performance.now();
        sendRef.current(channel.message);
      },
      Math.max(0, THROTTLE_MS - (performance.now() - channel.last)),
    );
  }, []);

  const cancelThrottled = useCallback((name) => {
    const channel = channels.current[name];
    if (!channel) return;
    clearTimeout(channel.timer);
    channel.timer = null;
  }, []);

  const sendPointer = useCallback((message) => sendThrottled('p', message), [sendThrottled]);

  // Tiles. Dragging is shown here straight away; the server confirms the final spot on drop.
  const tileActions = useMemo(
    () => ({
      grab(id) {
        const tile = tiles.current.get(id);
        if (!tile) return;
        tile.heldBy = role;
        tile.z = Math.max(0, ...[...tiles.current.values()].map((t) => t.z)) + 1;
        renderTiles();
        sendRef.current({ t: 'tile:grab', id });
      },
      move(id, x, y) {
        const tile = tiles.current.get(id);
        if (!tile) return;
        tile.x = x;
        tile.y = y;
        renderTiles();
        sendThrottled('tile', { t: 'tile:move', id, x, y });
      },
      drop(id, x, y) {
        cancelThrottled('tile');
        const tile = tiles.current.get(id);
        if (tile) tile.heldBy = null;
        renderTiles();
        sendRef.current({ t: 'tile:drop', id, x, y });
      },
      remove(id) {
        if (role === 'tutor') sendRef.current({ t: 'tile:delete', id });
      },
      addAt(text, x, y) {
        const value = cleanTileText(text);
        if (role !== 'tutor' || !value || !Number.isFinite(x) || !Number.isFinite(y) || tiles.current.size >= MAX_TILES) return null;
        const id = makeId('tile');
        sendRef.current({ t: 'tile:add-at', tile: { id, text: value, x, y } });
        return id;
      },
      duplicate(id) {
        if (role !== 'tutor' || !tiles.current.has(id) || tiles.current.size >= MAX_TILES) return null;
        const copyId = makeId('tile');
        sendRef.current({ t: 'tile:duplicate', id, copyId });
        return copyId;
      },
    }),
    [role, renderTiles, sendThrottled, cancelThrottled],
  );

  // Picture pieces work like tiles: shown straight away here, confirmed by the server on drop.
  const pieceActions = useMemo(
    () => ({
      add({ offer, region, pic, crop, x, y, w, automatic = false, centre, bounds }) {
        const obstacles = picturePlacementObstacles([...pieces.current.values()], pendingPieces.current);
        if (obstacles.length >= MAX_PIECES) {
          lastPlacement.current = { error: `Up to ${MAX_PIECES} pictures or parts fit in a lesson. Remove one before adding another.` };
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
        sendRef.current({ t: 'piece:add', piece });
        return id;
      },
      duplicate(id, { bounds, centre } = {}) {
        const p = pieces.current.get(id);
        if (!p) return null;
        const obstacles = picturePlacementObstacles([...pieces.current.values()], pendingPieces.current);
        if (obstacles.length >= MAX_PIECES) {
          lastPlacement.current = { error: `Up to ${MAX_PIECES} pictures or parts fit in a lesson. Remove one before adding another.` };
          return null;
        }
        const size = pieceSize(p.crop, p.w);
        const at = findPicturePlacement(size, centre || { x: p.x + p.w / 2, y: p.y + p.h / 2 }, { pieces: obstacles, bounds });
        if (!at) return null;
        const copyId = makeId('piece');
        const piece = { id: copyId, pic: p.pic, crop: p.crop, x: at.x, y: at.y, w: p.w };
        pendingPieces.current.set(copyId, { piece: { ...piece, h: size.h }, expiresAt: Date.now() + PICTURE_RESERVATION_MS });
        lastPlacement.current = at;
        sendRef.current({ t: 'piece:add', piece });
        return copyId;
      },
      placementStatus() { return lastPlacement.current; },
      grab(id) {
        const p = pieces.current.get(id);
        if (!p) return;
        p.heldBy = role;
        renderTiles();
        sendRef.current({ t: 'piece:grab', id });
      },
      move(id, x, y, w) {
        const p = pieces.current.get(id);
        if (!p) return;
        const width = w ?? p.w;
        Object.assign(p, { x, y, w: width, h: (width * p.crop.h) / p.crop.w });
        renderTiles();
        sendThrottled('piece', { t: 'piece:move', id, x, y, w });
      },
      drop(id, x, y, w) {
        cancelThrottled('piece');
        const p = pieces.current.get(id);
        if (p) p.heldBy = null;
        renderTiles();
        sendRef.current({ t: 'piece:drop', id, x, y, w });
      },
      remove(id) {
        sendRef.current({ t: 'piece:delete', id });
      },
      crop(id, crop) {
        const piece = pieces.current.get(id);
        const chosen = piece && cleanCrop(crop, pictures.current.get(piece.pic));
        if (role !== 'tutor' || !chosen || (piece.heldBy && piece.heldBy !== 'tutor')) return false;
        sendRef.current({ t: 'piece:crop', id, crop: chosen });
        return true;
      },
      layer(id, direction) {
        if (role === 'tutor' && (direction === 'front' || direction === 'back')) {
          sendRef.current({ t: 'piece:layer', id, direction });
        }
      },
    }),
    [role, renderTiles, sendThrottled, cancelThrottled],
  );

  // PDF pages are already rendered and encoded, so retain their resolution and
  // format. Ordinary images still use the same bounded shrink path.
  const addPicture = useCallback((file, room, options) => pictureUploads.current.addFile(file, room, options), []);
  const addPreparedPicture = useCallback((image, room, options) => pictureUploads.current.addPrepared(image, room, options), []);

  // Tutor only: which parts the student may take.
  const offerActions = useMemo(
    () => ({
      give({ pic, crop }) {
        sendRef.current({ t: 'offer:add', offer: { id: makeId('offer'), pic, crop } });
      },
      withdraw(id) {
        sendRef.current({ t: 'offer:remove', id });
      },
      reset(id) {
        sendRef.current({ t: 'offer:reset', id });
      },
    }),
    [],
  );

  // Concurrent face additions share one source image, while each placement remains
  // a separate board piece. Previewing the catalog never calls this function.
  const addLibraryCard = useCallback((card, room) => {
    if (!room?.code || !room?.key) return Promise.resolve({ error: 'Not connected yet. Try again in a moment.' });
    const here = [...pictures.current.values()].find((p) => p.library === card.id);
    if (here) return Promise.resolve({ ...here, existing: true });
    const requestKey = `${room.code}:${room.key}:${card.id}`;
    if (libraryRequests.current.has(requestKey)) return libraryRequests.current.get(requestKey);
    const generation = libraryGeneration.current;
    const request = (async () => {
      const id = newPictureId();
      if (!(await sendFromLibrary(room, id, card.id))) return { error: 'That card couldn’t be added. Try again.' };
      if (generation !== libraryGeneration.current) return { error: 'The lesson changed. Please try adding the picture again.' };
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
  }, [renderTiles]);

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
    cancelPictureWrites();
    kept.current.clear();
    sendRef.current({ t: 'pieces:clear' });
  }, [cancelPictureWrites]);

  // Tutor controls. Spaces separate tiles, so sh stays one tile and c a t makes three.
  const addTiles = useCallback((input) => {
    const tokens = String(input)
      .split(' ')
      .map((s) => s.trim())
      .filter(Boolean);
    const good = tokens.map(cleanTileText).filter(Boolean);
    const sending = good.slice(0, Math.max(0, MAX_TILES - tiles.current.size));
    if (sending.length) sendRef.current({ t: 'tile:add', tiles: sending.map((text) => ({ id: makeId('tile'), text })) });
    return { added: sending.length, skipped: tokens.length - good.length, full: good.length > sending.length };
  }, []);

  const editTile = useCallback((id, input) => {
    const text = cleanTileText(input);
    if (!text || !tiles.current.has(id)) return false;
    sendRef.current({ t: 'tile:edit', id, text });
    return true;
  }, []);

  const resetTiles = useCallback(() => sendRef.current({ t: 'tiles:reset' }), []);
  const clearTiles = useCallback(() => sendRef.current({ t: 'tiles:clear' }), []);
  const setStrip = useCallback((on) => sendRef.current({ t: 'strip:set', on }), []);
  const setBoxes = useCallback((count) => {
    if (role !== 'tutor' || !BOX_COUNTS.includes(count)) return false;
    sendRef.current({ t: 'boxes:set', count });
    return true;
  }, [role]);
  const toggleSoundBox = useCallback((index, pressed) => {
    const { boxes, boxTaps, boxEpoch } = settingsRef.current;
    const tap = cleanBoxTap({ index, pressed: pressed === undefined ? !boxTaps.includes(index) : pressed, epoch: boxEpoch }, boxes, boxEpoch);
    if (!tap) return false;
    sendRef.current({ t: 'boxes:tap', ...tap });
    return true;
  }, []);
  const resetSoundBoxes = useCallback(() => {
    if (role !== 'tutor') return false;
    sendRef.current({ t: 'boxes:reset' });
    return true;
  }, [role]);
  const setLines = useCallback((size) => sendRef.current({ t: 'lines:set', size }), []);

  // After a server restart, the tutor hands back the board they still have: strokes,
  // tiles (in stacking order) and settings.
  const restore = useCallback(
    async (tools, room) => {
      // Pictures go back up first, so the pieces that show them are accepted.
      if (room) {
        for (const [id, copy] of kept.current) {
          await (copy.library ? sendFromLibrary(room, id, copy.library) : sendPicture(room, id, copy));
        }
      }
      for (const offer of offers.current.values()) sendRef.current({ t: 'rs-offer', offer });
      for (const s of board.strokes) sendRef.current({ t: 'rs', id: s.id, by: s.by, tool: s.tool, pts: s.pts });
      const ordered = [...tiles.current.values()].sort((a, b) => a.z - b.z);
      for (const tile of ordered) sendRef.current({ t: 'rs-tile', tile });
      for (const piece of [...pieces.current.values()].sort((a, b) => a.z - b.z)) sendRef.current({ t: 'rs-piece', piece });
      const { strip, boxes, boxTaps, boxEpoch, lines } = settingsRef.current;
      sendRef.current({ t: 'restored', tools, strip, boxes, boxTaps, boxEpoch, lines });
    },
    [board],
  );

  // Messages from the server. Returns true when the message was about the board.
  const handle = useCallback(
    (msg) => {
      const putTile = (tile) => {
        if (tile && tile.id) tiles.current.set(tile.id, tile);
      };
      switch (msg.t) {
        case 'board':
          cancelPictureWrites();
          active.current = null;
          pendingPieces.current.clear();
          lastPlacement.current = null;
          board.replace(Array.isArray(msg.strokes) ? msg.strokes : []);
          tiles.current = new Map((Array.isArray(msg.tiles) ? msg.tiles : []).map((t) => [t.id, t]));
          pictures.current = new Map((Array.isArray(msg.pictures) ? msg.pictures : []).map((p) => [p.id, p]));
          pieces.current = new Map((Array.isArray(msg.pieces) ? msg.pieces : []).map((p) => [p.id, p]));
          offers.current = new Map((Array.isArray(msg.offers) ? msg.offers : []).map((o) => [o.id, o]));
          setSettings({
            strip: msg.strip !== false,
            ...cleanSoundBoxState(msg),
            lines: isLineSize(msg.lines) ? msg.lines : DEFAULT_LINES,
          });
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
          renderTiles();
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
          if (!pictures.current.size) kept.current.clear();
          renderTiles();
          return true;
        case 'strip:set':
          setSettings((s) => ({ ...s, strip: Boolean(msg.on) }));
          return true;
        case 'boxes:set':
          setSettings((s) => ({ ...s, ...cleanSoundBoxState({ boxes: msg.count, boxTaps: msg.taps, boxEpoch: msg.epoch }) }));
          return true;
        case 'lines:set':
          setSettings((s) => ({ ...s, lines: isLineSize(msg.size) ? msg.size : s.lines }));
          return true;
        default:
          return false;
      }
    },
    [board, bump, renderTiles, cancelPictureWrites],
  );

  return {
    board,
    handle,
    stroke: { start, move, end },
    undo,
    canUndo: board.lastBy(role) !== null,
    sendPointer,
    sendThrottled,
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
