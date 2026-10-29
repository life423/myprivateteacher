import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWhiteboard } from './useWhiteboard.js';

// Run the production hook with retained state/refs and explicit effect replay, as in
// StrictMode/Fast Refresh. Transport and frame clocks remain controlled by the tests.
const hooks = vi.hoisted(() => ({ current: null }));
vi.mock('react', () => ({
  useState: (value) => hooks.current.useState(value),
  useRef: (value) => hooks.current.useRef(value),
  useEffect: (effect, dependencies) => hooks.current.useEffect(effect, dependencies),
  useCallback: (callback, dependencies) => hooks.current.useMemo(() => callback, dependencies),
  useMemo: (factory, dependencies) => hooks.current.useMemo(factory, dependencies),
}));
const mounted = [];
const changed = (previous, next) => !previous || next.some((item, n) => !Object.is(item, previous[n]));
function mountBoard(role = 'tutor') {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const slots = [];
  const send = vi.fn();
  let cursor = 0, dirty = true, effects = [], board;
  const runtime = {
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (next) => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; dirty = true; }];
    },
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useMemo(factory, dependencies) {
      const i = cursor++;
      if (changed(slots[i]?.dependencies, dependencies)) slots[i] = { dependencies, value: factory() };
      return slots[i].value;
    },
    useEffect(setup, dependencies) {
      const i = cursor++;
      const previous = slots[i];
      if (changed(previous?.dependencies, dependencies)) effects.push(() => { previous?.cleanup?.(); slots[i] = { setup, dependencies, cleanup: setup() }; });
    },
  };
  const render = () => {
    while (dirty) {
      dirty = false; cursor = 0; hooks.current = runtime;
      try { board = useWhiteboard(role, send); } finally { hooks.current = null; }
      const pending = effects; effects = []; pending.forEach((effect) => effect());
    }
  };
  const result = {
    get value() { render(); return board; }, send,
    messages: () => send.mock.calls.map(([message]) => message),
    replay() {
      slots.forEach((slot) => slot.cleanup?.());
      slots.forEach((slot) => { if (slot.setup) slot.cleanup = slot.setup(); });
    },
    unmount() { slots.forEach((slot) => { slot.cleanup?.(); slot.cleanup = null; }); },
  };
  mounted.push(result);
  return result;
}
afterEach(() => {
  mounted.splice(0).forEach((hook) => hook.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('whiteboard transport after effect cleanup and setup', () => {
  it('discards pre-refresh queued moves and resumes all pointer/object channels', () => {
    const hook = mountBoard();
    for (const name of ['p', 'tile', 'piece', 'hand-r']) hook.value.sendThrottled(name, { t: 'before-refresh', name });
    hook.replay();
    vi.advanceTimersByTime(100);
    expect(hook.messages()).toEqual([]);
    for (const name of ['p', 'tile', 'piece', 'hand-r']) hook.value.sendThrottled(name, { t: 'after-refresh', name });
    vi.advanceTimersByTime(34);
    expect(hook.messages()).toEqual(['p', 'tile', 'piece', 'hand-r'].map((name) => ({ t: 'after-refresh', name })));
    // The resumed channel still sends only its newest move in a throttle interval.
    hook.value.sendPointer({ t: 'p', x: 0.2, y: 0.2 });
    hook.value.sendPointer({ t: 'p', x: 0.3, y: 0.4 });
    vi.advanceTimersByTime(34);
    expect(hook.messages().at(-1)).toEqual({ t: 'p', x: 0.3, y: 0.4 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets canceled movement be replaced immediately without replaying its old payload', () => {
    const hook = mountBoard();
    hook.value.sendPointer({ t: 'p', x: 0.1, y: 0.1 });
    hook.value.cancelThrottled('p');
    hook.value.sendPointer({ t: 'p', x: 0.8, y: 0.9 });
    vi.advanceTimersByTime(34);
    expect(hook.messages()).toEqual([{ t: 'p', x: 0.8, y: 0.9 }]);
    hook.value.cancelThrottled('p');
    hook.replay();
    hook.value.sendPointer({ t: 'p', x: 0.4, y: 0.5 });
    vi.advanceTimersByTime(34);
    expect(hook.messages().at(-1)).toEqual({ t: 'p', x: 0.4, y: 0.5 });
  });

  it('flushes and ends pending ink exactly once, then lets a new stroke stream normally', () => {
    const hook = mountBoard();
    hook.value.stroke.start('pen', { x: 100, y: 200 });
    hook.value.stroke.move([{ x: 120, y: 210 }, { x: 140, y: 220 }]);
    const firstId = hook.messages()[0].id;
    expect(hook.messages().map(({ t }) => t)).toEqual(['s']);
    hook.replay();
    expect(hook.messages()).toEqual([
      { t: 's', id: firstId, tool: 'pen', x: 100, y: 200 },
      { t: 'm', id: firstId, pts: [120, 210, 140, 220] },
      { t: 'e', id: firstId },
    ]);
    expect(hook.value.board.strokes[0].done).toBe(true);
    vi.advanceTimersByTime(100);
    expect(hook.messages()).toHaveLength(3);
    hook.value.stroke.start('pen', { x: 300, y: 400 });
    hook.value.stroke.move([{ x: 320, y: 410 }]);
    vi.advanceTimersByTime(41);
    const secondId = hook.messages()[3].id;
    expect(hook.messages().slice(-2)).toEqual([
      { t: 's', id: secondId, tool: 'pen', x: 300, y: 400 },
      { t: 'm', id: secondId, pts: [320, 410] },
    ]);
    hook.value.stroke.end();
    expect(hook.messages().at(-1)).toEqual({ t: 'e', id: secondId });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears every transport timer on unmount without sending queued pointer movement', () => {
    const hook = mountBoard();
    hook.value.sendPointer({ t: 'p', x: 0.5, y: 0.5 });
    hook.value.sendThrottled('piece', { t: 'piece:move', id: 'picture', x: 20, y: 30 });
    hook.unmount();
    vi.advanceTimersByTime(100);
    expect(hook.messages()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

const pages = [{ id: 'page-a', title: 'First board' }, { id: 'page-b', title: 'Second board' }];
const tile = (id, text = 'a') => ({ id, text, x: 250, y: 350, hx: 10, hy: 800, z: 1, heldBy: null });
const image = { id: '00000000000000000000000000000001', w: 200, h: 200, title: 'Teaching picture' };
const piece = { id: 'piece-a', pic: image.id, crop: { x: 0, y: 0, w: 200, h: 200 }, x: 400, y: 350, w: 120, h: 120, z: 2, heldBy: null };
const snapshot = (pageId, pageEpoch, extra = {}) => ({ t: 'board', reason: 'page', pageId, pageEpoch, pages,
  strokes: [], tiles: [], pieces: [], pictures: [], pictureIds: [], offers: [], strip: true, boxes: 0, lines: 'medium', game: null, ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const microtasks = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const prepared = () => ({ blob: new Blob(['encoded image'], { type: 'image/png' }), w: 200, h: 200 });
const room = { code: '6106', key: 'test-room-key' };

describe('board page authority and retained state', () => {
  it('rejects old activation events and callbacks after A to B to A', () => {
    const hook = mountBoard();
    hook.value.handle(snapshot('page-a', 0, { tiles: [tile('tile-a')], pictures: [image], pictureIds: [image.id] }));
    const first = hook.value;
    const firstScope = first.pageScope();
    const placeOnFirst = first.pieceActions.add;
    hook.value.handle(snapshot('page-b', 1, { tiles: [tile('tile-b', 'b')], pictures: [image] }));
    expect(hook.value.acceptMessage({ t: 'game', pageId: 'page-a', pageEpoch: 0, game: { stale: true } })).toBe(false);
    hook.value.handle({ t: 'tile:add', pageId: 'page-a', pageEpoch: 0, tiles: [tile('stale')] });
    hook.value.handle(snapshot('page-a', 0, { tiles: [tile('old-board')] }));
    expect(hook.value.pageId).toBe('page-b');
    expect(hook.value.tiles.map(item => item.id)).toEqual(['tile-b']);
    hook.value.handle(snapshot('page-a', 2, { tiles: [tile('tile-a')], pictures: [image], pictureIds: [image.id] }));
    const sent = hook.messages().length;
    first.tileActions.move('tile-a', 999, 999);
    expect(placeOnFirst({ pic: image.id, crop: piece.crop, x: 300, y: 300 })).toBeNull();
    expect(hook.value.sendPageMessage({ t: 'game', game: { stale: true } }, firstScope)).toBe(false);
    expect(hook.value.tiles[0].x).toBe(250);
    expect(hook.messages()).toHaveLength(sent);
    hook.value.tileActions.move('tile-a', 450, 450);
    vi.advanceTimersByTime(34);
    expect(hook.messages().at(-1)).toMatchObject({ t: 'tile:move', pageId: 'page-a', pageEpoch: 2, x: 450 });
  });

  it('discards all queued old-page work when an authoritative page switch arrives', () => {
    const hook = mountBoard();
    hook.value.handle(snapshot('page-a', 0, { tiles: [tile('tile-a')], pieces: [piece], pictures: [image], pictureIds: [image.id] }));
    hook.value.stroke.start('pen', { x: 100, y: 300 });
    hook.value.stroke.move([{ x: 140, y: 350 }]);
    hook.value.tileActions.move('tile-a', 450, 450);
    hook.value.pieceActions.move(piece.id, 500, 450);
    hook.value.sendPointer({ t: 'p', x: 0.5, y: 0.5 });
    hook.value.sendThrottled('hand-r', { t: 'hand', side: 'r', a: 'move', x: 0.5, y: 0.5 });
    const sent = hook.messages().length;
    hook.value.handle(snapshot('page-b', 1));
    vi.advanceTimersByTime(100);
    expect(hook.messages()).toHaveLength(sent);
    expect(hook.value.board.strokes).toEqual([]);
    expect(hook.value.tiles).toEqual([]);
    expect(hook.value.pieces).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('flushes the last old-page ink and queued object points before its switch command', () => {
    const hook = mountBoard();
    hook.value.handle(snapshot('page-a', 0, { tiles: [tile('tile-a')], pieces: [piece], pictures: [image] }));
    hook.value.stroke.start('pen', { x: 100, y: 300 });
    hook.value.stroke.move([{ x: 140, y: 350 }]);
    hook.value.tileActions.move('tile-a', 450, 450);
    hook.value.pieceActions.move(piece.id, 500, 450);
    expect(hook.value.pageActions.switch('page-b')).toBe(true);
    expect(hook.messages().map(message => message.t)).toEqual(['s', 'm', 'e', 'tile:move', 'piece:move', 'page:switch']);
    expect(hook.messages().every(message => message.pageId === 'page-a' && message.pageEpoch === 0)).toBe(true);
    expect(hook.value.pagePending).toBe(true);
    hook.value.handle(snapshot('page-b', 1));
    vi.advanceTimersByTime(100);
    expect(hook.value.pagePending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retain or place a prepared picture or library copy that completes after a switch', async () => {
    const hook = mountBoard();
    hook.value.handle(snapshot('page-a', 0));
    const upload = deferred(), library = deferred();
    const fetcher = vi.fn(url => url.includes('/from-library/') ? library.promise : upload.promise);
    vi.stubGlobal('fetch', fetcher);
    const file = hook.value.addPreparedPicture(prepared(), room, { id: image.id });
    const card = hook.value.addLibraryCard({ id: 'mouth-card', w: 200, h: 200 }, room);
    await microtasks();
    expect(fetcher.mock.calls.every(([, options]) => options.headers['X-Page-Id'] === 'page-a' && options.headers['X-Page-Epoch'] === '0')).toBe(true);
    hook.value.handle(snapshot('page-b', 1));
    upload.resolve({ ok: true, status: 201 }); library.resolve({ ok: true, status: 201 });
    expect(await file).toMatchObject({ cancelled: true });
    expect(await card).toHaveProperty('error');
    expect(hook.value.pictures).toEqual([]);
    expect(hook.value.pieces).toEqual([]);
    expect(hook.messages().some(message => message.t === 'piece:add')).toBe(false);
  });

  it('preserves both pages and game/settings before restoring a fresh server with shared image bytes', async () => {
    const hook = mountBoard();
    hook.value.handle(snapshot('page-a', 0, { tiles: [tile('tile-a')], lines: 'big', boxes: 3 }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 201 })));
    await hook.value.addPreparedPicture(prepared(), room, { id: image.id });
    hook.value.sendPageMessage({ t: 'game', game: { kind: 'phoneme', word: 'cat' } });
    hook.value.handle(snapshot('page-b', 1, { tiles: [tile('tile-b', 'b')], pictures: [image], lines: 'off' }));
    hook.value.handle({ t: 'room', fresh: true, restoring: true, pageId: 'page-1', pageEpoch: 0, pages: [{ id: 'page-1', title: 'Board 1' }] });
    expect(hook.value.pages).toEqual(pages);
    expect(hook.value.pageReady).toBe(false);
    hook.send.mockClear();
    const wait = deferred();
    vi.stubGlobal('fetch', vi.fn(() => wait.promise));
    const restore = hook.value.restore(true, room);
    expect(hook.messages()[0]).toMatchObject({ t: 'pages:restore', pages, activePageId: 'page-b' });
    wait.resolve({ ok: true, status: 201 });
    expect(await restore).toBe(true);
    const messages = hook.messages();
    const id = messages[0].restoreId;
    expect(messages.filter(message => message.t === 'page:restore')).toEqual([
      expect.objectContaining({ id: 'page-a', restoreId: id, lines: 'big', boxes: 3, pictureIds: [image.id], game: { kind: 'phoneme', word: 'cat' } }),
      expect.objectContaining({ id: 'page-b', restoreId: id, lines: 'off' }),
    ]);
    expect(messages.filter(message => message.t === 'rs-tile').map(message => [message.pageId, message.tile.id])).toEqual([['page-a', 'tile-a'], ['page-b', 'tile-b']]);
    expect(messages.at(-1)).toEqual({ t: 'restored', restoreId: id, activePageId: 'page-b', tools: true });
  });

  it('stops a pending staged restore after disconnect and allows a new restored authority', async () => {
    const hook = mountBoard();
    hook.value.handle(snapshot('page-a', 0, { pages: [pages[0]] }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 201 })));
    await hook.value.addPreparedPicture(prepared(), room, { id: image.id });
    hook.value.handle({ t: 'room', fresh: true, restoring: true, pageId: 'page-1', pageEpoch: 0, pages: [{ id: 'page-1', title: 'Board 1' }] });
    const wait = deferred(); vi.stubGlobal('fetch', vi.fn(() => wait.promise));
    hook.send.mockClear();
    const restore = hook.value.restore(false, room);
    hook.value.disconnect();
    wait.resolve({ ok: true, status: 201 });
    expect(await restore).toBe(false);
    expect(hook.messages().map(message => message.t)).toEqual(['pages:restore']);
    expect(hook.value.pageReady).toBe(false);
    hook.value.handle({ t: 'room', pageId: 'page-a', pageEpoch: 3, pages });
    hook.value.handle(snapshot('page-a', 3));
    expect(hook.value.pageReady).toBe(true);
    expect(hook.value.sendPageMessage({ t: 'clear' })).toBe(true);
    expect(hook.messages().at(-1)).toMatchObject({ t: 'clear', pageId: 'page-a', pageEpoch: 3 });
  });
  it('hydrates inactive pages and source bytes after browser refresh without exposing their objects', async () => {
    const hook = mountBoard();
    const libraryImage = { ...image, id: '00000000000000000000000000000002', library: 'mouth-card' };
    hook.value.handle({ t: 'room', fresh: false, pageId: 'page-b', pageEpoch: 3, pages });
    hook.value.handle(snapshot('page-b', 3, { tiles: [tile('tile-b', 'b')], pictures: [image, libraryImage], pictureIds: [libraryImage.id] }));
    hook.value.handle({ t: 'page:cache', pageId: 'page-b', pageEpoch: 3, board: { id: 'page-a', tiles: [tile('tile-a')], pieces: [piece], offers: [], strokes: [], pictureIds: [image.id], lines: 'big', boxes: 3, game: null } });
    expect(hook.value.tiles.map(item => item.id)).toEqual(['tile-b']);
    expect(hook.value.pieces).toEqual([]);
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, blob: async () => prepared().blob }));
    vi.stubGlobal('fetch', fetcher);
    expect(await hook.value.retainPictures(room)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1); // Library sources retain their reference.
    expect(fetcher.mock.calls[0][0]).toContain(image.id);
    hook.value.handle({ t: 'room', fresh: true, restoring: true, pageId: 'page-1', pageEpoch: 0, pages: [{ id: 'page-1', title: 'Board 1' }] });
    hook.send.mockClear();
    expect(await hook.value.restore(false, room)).toBe(true);
    expect(fetcher.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(2);
    expect(hook.messages().find(message => message.t === 'rs-piece')).toMatchObject({ pageId: 'page-a', piece: { id: piece.id } });
    expect(hook.messages().filter(message => message.t === 'rs-tile').map(message => [message.pageId, message.tile.id])).toEqual([['page-a', 'tile-a'], ['page-b', 'tile-b']]);
  });

  it('ignores old activation cache packets and student-only cache injection', async () => {
    const hook = mountBoard();
    hook.value.handle(snapshot('page-b', 2));
    hook.value.handle({ t: 'page:cache', pageId: 'page-a', pageEpoch: 0, board: { id: 'page-a', tiles: [tile('stale-cache')] } });
    hook.send.mockClear();
    await hook.value.restore(false, room);
    expect(hook.messages().some(message => message.t === 'rs-tile' && message.tile.id === 'stale-cache')).toBe(false);
    const student = mountBoard('student');
    student.value.handle(snapshot('page-b', 2));
    student.value.handle({ t: 'page:cache', pageId: 'page-b', pageEpoch: 2, board: { id: 'page-a', tiles: [tile('private-cache')] } });
    expect(student.value.tiles).toEqual([]);
    expect(await student.value.restore(false, room)).toBe(false);
  });

  it('cannot restore an image whose reconnect hydration completed after the registry changed', async () => {
    const hook = mountBoard();
    hook.value.handle(snapshot('page-a', 0, { pictures: [image], pictureIds: [image.id] }));
    const wait = deferred();
    const fetcher = vi.fn(() => wait.promise); vi.stubGlobal('fetch', fetcher);
    const hydration = hook.value.retainPictures(room);
    await microtasks();
    hook.value.handle(snapshot('page-b', 1));
    wait.resolve({ ok: true, blob: async () => prepared().blob });
    expect(await hydration).toBe(false);
    await hook.value.restore(false, room);
    expect(fetcher).toHaveBeenCalledTimes(1); // No stale bytes are re-uploaded.
  });

  it('keeps the command timeout bounded across effect cleanup and setup', () => {
    const hook = mountBoard();
    hook.value.handle(snapshot('page-a', 0));
    hook.value.pageActions.switch('page-b');
    vi.advanceTimersByTime(2000);
    hook.replay();
    vi.advanceTimersByTime(6001);
    expect(hook.value.pagePending).toBe(false);
    expect(hook.value.pageError).toContain('not confirmed');
  });

  it('does not commit a partially missing deck when required image restoration fails', async () => {
    const hook = mountBoard();
    hook.value.handle(snapshot('page-a', 0, { pages: [pages[0]] }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 201 })));
    await hook.value.addPreparedPicture(prepared(), room, { id: image.id });
    hook.value.handle({ t: 'room', fresh: true, restoring: true, pageId: 'page-1', pageEpoch: 0, pages: [{ id: 'page-1', title: 'Board 1' }] });
    hook.send.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    expect(await hook.value.restore(false, room)).toBe(false);
    expect(hook.messages().map(message => message.t)).toEqual(['pages:restore']);
    expect(hook.value.pageError).toContain('pictures could not be restored');
  });

});
