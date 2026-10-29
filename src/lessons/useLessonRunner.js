import { useEffect, useRef, useState } from 'react';
import { studentProjection } from '../../shared/lessons.js';
import { isPictureId } from '../../shared/pieces.js';
import { newPictureId } from '../whiteboard/pictures.js';
import { getLesson, getLessonCatalog, lessonAssetUrl, listLessons, saveLesson } from './api.js';

export function missingPreparedTiles(letters, tiles) {
  const available = new Map();
  for (const tile of tiles) available.set(tile.text, (available.get(tile.text) || 0) + 1);
  return letters.split(' ').filter(Boolean).filter(text => {
    const count = available.get(text) || 0;
    if (!count) return true;
    available.set(text, count - 1);
    return false;
  });
}

const sameScope = (a, b) => a?.pageId === b?.pageId && a?.pageEpoch === b?.pageEpoch;
const empty = board => !board.board.strokes.length && !board.tiles.length && !board.pieces.length && !board.offers.length && !board.boxes && !board.currentGame;
const mappingKey = (room, lesson) => `lesson-pages:${room.code}:${room.key}:${lesson.id}`;
function loadMapping(room, lesson) {
  const value = { bindings: Object.create(null), sources: Object.create(null) };
  try {
    const saved = JSON.parse(sessionStorage.getItem(mappingKey(room, lesson)) || '{}');
    for (const [id, binding] of Object.entries(saved.bindings || {})) if (binding && typeof binding.pageId === 'string') value.bindings[id] = { pageId: binding.pageId, signature: binding.signature, ready: binding.ready === true, letters: binding.letters === true, boxes: binding.boxes === true, cards: Array.isArray(binding.cards) ? binding.cards : [], assets: Array.isArray(binding.assets) ? binding.assets : [] };
    for (const [id, source] of Object.entries(saved.sources || {})) if (isPictureId(source)) value.sources[id] = source;
  } catch { /* invalid browser cache starts a new mapping */ }
  return value;
}
function saveMapping(room, lesson, mapping) {
  // Only opaque activity/page IDs and import progress; no targets, titles or notes.
  try { sessionStorage.setItem(mappingKey(room, lesson), JSON.stringify(mapping)); } catch { /* the live mapping still works */ }
}

