import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { studentProjection } from '../../shared/lessons.js';
const test = vi.hoisted(() => ({ current: null, get: vi.fn(), catalog: vi.fn(), list: vi.fn(), save: vi.fn() }));
vi.mock('react', () => ({ useState: value => test.current.useState(value), useRef: value => test.current.useRef(value), useEffect: (effect, dependencies) => test.current.useEffect(effect, dependencies) }));
vi.mock('./api.js', () => ({ getLesson: (...args) => test.get(...args), getLessonCatalog: (...args) => test.catalog(...args), listLessons: (...args) => test.list(...args), saveLesson: (...args) => test.save(...args), lessonAssetUrl: (id, asset) => `/private/${id}/${asset}` }));
import { useLessonRunner } from './useLessonRunner.js';
const mounted = [];
function mount(wb, room, ready = true, options = {}) {
  const slots = []; let index = 0, dirty = true, effects = [], value, props = [wb, room, ready, options], live = true, queued = false;
  const schedule = () => { dirty = true; if (!queued) { queued = true; queueMicrotask(() => { queued = false; if (live) render(); }); } };
  const runtime = {
    useState(initial) { const i = index++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; schedule(); }]; },
    useRef(initial) { const i = index++; slots[i] ??= { current: initial }; return slots[i]; },
    useEffect(setup, dependencies) { const i = index++, old = slots[i]; if (!old || dependencies.some((item, n) => !Object.is(item, old.dependencies[n]))) effects.push(() => { old?.cleanup?.(); slots[i] = { dependencies, cleanup: setup() }; }); },
  };
  function render() { while (dirty) { dirty = false; index = 0; test.current = runtime; try { value = useLessonRunner(...props); } finally { test.current = null; } const pending = effects; effects = []; pending.forEach(effect => effect()); } return value; }
  const result = { get value() { return render(); }, update(next) { props = next; schedule(); return render(); }, unmount() { live = false; slots.forEach(slot => slot.cleanup?.()); } }; mounted.push(result); return result;
}
const read = { id: 'activity-a', type: 'read', title: 'Private Read', directions: 'Private directions', targets: '', letters: '', cardIds: [], assetIds: ['worksheet-a'], boxes: 0, reviewNextTime: false, reviewNote: '' };
const lesson = (item = read) => ({ id: 'lesson-a', title: 'Private plan', revision: 1, activities: [{ ...item }], assets: [{ id: 'worksheet-a', w: 100, h: 200 }] });
function board() {
  const wb = { board: { strokes: [] }, tiles: [], pieces: [], offers: [], boxes: 0, currentGame: null, pageReady: true, pagePending: false, pages: [{ id: 'page-1' }], pageId: 'page-1', pageEpoch: 0, pictureWriteContext: {}, preserved: [] };
  wb.pageScope = () => ({ pageId: wb.pageId, pageEpoch: wb.pageEpoch });
  wb.setBoxes = vi.fn(count => { wb.boxes = count; });
  wb.addTiles = vi.fn(text => { wb.tiles.push(...text.split(' ').map((value, n) => ({ id: `tile-${n}`, text: value }))); return { skipped: 0, full: false }; });
  wb.addPreparedPicture = vi.fn(async (prepared, room, options) => ({ id: options.id, w: prepared.w, h: prepared.h }));
  wb.addLibraryCard = vi.fn();
  wb.pieceActions = { add: vi.fn(({ pic, crop }) => { const id = `piece-${wb.pieces.length}`; wb.pieces.push({ id, pic, crop }); return id; }) };
  const snapshots = new Map();
  const snapshot = () => ({ tiles: structuredClone(wb.tiles), pieces: structuredClone(wb.pieces), strokes: structuredClone(wb.board.strokes), boxes: wb.boxes });
  const keep = () => { const value = snapshot(); snapshots.set(wb.pageId, value); wb.preserved.push({ pageId: wb.pageId, ...value }); };
  const show = id => { const value = snapshots.get(id) || { tiles: [], pieces: [], strokes: [], boxes: 0 }; wb.pageId = id; wb.pageEpoch++; wb.pictureWriteContext = {}; wb.tiles = structuredClone(value.tiles); wb.pieces = structuredClone(value.pieces); wb.board.strokes = structuredClone(value.strokes); wb.boxes = value.boxes; };
  wb.pageActions = {
    add: vi.fn(() => { keep(); const id = `page-${wb.pages.length + 1}`; wb.pages.push({ id }); show(id); return true; }),
    switch: vi.fn(id => { if (!wb.pages.some(page => page.id === id)) return false; keep(); show(id); return true; }),
  };
  return wb;
}
const signature = async activity => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(studentProjection(activity))))), byte => byte.toString(16).padStart(2, '0')).join('');
const readyBinding = async activity => ({ bindings: { [activity.id]: { pageId: 'page-1', signature: await signature(activity), ready: true, boxes: true, letters: true, cards: [], assets: activity.assetIds } }, sources: { 'worksheet-a': '00000000000000000000000000000001' } });
let storage;
beforeEach(() => {
  storage = new Map(); test.get.mockReset().mockResolvedValue(lesson()); test.catalog.mockReset().mockResolvedValue([]); test.list.mockReset().mockResolvedValue([]); test.save.mockReset();
  vi.stubGlobal('window', { location: { search: '' } });
  vi.stubGlobal('sessionStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['worksheet'], { type: 'image/png' }) }));
});
afterEach(() => { mounted.splice(0).forEach(item => item.unmount()); vi.unstubAllGlobals(); });
async function loaded(hook) { await hook.value.choose('lesson-a'); await vi.waitFor(() => expect(hook.value.lesson?.id).toBe('lesson-a')); }
describe('prepared activity room and page lifetime', () => {
  it('does not trust ready bindings from another room with the same recycled four-digit code', async () => {
    const review = { ...read, type: 'review', letters: 'a m s t p', assetIds: [] };
    test.get.mockResolvedValue(lesson(review));
    storage.set('lesson-pages:6106:OLD-room-key:lesson-a', JSON.stringify(await readyBinding(review)));
    // The old format must also be ignored, rather than silently migrated to a new room.
    storage.set('lesson-pages:6106:lesson-a', JSON.stringify(await readyBinding(review)));
    const wb = board(), hook = mount(wb, { code: '6106', key: 'NEW-room-key' }); await loaded(hook); await hook.value.activate(0);
    expect(wb.tiles.map(tile => tile.text)).toEqual(['a', 'm', 's', 't', 'p']); expect(hook.value.index).toBe(0);
    expect(wb.addPreparedPicture).not.toHaveBeenCalled(); expect(wb.pieces).toEqual([]);
    expect(storage.has('lesson-pages:6106:NEW-room-key:lesson-a')).toBe(true);
  });
  it('gives a changed Build to Dictation projection a fresh page while preserving the previous word', async () => {
    const build = { ...read, type: 'build', letters: 'c a t', assetIds: [] }; let plan = lesson(build); test.get.mockImplementation(async () => structuredClone(plan));
    const wb = board(), hook = mount(wb, { code: '6106', key: 'room-key' }); await loaded(hook); await hook.value.activate(0);
    expect(wb.tiles.map(item => item.text)).toEqual(['c', 'a', 't']);
    plan = { ...plan, revision: 2, activities: [{ ...build, type: 'dictation', targets: 'Private new dictation target' }] };
    await hook.value.choose(plan.id); await Promise.resolve(); await hook.value.activate(0);
    expect(wb.pageActions.add).toHaveBeenCalledOnce(); expect(wb.preserved[0].tiles.map(item => item.text)).toEqual(['c', 'a', 't']); expect(wb.tiles).toEqual([]); expect(hook.value.index).toBe(0);
  });
  it('reuses the taught page after private directions or review notes change alone', async () => {
    const build = { ...read, type: 'build', letters: 'sh i p', assetIds: [] }; let plan = lesson(build); test.get.mockImplementation(async () => structuredClone(plan));
    const wb = board(), hook = mount(wb, { code: '6106', key: 'room-key' }); await loaded(hook); await hook.value.activate(0);
    plan = { ...plan, revision: 2, activities: [{ ...build, directions: 'Updated private instructions', reviewNote: 'Review this next time', reviewNextTime: true }] };
    await hook.value.choose(plan.id); await Promise.resolve(); await hook.value.activate(0);
    expect(wb.pageActions.add).not.toHaveBeenCalled(); expect(wb.addTiles).toHaveBeenCalledOnce(); expect(wb.tiles.map(item => item.text)).toEqual(['sh', 'i', 'p']);
  });
  it('recovers a page setup interrupted by a disconnect only after an explicit retry', async () => {
    const room = { code: '6106', key: 'room-key' }, wb = board(), hook = mount(wb, room);
    wb.pieces.push({ id: 'teacher-choice', pic: 'manual-source', crop: { x: 0, y: 0, w: 40, h: 50 } });
    const add = wb.pageActions.add.getMockImplementation();
    wb.pageActions.add.mockImplementationOnce(() => { wb.pagePending = true; return true; });
    await loaded(hook);
    const opening = hook.value.activate(0); await vi.waitFor(() => expect(wb.pageActions.add).toHaveBeenCalledOnce());
    hook.update([wb, room, false]); wb.pictureWriteContext = {}; wb.pagePending = false; hook.update([wb, room, true]);
    await opening;
    expect(hook.value.index).toBe(-1); expect(hook.value.error).toMatch(/connection changed/);
    expect(wb.pageActions.add).toHaveBeenCalledOnce(); expect(wb.pieces[0].id).toBe('teacher-choice');
    wb.pageActions.add.mockImplementation(add); await hook.value.activate(0);
    expect(hook.value.error).toBeNull(); expect(hook.value.index).toBe(0);
    expect(wb.preserved[0].pieces[0].id).toBe('teacher-choice');
    expect(fetch).not.toHaveBeenCalled(); expect(wb.addPreparedPicture).not.toHaveBeenCalled();
  });

  it('keeps review cards and worksheets private when opening or navigating activities', async () => {
    const review = { ...read, id: 'review-a', type: 'review', letters: 'a m s t p', assetIds: [], cardIds: ['mouth-a'] };
    test.get.mockResolvedValue({ ...lesson(), activities: [review, read] });
    const wb = board(), onReadReady = vi.fn(), hook = mount(wb, { code: '6106', key: 'room-key' }, true, { onReadReady });
    await loaded(hook); await hook.value.activate(0);
    expect(wb.tiles.map(tile => tile.text)).toEqual(['a', 'm', 's', 't', 'p']);
    const choice = { id: 'chosen-part', pic: 'teacher-selected-picture', crop: { x: 10, y: 20, w: 40, h: 50 }, x: 200, y: 300, w: 80, h: 100 };
    wb.pieces.push(choice); wb.board.strokes.push({ id: 'student-ink', pts: [10, 20] });
    await hook.value.activate(1); expect(hook.value.index).toBe(1); expect(wb.pieces).toEqual([]);
    await hook.value.activate(0);
    expect(wb.pieces).toEqual([choice]); expect(wb.board.strokes[0].id).toBe('student-ink');
    expect(test.catalog).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(wb.addLibraryCard).not.toHaveBeenCalled(); expect(wb.addPreparedPicture).not.toHaveBeenCalled();
    expect(wb.pieceActions.add).not.toHaveBeenCalled(); expect(onReadReady).not.toHaveBeenCalled();
  });

  it('clears an earlier ready label before a failed explicit retry and allows recovery', async () => {
    const wb = board(), room = { code: '6106', key: 'room-key' }, hook = mount(wb, room);
    await loaded(hook); await hook.value.activate(0); expect(hook.value.index).toBe(0);
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockRejectedValueOnce(new Error('Activity preparation failed.')).mockImplementation(digest) } });
    await hook.value.activate(0);
    expect(hook.value.index).toBe(-1); expect(hook.value.busy).toBe(false); expect(hook.value.error).toBe('Activity preparation failed.');
    expect(JSON.parse(storage.get('lesson-pages:6106:room-key:lesson-a')).bindings[read.id].ready).toBe(false);
    await hook.value.activate(0);
    expect(hook.value.index).toBe(0); expect(hook.value.error).toBeNull(); expect(wb.pageActions.add).not.toHaveBeenCalled();
  });
});


