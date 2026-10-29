import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import WebSocket from 'ws';
import { attachRealtime } from './realtime.js';
import { DEFAULT_PAGE_ID, MAX_PAGES } from '../shared/pages.js';

const ORIGIN = 'http://localhost:8080';
let server, realtime, address, sockets;
beforeEach(async () => {
  sockets = [];
  server = http.createServer();
  realtime = attachRealtime(server, { allowedOrigins: new Set([ORIGIN]), maxRoomsPerIp: 100, tutorGraceMs: 1000 });
  await new Promise(resolve => server.listen(0, resolve));
  address = `ws://localhost:${server.address().port}/ws`;
});
afterEach(async () => {
  for (const socket of sockets) socket.terminate();
  realtime.close();
  await new Promise(resolve => server.close(resolve));
});
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(address, { origin: ORIGIN });
    sockets.push(ws);
    const inbox = [], received = [];
    const client = {
      ws, inbox, received, scope: null,
      send: msg => ws.send(JSON.stringify(msg)),
      page(msg, scope = client.scope) { client.send({ ...scope, ...msg }); },
      take(type, predicate = () => true) {
        return new Promise((done, fail) => {
          const until = Date.now() + 1500;
          function check() {
            const index = inbox.findIndex(msg => msg.t === type && predicate(msg));
            if (index >= 0) return done(inbox.splice(index, 1)[0]);
            if (Date.now() > until) return fail(new Error(`No ${type} response`));
            setTimeout(check, 2);
          }
          check();
        });
      },
    };
    ws.on('message', data => {
      const msg = JSON.parse(data);
      if (msg.pageId !== undefined && ['room', 'board', 'pages'].includes(msg.t)) client.scope = { pageId: msg.pageId, pageEpoch: msg.pageEpoch };
      inbox.push(msg); received.push(msg);
    });
    ws.once('error', reject);
    ws.once('open', () => resolve(client));
  });
}
async function openRoom(request = {}) {
  const tutor = await connect();
  tutor.send({ t: 'create', ...request });
  const ack = await tutor.take('room');
  return { tutor, ...ack, room: realtime.rooms.get(ack.code) };
}
async function join(code, key) {
  const student = await connect();
  student.send({ t: 'join', code, key });
  const ack = await student.take('room');
  const board = await student.take('board');
  return { student, ack, board };
}
async function barrier(from, to, id = 'barrier') {
  from.send({ t: 'rtc:ready', id });
  await to.take('rtc:ready', msg => msg.id === id);
}
async function change(tutor, action) {
  tutor.page(action);
  return tutor.take('board', msg => msg.reason === 'page');
}
const image = (code, key, id, extra = {}) => ({ code, key, id, w: 400, h: 300, type: 'image/jpeg', bytes: Buffer.alloc(20), ...extra });
const fullCrop = { x: 0, y: 0, w: 400, h: 300, r: 0 };

async function seed(tutor, code, key) {
  tutor.page({ t: 's', id: 'ink', tool: 'pen', x: 100, y: 300 });
  await tutor.take('ack');
  tutor.page({ t: 'm', id: 'ink', pts: [200, 350] });
  tutor.page({ t: 'e', id: 'ink' });
  tutor.page({ t: 'tile:add', tiles: [{ id: 'tile-c', text: 'c' }] });
  await tutor.take('tile:add');
  const pic = 'a'.repeat(32);
  expect(realtime.pictures.add(image(code, key, pic)).status).toBe(201);
  tutor.page({ t: 'piece:add', piece: { id: 'face', pic, crop: fullCrop, x: 300, y: 350, w: 180 } });
  await tutor.take('piece:add');
  tutor.page({ t: 'offer:add', offer: { id: 'offer-face', pic, crop: fullCrop } });
  await tutor.take('offer');
  tutor.page({ t: 'boxes:set', count: 3 });
  const boxes = await tutor.take('boxes:set');
  tutor.page({ t: 'boxes:tap', index: 1, pressed: true, epoch: boxes.epoch });
  await tutor.take('boxes:set');
  tutor.page({ t: 'lines:set', size: 'small' });
  await tutor.take('lines:set');
  tutor.page({ t: 'strip:set', on: false });
  await tutor.take('strip:set');
  tutor.page({ t: 'game', game: { kind: 'bridge', placed: { a: 1 } } });
  return pic;
}