// The private preparation document stays in this tutor-only hook. Only the explicit
// studentProjection is passed to existing room actions, with generic image titles.
export function useLessonRunner(wb, room, ready, { onReadReady } = {}) {
  const [lesson, setLesson] = useState(null), [choices, setChoices] = useState([]);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(null), [activeId, setActiveId] = useState(null);
  const [saving, setSaving] = useState(false), [savedMessage, setSavedMessage] = useState(null);
  const latest = useRef({ wb, room, ready, lesson, onReadReady });
  latest.current = { wb, room, ready, lesson, onReadReady };
  const generation = useRef(0), loadGeneration = useRef(0), live = useRef(true);
  const mapping = useRef({ bindings: Object.create(null), sources: Object.create(null) }), catalogue = useRef(null), running = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; generation.current++; loadGeneration.current++; }; }, []);
  useEffect(() => {
    generation.current++; running.current = 0; setBusy(false); setActiveId(null);
    mapping.current = lesson ? loadMapping(room, lesson) : { bindings: Object.create(null), sources: Object.create(null) };
  }, [room.code, room.key, lesson?.id]);
  const choose = async id => {
    const ticket = ++loadGeneration.current;
    generation.current++; running.current = 0; setLoading(true); setError(null); setActiveId(null); setSavedMessage(null);
    try {
      const value = await getLesson(id);
      if (!live.current || ticket !== loadGeneration.current) return;
      setLesson(value); mapping.current = loadMapping(latest.current.room, value);
    } catch (failure) { if (live.current && ticket === loadGeneration.current) setError(failure.message); }
    finally { if (live.current && ticket === loadGeneration.current) { setLoading(false); setBusy(false); } }
  };
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('lesson');
    if (id) void choose(id);
  }, []);
  const refreshChoices = async () => {
    setLoading(true); setError(null);
    try { const values = await listLessons(); if (live.current) setChoices(values); }
    catch (failure) { if (live.current) setError(failure.message); }
    finally { if (live.current) setLoading(false); }
  };
  const waitFor = (condition, ticket, origin) => new Promise((resolve, reject) => {
    const until = Date.now() + 9000;
    const inspect = () => {
      if (!live.current || ticket !== generation.current) return reject(new Error('The activity changed. Choose it again.'));
      const current = latest.current;
      if (origin && !sameScope(current.wb.pageScope(), origin)) return reject(new Error('The board changed. Choose the activity again.'));
      if (origin && current.wb.pictureWriteContext !== origin.writeContext) return reject(new Error('The connection changed. Choose the activity again.'));
      if (!current.ready) return reject(new Error('Reconnect before opening this activity.'));
      if (condition(current.wb)) return resolve(current.wb);
      if (current.wb.pageError || Date.now() >= until) return reject(new Error(current.wb.pageError || 'The board page was not confirmed. Try again.'));
      setTimeout(inspect, 25);
    };
    inspect();
  });
  const activate = async index => {
    const { lesson: plan, room: destination, ready: connected } = latest.current;
    let board = latest.current.wb;
    const activity = plan?.activities[index];
    if (!activity || running.current || !connected || !board.pageReady || board.pagePending) return;
    const ticket = ++generation.current;
    running.current = ticket;
    setBusy(true); setError(null); setSavedMessage(null);
    let scope;
    const current = () => live.current && generation.current === ticket && latest.current.lesson?.id === plan.id && latest.current.ready && latest.current.room.code === destination.code && latest.current.room.key === destination.key && (!scope || sameScope(latest.current.wb.pageScope(), scope) && latest.current.wb.pictureWriteContext === scope.writeContext);
    try {
      const shared = studentProjection(activity);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(shared)));
      const signature = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      if (!current()) throw new Error('The lesson changed. Choose the activity again.');
      board = latest.current.wb;
      let binding = mapping.current.bindings[activity.id];
      if (!binding || binding.signature !== signature || !board.pages.some(page => page.id === binding.pageId)) {
        const reuse = board.pages.length === 1 && empty(board) && !Object.values(mapping.current.bindings).some(value => value.pageId === board.pageId);
        if (!reuse) {
          const previous = new Set(board.pages.map(page => page.id));
          if (!board.pageActions.add()) throw new Error(board.pages.length >= 24 ? 'This room has 24 pages. Start a new room for this lesson.' : 'Wait for the board before trying again.');
          await waitFor(value => value.pageReady && !value.pagePending && !previous.has(value.pageId), ticket);
        }
        binding = { pageId: latest.current.wb.pageId, signature, ready: false, cards: [], assets: [], letters: false, boxes: false };
        mapping.current.bindings[activity.id] = binding;
        saveMapping(destination, plan, mapping.current);
      } else if (binding.pageId !== board.pageId) {
        if (!board.pageActions.switch(binding.pageId)) throw new Error('Wait for the board before trying again.');
        await waitFor(value => value.pageReady && !value.pagePending && value.pageId === binding.pageId, ticket);
      }
      scope = { ...latest.current.wb.pageScope(), writeContext: latest.current.wb.pictureWriteContext };
      if (!current()) throw new Error('The board changed. Choose the activity again.');
      setActiveId(activity.id);
      const remember = () => saveMapping(destination, plan, mapping.current);
      if (!binding.boxes) { if (latest.current.wb.boxes !== shared.boxes) latest.current.wb.setBoxes(shared.boxes); await waitFor(value => value.boxes === shared.boxes, ticket, scope); binding.boxes = true; remember(); }
      if (!binding.letters) {
        if (shared.letters) {
          // An interrupted request may already have reached the server. Fill only
          // the missing prepared tiles after reconnect, never duplicate the word.
          const missing = missingPreparedTiles(shared.letters, latest.current.wb.tiles);
          if (missing.length) {
            const result = latest.current.wb.addTiles(missing.join(' '));
            if (result.skipped || result.full) throw new Error('Some prepared tiles did not fit. Check the lesson preparation.');
            await waitFor(value => !missingPreparedTiles(shared.letters, value.tiles).length, ticket, scope);
          }
        }
        binding.letters = true; remember();
      }
      if (shared.cardIds.length && !catalogue.current) catalogue.current = await getLessonCatalog();
      for (const id of shared.cardIds) {
        if (binding.cards.includes(id)) continue;
        if (!current()) throw new Error('The board changed. Choose the activity again.');
        const card = catalogue.current.find(item => item.id === id);
        if (!card) throw new Error('A prepared card is no longer in the picture library. Update the lesson.');
        const picture = await latest.current.wb.addLibraryCard(card, destination);
        if (!current()) throw new Error('The board changed. Choose the activity again.');
        if (picture.error) throw new Error(picture.error);
        const existing = latest.current.wb.pieces.find(piece => piece.pic === picture.id && piece.crop.x === 0 && piece.crop.y === 0 && piece.crop.w === picture.w && piece.crop.h === picture.h);
        const placed = existing?.id || latest.current.wb.pieceActions.add({ pic: picture.id, crop: { x: 0, y: 0, w: picture.w, h: picture.h }, automatic: true });
        if (!placed) throw new Error('There is not enough room for this card. Remove a picture and try again.');
        await waitFor(value => value.pieces.some(piece => piece.id === placed), ticket, scope);
        binding.cards.push(id); remember();
      }
      for (const id of shared.assetIds) {
        if (binding.assets.includes(id)) continue;
        const asset = plan.assets?.find(item => item.id === id);
        if (!asset) throw new Error('A worksheet is missing. Open preparation to replace it.');
        const response = await fetch(lessonAssetUrl(plan.id, id), { cache: 'no-store' });
        if (!response.ok) throw new Error('The private worksheet could not be loaded. Try again.');
        const blob = await response.blob();
        if (!current()) throw new Error('The board changed. Choose the activity again.');
        const sourceId = mapping.current.sources[id] ||= newPictureId(); remember();
        const picture = await latest.current.wb.addPreparedPicture({ blob, w: asset.w, h: asset.h }, destination, { id: sourceId, material: 'worksheet', title: 'Lesson worksheet' });
        if (!current()) throw new Error('The board changed. Choose the activity again.');
        if (picture.error) throw new Error(picture.error);
        const existing = latest.current.wb.pieces.find(piece => piece.pic === picture.id && piece.crop.x === 0 && piece.crop.y === 0 && piece.crop.w === picture.w && piece.crop.h === picture.h);
        const placed = existing?.id || latest.current.wb.pieceActions.add({ pic: picture.id, crop: { x: 0, y: 0, w: picture.w, h: picture.h }, automatic: true });
        if (!placed) throw new Error('There is not enough room for this worksheet. Remove a picture and try again.');
        await waitFor(value => value.pieces.some(piece => piece.id === placed), ticket, scope);
        binding.assets.push(id); remember();
      }
      if (shared.type === 'read' && shared.assetIds.length && latest.current.onReadReady) {
        const sourceId = mapping.current.sources[shared.assetIds[0]];
        const piece = latest.current.wb.pieces.find(item => item.pic === sourceId);
        const focused = await latest.current.onReadReady(piece, current, scope);
        if (!current()) throw new Error('The board changed. Choose the activity again.');
        if (!focused) throw new Error('The reading view was not ready. Try opening the activity again.');
      }
      binding.ready = true; remember();
    } catch (failure) { if (live.current && generation.current === ticket) setError(failure.message); }
    finally { if (running.current === ticket) running.current = 0; if (live.current && generation.current === ticket) setBusy(false); }
  };
  const saveReview = async (id, reviewNextTime, reviewNote) => {
    const current = latest.current.lesson;
    if (!current || saving) return false;
    setSaving(true); setSavedMessage(null); setError(null);
    try {
      const saved = await saveLesson(current.id, { revision: current.revision, title: current.title, activities: current.activities.map(activity => activity.id === id ? { ...activity, reviewNextTime, reviewNote } : activity) });
      if (live.current && latest.current.lesson?.id === current.id) { setLesson(saved); setSavedMessage('Review note saved'); }
      return true;
    } catch (failure) { if (live.current) setError(failure.status === 409 ? 'Preparation changed in another tab. Keep your note, reopen the saved lesson, then save it again.' : failure.message); return false; }
    finally { if (live.current) setSaving(false); }
  };
  const index = lesson?.activities.findIndex(activity => activity.id === activeId && mapping.current.bindings[activity.id]?.ready && mapping.current.bindings[activity.id]?.pageId === wb.pageId) ?? -1;
  return { lesson, choices, loading, busy, error, index, activeId, saving, savedMessage, choose, reload: () => lesson && choose(lesson.id), refreshChoices, activate, saveReview, ready: ready && wb.pageReady && !wb.pagePending };
}