describe('explicit classroom lesson startup', () => {
  const review = { ...read, id: 'review-a', type: 'review', letters: 'a m s t p', assetIds: [] };
  const waitUntilStarted = async hook => { await vi.waitFor(() => { expect(hook.value.busy).toBe(false); expect(hook.value.index).toBe(0); }); };
  it('waits for the confirmed page, then starts once without resetting later work or review notes', async () => {
    window.location.search = '?lesson=lesson-a'; const plan = lesson(review); test.get.mockResolvedValue(plan);
    const room = { code: '6106', key: 'room-key' }, wb = board(), onLessonOpen = vi.fn(); wb.pageReady = false;
    const hook = mount(wb, room, false, { onLessonOpen });
    await vi.waitFor(() => expect(hook.value.lesson?.id).toBe(plan.id));
    expect(onLessonOpen).toHaveBeenCalledOnce(); expect(wb.addTiles).not.toHaveBeenCalled();
    hook.update([wb, room, true, { onLessonOpen }]); await Promise.resolve(); expect(wb.addTiles).not.toHaveBeenCalled();
    wb.pageReady = true; wb.pagePending = true; hook.update([wb, room, true, { onLessonOpen }]); await Promise.resolve(); expect(wb.addTiles).not.toHaveBeenCalled();
    wb.pagePending = false; hook.update([wb, room, true, { onLessonOpen }]); await waitUntilStarted(hook);
    expect(wb.addTiles).toHaveBeenCalledExactlyOnceWith('a m s t p');
    wb.tiles.push({ id: 'student-work', text: 'p' });
    hook.update([wb, room, false, { onLessonOpen }]); wb.pictureWriteContext = {}; hook.update([wb, room, true, { onLessonOpen }]);
    test.save.mockResolvedValue({ ...plan, revision: 2, activities: [{ ...review, reviewNote: 'Keep this private note', reviewNextTime: true }] });
    await hook.value.saveReview(review.id, true, 'Keep this private note'); await Promise.resolve(); hook.value;
    expect(wb.addTiles).toHaveBeenCalledOnce(); expect(wb.tiles.at(-1).id).toBe('student-work'); expect(test.get).toHaveBeenCalledOnce(); expect(onLessonOpen).toHaveBeenCalledOnce();
    expect(hook.value.lesson.activities[0].reviewNote).toBe('Keep this private note');
  });
  it('recovers the mapped current activity on a classroom reload without importing or refocusing it', async () => {
    window.location.search = '?lesson=lesson-a'; const build = { ...review, id: 'build-b', type: 'build', letters: 'm a t', boxes: 3 }, plan = { ...lesson(review), activities: [review, build] };
    test.get.mockResolvedValue(plan); const first = (await readyBinding(review)).bindings[review.id], second = { ...(await readyBinding(build)).bindings[build.id], pageId: 'page-2' };
    storage.set('lesson-pages:6106:room-key:lesson-a', JSON.stringify({ bindings: { [review.id]: first, [build.id]: second }, sources: {} }));
    const wb = board(), room = { code: '6106', key: 'room-key' }, onReadReady = vi.fn(); wb.pages.push({ id: 'page-2' }); wb.pageId = 'page-2'; wb.pageEpoch = 3; wb.boxes = 3; wb.tiles = [{ id: 'existing-work', text: 'sat' }];
    const hook = mount(wb, room, true, { onReadReady });
    await vi.waitFor(() => expect(hook.value.index).toBe(1));
    expect(wb.addTiles).not.toHaveBeenCalled(); expect(wb.pageActions.add).not.toHaveBeenCalled(); expect(wb.pageActions.switch).not.toHaveBeenCalled(); expect(onReadReady).not.toHaveBeenCalled(); expect(wb.tiles).toEqual([{ id: 'existing-work', text: 'sat' }]);
  });
  it('resumes a ready reading page without downloading, replacing, or refocusing existing work', async () => {
    window.location.search = '?lesson=lesson-a'; storage.set('lesson-pages:6106:room-key:lesson-a', JSON.stringify(await readyBinding(read)));
    const wb = board(), onReadReady = vi.fn();
    wb.pieces = [{ id: 'manually-placed-worksheet', pic: '00000000000000000000000000000001', x: 125, y: 230, w: 200, h: 400 }];
    wb.board.strokes = [{ id: 'student-writing', pts: [100, 100, 110, 120] }];
    const work = structuredClone({ pieces: wb.pieces, strokes: wb.board.strokes });
    const hook = mount(wb, { code: '6106', key: 'room-key' }, true, { onReadReady });
    await waitUntilStarted(hook);
    expect(fetch).not.toHaveBeenCalled(); expect(wb.addPreparedPicture).not.toHaveBeenCalled(); expect(wb.pieceActions.add).not.toHaveBeenCalled(); expect(onReadReady).not.toHaveBeenCalled();
    expect(wb.pieces).toEqual(work.pieces); expect(wb.board.strokes).toEqual(work.strokes);
  });
  it('opens a read activity from its URL without downloading or placing its image or zooming', async () => {
    window.location.search = '?lesson=lesson-a';
    const wb = board(), onReadReady = vi.fn(), hook = mount(wb, { code: '6106', key: 'room-key' }, true, { onReadReady });
    await waitUntilStarted(hook);
    expect(hook.value.lesson.assets).toHaveLength(1); expect(hook.value.activeId).toBe(read.id);
    expect(fetch).not.toHaveBeenCalled(); expect(wb.addPreparedPicture).not.toHaveBeenCalled();
    expect(wb.pieceActions.add).not.toHaveBeenCalled(); expect(onReadReady).not.toHaveBeenCalled(); expect(wb.pieces).toEqual([]);
  });
  it('creates a new page for changed public materials instead of overwriting a resumed activity', async () => {
    window.location.search = '?lesson=lesson-a'; storage.set('lesson-pages:6106:room-key:lesson-a', JSON.stringify(await readyBinding(review)));
    const updated = { ...review, letters: 'm a t' }; test.get.mockResolvedValue({ ...lesson(updated), revision: 2 });
    const wb = board(); wb.tiles = [{ id: 'old-student-work', text: 'p' }];
    const hook = mount(wb, { code: '6106', key: 'room-key' }); await waitUntilStarted(hook);
    expect(wb.pageActions.add).toHaveBeenCalledOnce(); expect(wb.preserved[0].tiles).toEqual([{ id: 'old-student-work', text: 'p' }]); expect(wb.tiles.map(item => item.text)).toEqual(['m', 'a', 't']);
  });
  it('preserves a different board page when the prepared activities already exist in the room', async () => {
    window.location.search = '?lesson=lesson-a'; test.get.mockResolvedValue(lesson(review)); storage.set('lesson-pages:6106:room-key:lesson-a', JSON.stringify(await readyBinding(review)));
    const wb = board(); wb.pages.push({ id: 'page-2' }); wb.pageId = 'page-2'; wb.tiles = [{ id: 'extra-practice', text: 'p' }];
    const hook = mount(wb, { code: '6106', key: 'room-key' });
    await vi.waitFor(() => expect(hook.value.lesson?.id).toBe('lesson-a')); await new Promise(resolve => setTimeout(resolve, 10));
    expect(hook.value.index).toBe(-1); expect(wb.addTiles).not.toHaveBeenCalled(); expect(wb.pageActions.switch).not.toHaveBeenCalled(); expect(wb.pageId).toBe('page-2'); expect(wb.tiles[0].id).toBe('extra-practice');
  });
  it('does not automatically start a lesson selected manually from the classroom picker', async () => {
    test.get.mockResolvedValue(lesson(review)); const wb = board(), onLessonOpen = vi.fn(), hook = mount(wb, { code: '6106', key: 'room-key' }, true, { onLessonOpen });
    await loaded(hook); expect(wb.addTiles).not.toHaveBeenCalled(); expect(hook.value.index).toBe(-1); expect(onLessonOpen).not.toHaveBeenCalled();
    await hook.value.activate(0); expect(wb.addTiles).toHaveBeenCalledOnce(); expect(hook.value.index).toBe(0);
  });
  it('cancels a deferred URL startup if a different saved lesson is chosen before readiness', async () => {
    window.location.search = '?lesson=lesson-a'; let resolveOriginal; test.get.mockImplementation(id => id === 'lesson-a' ? new Promise(resolve => { resolveOriginal = resolve; }) : Promise.resolve({ ...lesson(review), id }));
    const room = { code: '6106', key: 'room-key' }, wb = board(), onLessonOpen = vi.fn(), hook = mount(wb, room, false, { onLessonOpen }); hook.value;
    await hook.value.choose('lesson-b'); resolveOriginal(lesson(review)); await Promise.resolve(); hook.update([wb, room, true, { onLessonOpen }]);
    await vi.waitFor(() => expect(hook.value.lesson?.id).toBe('lesson-b')); expect(wb.addTiles).not.toHaveBeenCalled(); expect(onLessonOpen).not.toHaveBeenCalled();
  });
  it('does not automatically retry an interrupted URL page setup after reconnecting', async () => {
    window.location.search = '?lesson=lesson-a';
    const room = { code: '6106', key: 'room-key' }, wb = board(); wb.tiles = [{ id: 'existing-work', text: 'p' }];
    wb.pageActions.add.mockImplementation(() => { wb.pagePending = true; return true; });
    const hook = mount(wb, room); hook.value;
    await vi.waitFor(() => expect(wb.pageActions.add).toHaveBeenCalledOnce());
    hook.update([wb, room, false]); wb.pictureWriteContext = {}; wb.pagePending = false; hook.update([wb, room, true]);
    await vi.waitFor(() => expect(hook.value.busy).toBe(false));
    expect(wb.pageActions.add).toHaveBeenCalledOnce(); expect(hook.value.index).toBe(-1); expect(hook.value.error).toMatch(/connection changed/);
    expect(wb.tiles[0].id).toBe('existing-work'); expect(fetch).not.toHaveBeenCalled(); expect(wb.addPreparedPicture).not.toHaveBeenCalled();
  });
  it('ignores an explicit lesson response after the classroom is left', async () => {
    window.location.search = '?lesson=lesson-a'; let resolve; test.get.mockReturnValue(new Promise(done => { resolve = done; }));
    const wb = board(), onLessonOpen = vi.fn(), hook = mount(wb, { code: '6106', key: 'room-key' }, true, { onLessonOpen }); hook.value; hook.unmount(); resolve(lesson(review));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(onLessonOpen).not.toHaveBeenCalled(); expect(wb.addTiles).not.toHaveBeenCalled();
  });
});