describe('tutor-controlled board pages', () => {
  it('gives a page-capable new lesson an initial board without mistaking it for a restart restore', async () => {
    const { tutor, restoring } = await openRoom({ pageProtocol: 1 });
    expect(restoring).toBe(false);
    expect(await tutor.take('board')).toMatchObject({ reason: 'sync', pageId: DEFAULT_PAGE_ID, pageEpoch: 0, strokes: [], tiles: [] });
    tutor.page({ t: 'tile:add', tiles: [{ id: 'first', text: 'a' }] });
    expect(await tutor.take('tile:add')).toMatchObject({ pageId: DEFAULT_PAGE_ID, pageEpoch: 0 });
  });

  it('starts with a scoped board and allows only the tutor to change the page list or activation', async () => {
    const { tutor, code, pageId, pageEpoch, pages, room } = await openRoom();
    expect({ pageId, pageEpoch, pages }).toEqual({ pageId: DEFAULT_PAGE_ID, pageEpoch: 0, pages: [{ id: DEFAULT_PAGE_ID, title: 'Board 1' }] });
    const { student, board } = await join(code);
    expect(board).toMatchObject({ pageId, pageEpoch, pages, strokes: [], tiles: [] });
    for (const t of ['page:add', 'page:duplicate', 'page:rename', 'page:delete', 'page:switch']) student.page({ t, id: DEFAULT_PAGE_ID, title: 'Changed' });
    await barrier(student, tutor);
    expect(room.pages.size).toBe(1);
    expect(room.board.title).toBe('Board 1');
    const next = await change(tutor, { t: 'page:add', id: 'page-2', title: '  Review\n letters  ' });
    expect(next).toMatchObject({ pageId: 'page-2', pageEpoch: 1, pages: [{ id: DEFAULT_PAGE_ID, title: 'Board 1' }, { id: 'page-2', title: 'Review letters' }] });
    expect(await student.take('board', msg => msg.reason === 'page')).toMatchObject({ pageId: 'page-2', pageEpoch: 1 });
  });

  it('preserves independent page ink, tiles, crops, offers, boxes, settings and games while sharing image bytes', async () => {
    const { tutor, code, key, room } = await openRoom();
    const pic = await seed(tutor, code, key);
    const first = room.board;
    const second = await change(tutor, { t: 'page:add', id: 'page-2' });
    expect(second).toMatchObject({ strokes: [], tiles: [], pieces: [], offers: [], boxes: 0, strip: true, game: null, pictureIds: [] });
    const copy = await change(tutor, { t: 'page:duplicate', id: DEFAULT_PAGE_ID, copyId: 'page-copy' });
    expect(copy).toMatchObject({ pageId: 'page-copy', pageEpoch: 2, boxes: 3, boxTaps: [1], lines: 'small', strip: false, pictureIds: [pic], game: { placed: { a: 1 } } });
    expect(copy.strokes[0].pts).toEqual([100, 300, 200, 350]);
    expect(copy.tiles.map(tile => tile.id)).toEqual(['tile-c']);
    expect(copy.pieces[0]).toMatchObject({ id: 'face', crop: fullCrop, heldBy: null });
    expect(copy.offers[0].id).toBe('offer-face');
    expect(room.board.strokes[0]).not.toBe(first.strokes[0]);
    expect(room.board.strokes[0].pts).not.toBe(first.strokes[0].pts);
    expect(room.board.pieces.get('face').crop).not.toBe(first.pieces.get('face').crop);
    expect(room.board.game).not.toBe(first.game);
    expect(room.pictures.size).toBe(1);
    tutor.page({ t: 'tile:grab', id: 'tile-c' }); await tutor.take('tile:grab');
    tutor.page({ t: 'tile:drop', id: 'tile-c', x: 700, y: 600 }); await tutor.take('tile:drop');
    const original = await change(tutor, { t: 'page:switch', id: DEFAULT_PAGE_ID });
    expect(original.tiles[0].x).not.toBe(700);
    expect(original.strokes).toHaveLength(1);
    expect(original.game).toEqual({ kind: 'bridge', placed: { a: 1 } });
  });

  it('rejects delayed gestures, undo, picture creation and commands after A to B to A', async () => {
    const { tutor, code, key, room } = await openRoom();
    const { student } = await join(code);
    await seed(tutor, code, key);
    tutor.send({ t: 'tools', on: true }); await student.take('tools');
    const old = { ...tutor.scope };
    await change(tutor, { t: 'page:add', id: 'page-2' });
    await change(tutor, { t: 'page:switch', id: DEFAULT_PAGE_ID });
    const before = room.board;
    for (const request of [
      { t: 's', id: 'late-ink', tool: 'pen', x: 10, y: 300 }, { t: 'undo' }, { t: 'clear' },
      { t: 'tile:add', tiles: [{ id: 'late-tile', text: 'x' }] }, { t: 'tiles:clear' },
      { t: 'piece:add', piece: { id: 'late-piece', pic: 'a'.repeat(32), crop: fullCrop, x: 400, y: 400 } },
      { t: 'pieces:clear' }, { t: 'offer:remove', id: 'offer-face' },
      { t: 'boxes:set', count: 5 }, { t: 'lines:set', size: 'off' }, { t: 'strip:set', on: true },
      { t: 'game', game: null }, { t: 'hand', side: 'r', a: 'grab' }, { t: 'hands', r: false },
    ]) tutor.page(request, old);
    student.page({ t: 's', id: 'late-student', tool: 'pen', x: 100, y: 300 }, old);
    await barrier(tutor, student, 'tutor-processed'); await barrier(student, tutor, 'student-processed');
    expect(room.board).toBe(before);
    expect(room.strokes).toHaveLength(1);
    expect(room.tiles.size).toBe(1); expect(room.pieces.size).toBe(1); expect(room.offers.size).toBe(1);
    expect(room).toMatchObject({ boxes: 3, lines: 'small', strip: false, game: { kind: 'bridge' } });
    expect(room.hands.r).toMatchObject({ on: true, by: null });
    tutor.send({ t: 'tile:add', tiles: [{ id: 'legacy', text: 'y' }] });
    tutor.page({ t: 'page:add', id: 'stale-page' }, old);
    expect((await tutor.take('error')).reason).toBe('page-stale');
    expect(room.pages.size).toBe(2); expect(room.tiles.has('legacy')).toBe(false);
    tutor.page({ t: 'tile:add', tiles: [{ id: 'fresh', text: 'm' }] });
    expect(await tutor.take('tile:add', msg => msg.tiles.some(tile => tile.id === 'fresh'))).toMatchObject({ pageId: DEFAULT_PAGE_ID, pageEpoch: 2 });
  });

  it('settles open strokes and releases tiles, pieces, hands and pointer markers before the student follows', async () => {
    const { tutor, code, key, room } = await openRoom();
    const { student } = await join(code);
    await seed(tutor, code, key);
    tutor.page({ t: 'tile:grab', id: 'tile-c' }); await tutor.take('tile:grab');
    student.page({ t: 'piece:grab', id: 'face' }); await tutor.take('piece:grab');
    tutor.page({ t: 'hand', side: 'r', a: 'grab' }); await tutor.take('hand');
    tutor.page({ t: 's', id: 'open', tool: 'pen', x: 500, y: 500 }); await tutor.take('ack');
    tutor.page({ t: 'p', x: .5, y: .5, m: 'pen' }); await student.take('p');
    const previous = room.board;
    await change(tutor, { t: 'page:add', id: 'page-2' });
    expect(previous.tiles.get('tile-c').heldBy).toBeNull();
    expect(previous.pieces.get('face').heldBy).toBeNull();
    expect(previous.strokeById.get('open').done).toBe(true);
    expect(room.tutor.openStroke).toBeNull(); expect(room.student.openStroke).toBeNull();
    expect(room.hands.r).toMatchObject({ by: null, timer: null });
    expect(room.pointers).toEqual({});
    expect(await student.take('board', msg => msg.reason === 'page')).toMatchObject({ pageId: 'page-2', strokes: [], tiles: [], pieces: [] });
  });

  it('rejects late HTTP writes and sends reused source metadata before a new-page placement', async () => {
    const { tutor, code, key, room } = await openRoom();
    const pic = 'a'.repeat(32), late = 'b'.repeat(32);
    realtime.pictures.add(image(code, key, pic, { library: 'card', regions: [{ id: 'mouth', label: 'Face', ...fullCrop }] }));
    const token = realtime.pictures.beginWrite(code, key);
    const { student, ack } = await join(code);
    await change(tutor, { t: 'page:add', id: 'page-2' });
    expect(realtime.pictures.add(image(code, key, late, { writeToken: token })).status).toBe(409);
    expect(room.pictures.has(late)).toBe(false);
    expect(realtime.pictures.beginWrite(code, key, { pageId: DEFAULT_PAGE_ID, pageEpoch: 0 })).toBeNull();
    expect(realtime.pictures.beginWrite(code, key)).toBeNull();
    expect(realtime.pictures.beginWrite(code, key, tutor.scope)).not.toBeNull();
    const next = await student.take('board', msg => msg.reason === 'page');
    expect(next.pictures).toEqual([]); expect(next.pictureIds).toEqual([]);
    // A student cannot reuse a region they learned on a previous page by forging its id.
    student.page({ t: 'piece:add', piece: { id: 'hidden-face', pic, region: 'mouth', x: 300, y: 300 } });
    await barrier(student, tutor);
    expect(room.pieces.size).toBe(0);
    const { student: back, board } = await join(code, ack.key);
    expect(board.pictures).toEqual([]);
    const at = back.received.length;
    tutor.page({ t: 'piece:add', piece: { id: 'shown-face', pic, crop: fullCrop, x: 300, y: 300 } });
    await back.take('piece:add');
    const updates = back.received.slice(at);
    expect(updates.map(msg => msg.t)).toEqual(['pic:add', 'piece:add']);
    expect(updates[0]).toMatchObject({ pageId: 'page-2', pageEpoch: 1, pic: { id: pic } });
    expect(room.pictures.size).toBe(1);
  });

  it('clears only the active page and keeps an image source referenced by another page', async () => {
    const { tutor, code, key, room } = await openRoom();
    const pic = await seed(tutor, code, key);
    await change(tutor, { t: 'page:duplicate', id: DEFAULT_PAGE_ID, copyId: 'page-2' });
    const extra = 'c'.repeat(32);
    realtime.pictures.add(image(code, key, extra));
    const { student } = await join(code);
    tutor.page({ t: 'pieces:clear' });
    const own = await tutor.take('pieces'), peer = await student.take('pieces');
    expect(own.pictures.map(image => image.id)).toEqual([pic]);
    expect(peer).toMatchObject({ pictures: [], pieces: [], offers: [], pageId: 'page-2' });
    expect(room.pictures.has(pic)).toBe(true); expect(room.pictures.has(extra)).toBe(false);
    const first = await change(tutor, { t: 'page:switch', id: DEFAULT_PAGE_ID });
    expect(first.pieces).toHaveLength(1); expect(first.offers).toHaveLength(1);
    expect(first.pictureIds).toEqual([pic]);
    expect((await student.take('board', msg => msg.pageId === DEFAULT_PAGE_ID)).pictures.map(image => image.id)).toEqual([pic]);
  });

  it('returns the complete page list and current board after either participant reconnects', async () => {
    const { tutor, code, key } = await openRoom();
    const { ack } = await join(code);
    await change(tutor, { t: 'page:add', id: 'page-2' });
    tutor.page({ t: 'tile:add', tiles: [{ id: 'active-tile', text: 'sh' }] }); await tutor.take('tile:add');
    const returningTutor = await connect();
    returningTutor.send({ t: 'create', code, key });
    expect(await returningTutor.take('room')).toMatchObject({ fresh: false, pageId: 'page-2', pageEpoch: 1, pages: [{ id: DEFAULT_PAGE_ID }, { id: 'page-2' }] });
    const tutorBoard = await returningTutor.take('board');
    const { board: studentBoard } = await join(code, ack.key);
    for (const board of [tutorBoard, studentBoard]) {
      expect(board).toMatchObject({ pageId: 'page-2', pageEpoch: 1, tiles: [{ id: 'active-tile', text: 'sh' }] });
      expect(board.pages).toHaveLength(2);
    }
  });

  it('hydrates inactive tutor pages after refresh so a later restart can restore the full deck', async () => {
    const { tutor, code, key } = await openRoom();
    const pic = await seed(tutor, code, key);
    await change(tutor, { t: 'page:add', id: 'page-2', title: 'Current page' });
    tutor.page({ t: 'tile:add', tiles: [{ id: 'second-tile', text: 't' }] }); await tutor.take('tile:add');
    const { student } = await join(code);
    const refreshed = await connect();
    refreshed.send({ t: 'create', code, key, pageProtocol: 1 });
    expect(await refreshed.take('room')).toMatchObject({ restoring: false });
    const active = await refreshed.take('board');
    const cache = await refreshed.take('page:cache');
    expect(cache).toMatchObject({ pageId: 'page-2', pageEpoch: 1, board: { id: DEFAULT_PAGE_ID, title: 'Board 1', pictureIds: [pic], strokes: [{ id: 'ink' }], pieces: [{ id: 'face' }] } });
    await barrier(refreshed, student, 'cache-complete');
    expect(student.received.some(message => message.t === 'page:cache')).toBe(false);
    const cached = [cache.board, { ...active, id: active.pageId }];
    // Only the refreshed browser's authoritative active snapshot/cache is replayed.
    realtime.rooms.delete(code);
    refreshed.ws.terminate(); student.ws.terminate();
    const restored = await connect();
    restored.send({ t: 'create', code, key, pageProtocol: 1 });
    expect(await restored.take('room')).toMatchObject({ fresh: true, restoring: true, pageId: DEFAULT_PAGE_ID, pageEpoch: 0 });
    const restoreId = 'after-refresh';
    restored.send({ t: 'pages:restore', restoreId, pages: active.pages, activePageId: active.pageId });
    // Upload bytes were hydrated separately by the refreshed tutor while live.
    expect(realtime.pictures.add(image(code, key, pic)).status).toBe(201);
    for (const page of cached) {
      restored.send({ ...page, t: 'page:restore', restoreId });
      for (const stroke of page.strokes) restored.send({ t: 'rs', ...stroke, restoreId, pageId: page.id });
      for (const tile of page.tiles) restored.send({ t: 'rs-tile', tile, restoreId, pageId: page.id });
      for (const piece of page.pieces) restored.send({ t: 'rs-piece', piece, restoreId, pageId: page.id });
      for (const offer of page.offers) restored.send({ t: 'rs-offer', offer, restoreId, pageId: page.id });
    }
    restored.send({ t: 'restored', restoreId, activePageId: active.pageId, tools: false });
    expect(await restored.take('board')).toMatchObject({ pageId: 'page-2', pageEpoch: 1, tiles: [{ id: 'second-tile' }] });
    const prior = await change(restored, { t: 'page:switch', id: DEFAULT_PAGE_ID });
    expect(prior).toMatchObject({ strokes: [{ id: 'ink' }], tiles: [{ id: 'tile-c' }], pieces: [{ id: 'face' }], offers: [{ id: 'offer-face' }], pictureIds: [pic] });
  });

  it('stages all restart-restored pages privately and commits their active board atomically', async () => {
    const { tutor, code, key, room } = await openRoom({ code: '7462', key: 'a'.repeat(32) });
    expect(room.restoring).toBe(true);
    const restoreId = 'restore-session';
    const pages = [{ id: DEFAULT_PAGE_ID, title: 'Review' }, { id: 'page-2', title: 'Practice' }];
    tutor.send({ t: 'pages:restore', pages, activePageId: 'page-2', restoreId });
    const { student, ack: studentAck } = await join(code);
    const pic = 'd'.repeat(32);
    const token = realtime.pictures.beginWrite(code, key);
    expect(realtime.pictures.add(image(code, key, pic, { writeToken: token })).status).toBe(201);
    tutor.send({ t: 'page:restore', id: DEFAULT_PAGE_ID, restoreId, pictureIds: [pic], lines: 'small', strip: false, boxes: 3, boxTaps: [1], boxEpoch: 4 });
    tutor.send({ t: 'rs', restoreId, pageId: DEFAULT_PAGE_ID, id: 'ink-1', by: 'tutor', tool: 'pen', pts: [100, 300, 200, 350] });
    tutor.send({ t: 'rs-tile', restoreId, pageId: DEFAULT_PAGE_ID, tile: { id: 'tile-1', text: 'm', x: 200, y: 350, hx: 200, hy: 350 } });
    tutor.send({ t: 'rs-piece', restoreId, pageId: DEFAULT_PAGE_ID, piece: { id: 'piece-1', pic, crop: fullCrop, x: 400, y: 350, w: 180 } });
    tutor.send({ t: 'rs-offer', restoreId, pageId: DEFAULT_PAGE_ID, offer: { id: 'offer-1', pic, crop: fullCrop, taken: true } });
    tutor.send({ t: 'restored', restoreId, activePageId: 'page-2', tools: true });
    await barrier(tutor, student, 'incomplete');
    expect(room.restoring).toBe(true); expect(room.pages.size).toBe(1);
    // Reconnecting during assembly gets no partial board or future source metadata.
    const { student: observer, board: waiting } = await join(code, studentAck.key);
    expect(waiting).toMatchObject({ strokes: [], tiles: [], pictures: [], pictureIds: [] });
    tutor.send({ t: 'page:restore', id: 'page-2', restoreId, boxes: 4, boxTaps: [2], boxEpoch: 8, game: { kind: 'phoneme', word: 'cat' } });
    tutor.send({ t: 'rs', restoreId: 'wrong', pageId: 'page-2', id: 'wrong-ink', by: 'tutor', tool: 'pen', pts: [1, 2] });
    tutor.send({ t: 'rs', restoreId, pageId: 'page-2', id: 'ink-2', by: 'student', tool: 'pen', pts: [300, 400] });
    tutor.send({ t: 'restored', restoreId, activePageId: 'page-2', tools: true });
    const complete = await tutor.take('board', msg => msg.reason === 'page');
    const shared = await observer.take('board', msg => msg.reason === 'page');
    for (const board of [complete, shared]) expect(board).toMatchObject({ pageId: 'page-2', pageEpoch: 1, pages, boxes: 4, boxTaps: [2], boxEpoch: 8, game: { kind: 'phoneme', word: 'cat' }, tools: true, strokes: [{ id: 'ink-2' }] });
    expect(shared.pictures).toEqual([]);
    const review = await change(tutor, { t: 'page:switch', id: DEFAULT_PAGE_ID });
    expect(review).toMatchObject({ lines: 'small', strip: false, boxes: 3, boxTaps: [1], strokes: [{ id: 'ink-1' }], tiles: [{ id: 'tile-1' }], pieces: [{ id: 'piece-1' }], offers: [{ id: 'offer-1', taken: true }], pictureIds: [pic] });
    tutor.send({ t: 'rs', restoreId, pageId: DEFAULT_PAGE_ID, id: 'too-late', by: 'tutor', tool: 'pen', pts: [1, 2] });
    await barrier(tutor, observer, 'finished');
    expect(room.strokes).toHaveLength(1); expect(room.restoreTransaction).toBeNull();
  });

  it('lets the same tutor retry an incomplete restore while rejecting obsolete batches and uploads', async () => {
    const { tutor, code, key, room } = await openRoom({ code: '7462', key: 'e'.repeat(32), pageProtocol: 1 });
    const { student } = await join(code);
    const pages = [{ id: DEFAULT_PAGE_ID, title: 'Review' }, { id: 'page-2', title: 'Read' }];
    const firstId = 'failed-attempt', retryId = 'retry-attempt';
    tutor.send({ t: 'pages:restore', pages, activePageId: 'page-2', restoreId: firstId });
    tutor.send({ t: 'page:restore', id: DEFAULT_PAGE_ID, restoreId: firstId });
    tutor.send({ t: 'rs', pageId: DEFAULT_PAGE_ID, restoreId: firstId, id: 'partial-ink', by: 'tutor', tool: 'pen', pts: [10, 300] });
    await barrier(tutor, student, 'partial');
    const first = room.restoreTransaction;
    expect(first.pages.get(DEFAULT_PAGE_ID).strokes).toHaveLength(1);
    const staleUpload = realtime.pictures.beginWrite(code, key, tutor.scope);
    // A duplicate begin is idempotent, and malformed or student retries cannot discard work.
    tutor.send({ t: 'pages:restore', pages, activePageId: 'page-2', restoreId: firstId });
    tutor.send({ t: 'pages:restore', pages: [{ id: 'bad id' }], activePageId: 'bad id', restoreId: retryId });
    student.send({ t: 'pages:restore', pages, activePageId: 'page-2', restoreId: retryId });
    await barrier(tutor, student, 'invalid-retries'); await barrier(student, tutor, 'student-retry');
    expect(room.restoreTransaction).toBe(first);
    // The tutor's valid retry replaces the unpublished draft after an image/import failure.
    tutor.send({ t: 'pages:restore', pages, activePageId: 'page-2', restoreId: retryId });
    await barrier(tutor, student, 'replacement');
    expect(room.restoreTransaction.id).toBe(retryId);
    expect(room.restoreTransaction.pages.get(DEFAULT_PAGE_ID).strokes).toEqual([]);
    expect(realtime.pictures.add(image(code, key, 'f'.repeat(32), { writeToken: staleUpload })).status).toBe(409);
    tutor.send({ t: 'page:restore', id: DEFAULT_PAGE_ID, restoreId: firstId, boxes: 5 });
    tutor.send({ t: 'rs', pageId: DEFAULT_PAGE_ID, restoreId: firstId, id: 'obsolete-ink', by: 'tutor', tool: 'pen', pts: [20, 300] });
    tutor.send({ t: 'restored', restoreId: firstId, activePageId: DEFAULT_PAGE_ID, tools: true });
    await barrier(tutor, student, 'obsolete-batch');
    expect(room.restoring).toBe(true); expect(room.pages.size).toBe(1);
    const pic = 'd'.repeat(32);
    expect(realtime.pictures.add(image(code, key, pic, { writeToken: realtime.pictures.beginWrite(code, key, tutor.scope) })).status).toBe(201);
    tutor.send({ t: 'page:restore', id: DEFAULT_PAGE_ID, restoreId: retryId, pictureIds: [pic], boxes: 3 });
    tutor.send({ t: 'rs-piece', pageId: DEFAULT_PAGE_ID, restoreId: retryId, piece: { id: 'retry-image', pic, crop: fullCrop, x: 300, y: 350, w: 180 } });
    tutor.send({ t: 'page:restore', id: 'page-2', restoreId: retryId });
    tutor.send({ t: 'rs', pageId: 'page-2', restoreId: retryId, id: 'retry-ink', by: 'tutor', tool: 'pen', pts: [30, 300] });
    tutor.send({ t: 'restored', restoreId: retryId, activePageId: 'page-2', tools: false });
    const complete = await tutor.take('board');
    expect(complete).toMatchObject({ pageId: 'page-2', pageEpoch: 1, tools: false, strokes: [{ id: 'retry-ink' }] });
    expect((await student.take('board', msg => msg.reason === 'page')).strokes.map(stroke => stroke.id)).toEqual(['retry-ink']);
    const review = await change(tutor, { t: 'page:switch', id: DEFAULT_PAGE_ID });
    expect(review).toMatchObject({ boxes: 3, strokes: [], pieces: [{ id: 'retry-image' }], pictureIds: [pic] });
  });

  it('bounds the deck, never deletes the last page, and keeps metadata changes at the same epoch', async () => {
    const { tutor, room } = await openRoom();
    tutor.page({ t: 'page:delete', id: DEFAULT_PAGE_ID });
    expect((await tutor.take('error')).reason).toBe('page-last');
    tutor.page({ t: 'page:rename', id: DEFAULT_PAGE_ID, title: 'New title' });
    expect(await tutor.take('pages')).toMatchObject({ pageEpoch: 0, pages: [{ id: DEFAULT_PAGE_ID, title: 'New title' }] });
    for (let index = 2; index <= MAX_PAGES; index++) await change(tutor, { t: 'page:add', id: `page-${index}` });
    tutor.page({ t: 'page:add', id: 'page-overflow' });
    expect((await tutor.take('error')).reason).toBe('page-limit');
    expect(room.pages.size).toBe(MAX_PAGES);
    const before = room.pageEpoch;
    tutor.page({ t: 'page:delete', id: DEFAULT_PAGE_ID });
    expect(await tutor.take('pages')).toMatchObject({ pageEpoch: before });
    const after = await change(tutor, { t: 'page:delete', id: room.pageId });
    expect(after.pageEpoch).toBe(before + 1); expect(room.pages.size).toBe(MAX_PAGES - 2);
  });

  it('applies the ink budget to the whole deck and refuses copies exceeding it', async () => {
    const { tutor, room } = await openRoom();
    room.strokes = Array.from({ length: 1999 }, (_, index) => ({ id: `s-${index}`, by: 'tutor', tool: 'pen', pts: [0, 300], seq: index, done: true }));
    await change(tutor, { t: 'page:add', id: 'page-2' });
    tutor.page({ t: 's', id: 'last', tool: 'pen', x: 100, y: 300 }); await tutor.take('ack');
    tutor.page({ t: 's', id: 'overflow', tool: 'pen', x: 100, y: 300 });
    expect((await tutor.take('error')).reason).toBe('board-full');
    tutor.page({ t: 'page:duplicate', id: DEFAULT_PAGE_ID, copyId: 'overflow-copy' });
    expect((await tutor.take('error')).reason).toBe('page-board-full');
    expect(room.pages.size).toBe(2); expect(room.strokes).toHaveLength(1);
  });
});

it('shares a tutor reading fit only with its current page activation', async () => {
  const { tutor, code } = await openRoom({ pageProtocol: 1 });
  await tutor.take('board');
  const { student } = await join(code);
  await change(tutor, { t: 'page:add', id: 'reading-page' });
  const origin = { ...tutor.scope };
  tutor.page({ t: 'focus', x: 200, y: 300, w: 300, h: 350, reading: true });
  expect(await student.take('focus')).toMatchObject({ t: 'focus', ...origin, x: 200, y: 300, w: 300, h: 350, reading: true });
  const beforeTutor = tutor.received.length;
  student.page({ t: 'focus', x: 0, y: 0, w: 500, h: 500, reading: true });
  await barrier(student, tutor, 'student-cannot-frame');
  expect(tutor.received.slice(beforeTutor).some(message => message.t === 'focus')).toBe(false);
  await change(tutor, { t: 'page:add' });
  const beforeStudent = student.received.length;
  tutor.page({ t: 'focus', x: 200, y: 300, w: 300, h: 350, reading: true }, origin);
  await barrier(tutor, student, 'old-reading-fit');
  expect(student.received.slice(beforeStudent).some(message => message.t === 'focus')).toBe(false);
});
