import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import WebSocket from 'ws';
import { attachRealtime } from './realtime.js';
import { TEACHING_MARKS } from '../shared/teachingMarks.js';
import { MAX_PICTURES, MAX_PIECES, nativePieceMetrics, pieceSize } from '../shared/pieces.js';

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
  sockets.forEach(socket => socket.terminate());
  realtime.close();
  await new Promise(resolve => server.close(resolve));
});
async function connect() {
  const ws = new WebSocket(address, { origin: ORIGIN }); sockets.push(ws);
  const inbox = [], received = [];
  const client = {
    ws, received, scope: null,
    send(message) { ws.send(JSON.stringify({ ...client.scope, ...message })); },
    async take(type, predicate = () => true) {
      const until = Date.now() + 2000;
      while (Date.now() < until) {
        const index = inbox.findIndex(message => message.t === type && predicate(message));
        if (index >= 0) return inbox.splice(index, 1)[0];
        await new Promise(resolve => setTimeout(resolve, 2));
      }
      throw new Error(`No ${type} response`);
    },
  };
  ws.on('message', raw => {
    const message = JSON.parse(raw);
    if (message.pageId !== undefined && ['room', 'board', 'pages'].includes(message.t)) client.scope = { pageId: message.pageId, pageEpoch: message.pageEpoch };
    inbox.push(message); received.push(message);
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return client;
}
async function open(previous = {}) {
  const tutor = await connect(); tutor.send({ t: 'create', pageProtocol: 1, ...previous });
  const room = await tutor.take('room');
  if (!room.restoring) await tutor.take('board');
  return { tutor, ...room };
}
async function join(room, key) {
  const student = await connect(); student.send({ t: 'join', code: room.code, ...(key && { key }), pageProtocol: 1 });
  const seat = await student.take('room'), board = await student.take('board');
  return { student, seat, board };
}
const markPiece = (id, mark = 'breve', extra = {}) => {
  const metrics = nativePieceMetrics({ kind: 'mark', mark });
  return { id, pic: null, crop: { x: 0, y: 0, w: metrics?.w || 64, h: metrics?.h || 28, r: 0 }, content: { kind: 'mark', mark }, x: 300, y: 400, ...extra };
};
async function add(room, id, mark = 'breve', extra) {
  room.tutor.send({ t: 'piece:add', piece: markPiece(id, mark, extra) });
  return (await room.tutor.take('piece:add', message => message.piece.id === id)).piece;
}
async function barrier(sender, receiver) {
  sender.send({ t: 'rtc:ready', id: 'processed' }); await receiver.take('rtc:ready');
}

describe('source-free teaching marks', () => {
  it('shares every reviewed mark without a source image or picture allocation', async () => {
    const room = await open(), { student } = await join(room);
    for (const mark of TEACHING_MARKS) {
      const piece = await add(room, `mark-${mark.id}`, mark.id, { arbitrary: 'discard me' });
      expect((await student.take('piece:add')).piece).toEqual(piece);
      expect(piece.content).toEqual({ kind: 'mark', mark: mark.id });
      expect(piece.pic).toBeNull(); expect(piece.arbitrary).toBeUndefined();
      expect({ w: piece.w, h: piece.h }).toEqual(pieceSize(piece.crop, undefined, piece.content));
    }
    const live = realtime.rooms.get(room.code);
    expect(live.pieces.size).toBe(TEACHING_MARKS.length);
    expect(live.pictures.size).toBe(0); expect([...live.pictureIds]).toEqual([]);
  });

  it('rejects forged marks, arbitrary native text and source-free student additions', async () => {
    const room = await open(), { student } = await join(room);
    room.tutor.send({ t: 'tools', on: true }); await student.take('tools');
    for (const [n, content] of [{ kind: 'mark', mark: 'script' }, { kind: 'mark', mark: '<svg>' }, { kind: 'text', text: 'answer' }].entries()) {
      room.tutor.send({ t: 'piece:add', piece: markPiece(`bad-${n}`, 'breve', { content }) });
    }
    await barrier(room.tutor, student);
    student.send({ t: 'piece:add', piece: markPiece('student-forgery') });
    await barrier(student, room.tutor);
    expect(realtime.rooms.get(room.code).pieces.size).toBe(0);
    expect(student.received.some(message => message.t === 'piece:add')).toBe(false);
  });

  it('keeps shared-piece movement available and gates proportional student resizing with tools', async () => {
    const room = await open(), { student } = await join(room);
    const original = await add(room, 'movable', 'breve'); await student.take('piece:add');
    student.send({ t: 'piece:grab', id: original.id });
    student.send({ t: 'piece:drop', id: original.id, x: 600, y: 500, w: 100 });
    await barrier(student, room.tutor);
    const movedWithoutTools = (await room.tutor.take('piece:drop')).piece;
    expect(movedWithoutTools).toMatchObject({ x: 600, y: 500, w: original.w, h: original.h, heldBy: null });
    expect((await student.take('piece:drop')).piece).toEqual(movedWithoutTools);
    await room.tutor.take('piece:grab'); await student.take('piece:grab');
    room.tutor.send({ t: 'tools', on: true }); await student.take('tools');
    student.send({ t: 'piece:grab', id: original.id }); await room.tutor.take('piece:grab');
    student.send({ t: 'piece:drop', id: original.id, x: 700, y: 550, w: 100 });
    const moved = (await room.tutor.take('piece:drop')).piece;
    expect(moved).toMatchObject({ pic: null, content: original.content, x: 700, y: 550, ...pieceSize(original.crop, 100, original.content), heldBy: null });
    expect((await student.take('piece:drop')).piece).toEqual(moved);
  });

  it('preserves independent marks when removing images, but Clear board removes them', async () => {
    const room = await open(), { student } = await join(room);
    const mark = await add(room, 'retained', 'macron'); await student.take('piece:add');
    const pic = 'a'.repeat(32);
    expect(realtime.pictures.add({ code: room.code, key: room.key, id: pic, w: 240, h: 240, type: 'image/jpeg', bytes: Buffer.alloc(100) }).status).toBe(201);
    await room.tutor.take('pic:add');
    room.tutor.send({ t: 'piece:add', piece: { id: 'photo', pic, crop: { x: 0, y: 0, w: 240, h: 240, r: 0 }, x: 500, y: 500, w: 160 } });
    await room.tutor.take('piece:add', message => message.piece.id === 'photo');
    room.tutor.send({ t: 'pieces:clear' });
    expect((await room.tutor.take('pieces')).pieces).toEqual([mark]);
    expect((await student.take('pieces')).pieces).toEqual([mark]);
    expect(realtime.rooms.get(room.code).pictures.size).toBe(0);
    room.tutor.send({ t: 'clear' });
    expect((await room.tutor.take('board', message => message.reason === 'clear')).pieces).toEqual([]);
    expect((await student.take('board', message => message.reason === 'clear')).pieces).toEqual([]);
  });

  it('keeps marks through duplication, reconnect, and source-free restart restoration', async () => {
    const room = await open(), { seat } = await join(room);
    const mark = await add(room, 'persistent', 'syllable-scoop', { w: 180 });
    room.tutor.send({ t: 'page:duplicate', id: room.pageId, copyId: 'copied-page' });
    const copied = await room.tutor.take('board', message => message.reason === 'page');
    expect(copied.pieces[0]).toMatchObject({ pic: null, content: mark.content, w: mark.w, h: mark.h });
    const returning = await join(room, seat.key);
    expect(returning.board.pieces).toEqual(copied.pieces);
    realtime.rooms.delete(room.code);
    const restored = await open({ code: room.code, key: room.key }); expect(restored.restoring).toBe(true);
    restored.tutor.send({ t: 'rs-piece', piece: mark });
    restored.tutor.send({ t: 'restored', tools: false, strip: true, boxes: 0 });
    const board = await restored.tutor.take('board');
    expect(board.pieces[0]).toMatchObject({ pic: null, content: mark.content, w: mark.w, h: mark.h });
    expect(board.pictures).toEqual([]);
    expect([...realtime.rooms.get(room.code).pictureIds]).toEqual([]);
  });

  it('does not consume picture slots and honors the shared board-piece limit', async () => {
    const room = await open();
    for (let n = 1; n <= MAX_PICTURES; n++) expect(realtime.pictures.add({ code: room.code, key: room.key, id: n.toString(16).repeat(32), w: 240, h: 240, type: 'image/jpeg', bytes: Buffer.alloc(100) }).status).toBe(201);
    for (let n = 0; n < MAX_PIECES; n++) await add(room, `bounded-${n}`, TEACHING_MARKS[n % TEACHING_MARKS.length].id);
    const { student } = await join(room);
    room.tutor.send({ t: 'piece:add', piece: markPiece('overflow') }); await barrier(room.tutor, student);
    expect(realtime.rooms.get(room.code).pieces.size).toBe(MAX_PIECES);
    expect(realtime.rooms.get(room.code).pictures.size).toBe(MAX_PICTURES);
  });
});
