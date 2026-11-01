import { useEffect, useRef, useState } from 'react';
import { studentProjection } from '../../shared/lessons.js';
import { getLesson, listLessons, saveLesson } from './api.js';

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
  const value = { bindings: Object.create(null) };
  try {
    const saved = JSON.parse(sessionStorage.getItem(mappingKey(room, lesson)) || '{}');
    for (const [id, binding] of Object.entries(saved.bindings || {})) if (binding && typeof binding.pageId === 'string') value.bindings[id] = { pageId: binding.pageId, signature: binding.signature, ready: binding.ready === true, letters: binding.letters === true, boxes: binding.boxes === true };
  } catch { /* invalid browser cache starts a new mapping */ }
  return value;
}
function saveMapping(room, lesson, mapping) {
  // Only opaque activity/page IDs and tile/box progress; no targets, titles or notes.
  try { sessionStorage.setItem(mappingKey(room, lesson), JSON.stringify(mapping)); } catch { /* the live mapping still works */ }
}

// The private preparation document stays in this tutor-only hook. Only the explicit
// studentProjection supplies the prepared tiles/boxes. Images remain private source
// material until the tutor explicitly places something through the picture editor.
export function useLessonRunner(wb, room, ready, { onLessonOpen } = {}) {
  const [lesson, setLesson] = useState(null), [choices, setChoices] = useState([]);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(null), [activeId, setActiveId] = useState(null);
  const [saving, setSaving] = useState(false), [savedMessage, setSavedMessage] = useState(null);
  const latest = useRef({ wb, room, ready, lesson, onLessonOpen });
  latest.current = { wb, room, ready, lesson, onLessonOpen };
  const generation = useRef(0), loadGeneration = useRef(0), live = useRef(true), autoStart = useRef(null);
  const mapping = useRef({ bindings: Object.create(null) }), running = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; generation.current++; loadGeneration.current++; }; }, []);
  useEffect(() => {
    generation.current++; running.current = 0; setBusy(false); setActiveId(null);
    mapping.current = lesson ? loadMapping(room, lesson) : { bindings: Object.create(null) };
  }, [room.code, room.key, lesson?.id]);
  useEffect(() => {
    // A connection boundary cancels an in-flight page setup, including an automatic
    // first activity. A later reconnect must not silently start it a second time.
    if (!ready) {
      if (running.current) setError('The connection changed. Choose the activity again.');
      generation.current++; running.current = 0; setBusy(false);
    }
  }, [ready]);
  const choose = async (id, { start = false } = {}) => {
    const ticket = ++loadGeneration.current;
    autoStart.current = start ? { id, ticket } : null;
    generation.current++; running.current = 0; setLoading(true); setError(null); setActiveId(null); setSavedMessage(null);
    try {
      const value = await getLesson(id);
      if (!live.current || ticket !== loadGeneration.current) return;
      setLesson(value); mapping.current = loadMapping(latest.current.room, value);
      if (start) latest.current.onLessonOpen?.();
    } catch (failure) { if (live.current && ticket === loadGeneration.current) setError(failure.message); }
    finally { if (live.current && ticket === loadGeneration.current) { setLoading(false); setBusy(false); } }
  };
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('lesson');
    if (id) void choose(id, { start: true });
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
  const activate = async (index, { resume = false } = {}) => {
    const { lesson: plan, room: destination, ready: connected } = latest.current;
    let board = latest.current.wb;
    const activity = plan?.activities[index];
    if (!activity || running.current || !connected || !board.pageReady || board.pagePending) return;
    const ticket = ++generation.current;
    running.current = ticket;
    const previousBinding = mapping.current.bindings[activity.id];
    if (!resume && previousBinding) {
      // A failed explicit retry must not retain an earlier success label.
      previousBinding.ready = false;
      saveMapping(destination, plan, mapping.current);
    }
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
        binding = { pageId: latest.current.wb.pageId, signature, ready: false, letters: false, boxes: false };
        mapping.current.bindings[activity.id] = binding;
        saveMapping(destination, plan, mapping.current);
      } else if (binding.pageId !== board.pageId) {
        if (!board.pageActions.switch(binding.pageId)) throw new Error('Wait for the board before trying again.');
        await waitFor(value => value.pageReady && !value.pagePending && value.pageId === binding.pageId, ticket);
      }
      scope = { ...latest.current.wb.pageScope(), writeContext: latest.current.wb.pictureWriteContext };
      if (!current()) throw new Error('The board changed. Choose the activity again.');
      setActiveId(activity.id);
      // Reloading the classroom recovers the activity identity without changing
      // the tutor's existing board, zoom, or placed picture parts.
      if (resume && binding.ready) return;
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
      // Opening/navigating an activity never imports a picture or changes the view.
      // The tutor decides which words, letters or photographs to place from its sources.
      if (!current()) throw new Error('The board changed. Choose the activity again.');
      binding.ready = true; remember();
    } catch (failure) { if (live.current && generation.current === ticket) setError(failure.message); }
    finally { if (running.current === ticket) running.current = 0; if (live.current && generation.current === ticket) setBusy(false); }
  };
  useEffect(() => {
    const request = autoStart.current;
    if (!request || request.ticket !== loadGeneration.current || request.id !== lesson?.id || loading || busy || !ready || !wb.pageReady || wb.pagePending) return;
    // Consume the explicit URL request before starting async work. Rerenders,
    // reconnects, and review-note saves must never reset the activity again.
    autoStart.current = null;
    const known = lesson.activities.map((activity, index) => ({ index, binding: mapping.current.bindings[activity.id] }))
      .filter(({ binding }) => binding && wb.pages.some(page => page.id === binding.pageId));
    const current = known.find(({ binding }) => binding.pageId === wb.pageId);
    if (current) void activate(current.index, { resume: true });
    // A resumed room may currently show an unrelated board page. Leave that
    // selection intact instead of jumping back to the first prepared activity.
    else if (!known.length && lesson.activities.length) void activate(0);
  }, [lesson, loading, busy, ready, wb.pageReady, wb.pagePending, wb.pageId, room.code, room.key]);
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
