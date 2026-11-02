import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import WebSocket from 'ws';
import { attachRealtime } from './realtime.js';
import { nativePieceMetrics, pieceSize } from '../shared/pieces.js';

const ORIGIN = 'http://localhost:8080';
const PIC = 'a'.repeat(32);
const CROP = { x: 200, y: 300, w: 275, h: 146, r: 0 };
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
  const ws = new WebSocket(address, { origin: ORIGIN });
  sockets.push(ws);
  const inbox = [], received = [];
  const client = {
    ws, received, scope: null,
    send: message => ws.send(JSON.stringify({ ...client.scope, ...message })),
    async take(type, predicate = () => true) {
      const until = Date.now() + 1500;
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
  const tutor = await connect();
  tutor.send({ t: 'create', pageProtocol: 1, ...previous });
  const room = await tutor.take('room');
  if (!room.restoring) await tutor.take('board');
  return { tutor, ...room };
}
async function join(room, key) {
  const student = await connect();
  student.send({ t: 'join', code: room.code, ...(key && { key }), pageProtocol: 1 });
  const seat = await student.take('room');
  const board = await student.take('board');
  return { student, seat, board };
}
async function seed(room) {
  expect(realtime.pictures.add({ code: room.code, key: room.key, id: PIC, w: 1600, h: 1700, type: 'image/png', bytes: Buffer.alloc(100) }).status).toBe(201);
  await room.tutor.take('pic:add');
}
const piece = (id, content, extra = {}) => ({ id, pic: PIC, crop: CROP, content, x: 300, y: 400, ...extra });

describe('native teaching piece transport and authorization', () => {
  it('shares clean native words and a small breve identically, then restores them for a late student', async () => {
    const room = await open();
    const { student, seat } = await join(room);
    await seed(room);
    for (const [id, content] of [['word', { kind: 'text', text: 'măt', font: 'untrusted' }], ['breve', { kind: 'breve' }]]) {
      room.tutor.send({ t: 'piece:add', piece: piece(id, content) });
      const expected = (await room.tutor.take('piece:add')).piece;
      expect((await student.take('piece:add')).piece).toEqual(expected);
      expect(expected.content).toEqual(id === 'word' ? { kind: 'text', text: 'măt' } : { kind: 'breve' });
      expect({ w: expected.w, h: expected.h }).toEqual(nativePieceMetrics(expected.content));
    }
    const returning = await join(room, seat.key);
    expect(returning.board.pieces.map(item => item.content)).toEqual([{ kind: 'text', text: 'măt' }, { kind: 'breve' }]);
    expect(realtime.rooms.get(room.code).pictures.size).toBe(1);
  });

  it('preserves native content through resize, crop, page duplication and restart recovery', async () => {
    const room = await open();
    await seed(room);
    room.tutor.send({ t: 'piece:add', piece: piece('breve', { kind: 'breve' }) });
    await room.tutor.take('piece:add');
    room.tutor.send({ t: 'piece:grab', id: 'breve' });
    await room.tutor.take('piece:grab');
    room.tutor.send({ t: 'piece:drop', id: 'breve', x: 400, y: 500, w: 32 });
    expect((await room.tutor.take('piece:drop')).piece).toMatchObject({ content: { kind: 'breve' }, w: 32, h: 14 });
    room.tutor.send({ t: 'piece:crop', id: 'breve', crop: { x: 210, y: 310, w: 50, h: 100 } });
    const changed = (await room.tutor.take('piece:drop')).piece;
    expect(changed).toMatchObject({ content: { kind: 'breve' }, w: 32, h: 14 });
    room.tutor.send({ t: 'page:duplicate', id: room.pageId, copyId: 'copied-page' });
    const copied = await room.tutor.take('board', message => message.reason === 'page');
    expect(copied.pieces[0]).toMatchObject({ content: { kind: 'breve' }, w: 32, h: 14 });
    realtime.rooms.delete(room.code);
    const restored = await open({ code: room.code, key: room.key });
    expect(restored.restoring).toBe(true);
    await seed(restored);
    restored.tutor.send({ t: 'rs-piece', piece: changed });
    restored.tutor.send({ t: 'restored', tools: false, strip: true, boxes: 0 });
    expect((await restored.tutor.take('board')).pieces[0]).toMatchObject({ content: { kind: 'breve' }, w: 32, h: 14 });
  });

  it('lets a student copy only the tutor-authorized native content and cannot turn a photo offer into text', async () => {
    const room = await open();
    const { student } = await join(room);
    await seed(room);
    room.tutor.send({ t: 'tools', on: true });
    await student.take('tools');
    for (const [id, content] of [['ink', { kind: 'breve' }], ['photo', undefined]]) {
      room.tutor.send({ t: 'offer:add', offer: { id, pic: PIC, crop: CROP, ...(content && { content }) } });
      await student.take('offer', message => message.offer.id === id);
      student.send({ t: 'piece:add', piece: piece(`copy-${id}`, { kind: 'text', text: 'forged answer' }, { offer: id, w: 100 }) });
      const copy = (await room.tutor.take('piece:add')).piece;
      expect(copy.content).toEqual(content);
      expect({ w: copy.w, h: copy.h }).toEqual(pieceSize(CROP, 100, content));
    }
    expect(realtime.rooms.get(room.code).pictures.size).toBe(1);
  });

  it('rejects malformed native data without adding a piece or leaking arbitrary fields', async () => {
    const room = await open();
    const { student } = await join(room);
    await seed(room);
    for (const [n, content] of [{ kind: 'text', text: '<script>' }, { kind: 'text', text: 'a'.repeat(129) }, { kind: 'unknown', text: 'a' }].entries()) room.tutor.send({ t: 'piece:add', piece: piece(`bad-${n}`, content) });
    room.tutor.send({ t: 'rtc:ready', id: 'processed' });
    await student.take('rtc:ready');
    expect(realtime.rooms.get(room.code).pieces.size).toBe(0);
    expect(student.received.some(message => message.t === 'piece:add')).toBe(false);
  });

  it('honors a tutor tile drop position while keeping its tray home and ordinary default placement', async () => {
    const room = await open();
    room.tutor.send({ t: 'tile:add', tiles: [{ id: 'dropped', text: 'a', x: 420, y: 320 }, { id: 'tray', text: 'm' }] });
    const { tiles } = await room.tutor.take('tile:add');
    expect(tiles[0]).toMatchObject({ x: 420, y: 320, hx: 48 });
    expect(tiles[0].hy).not.toBe(320);
    expect(tiles[1]).toMatchObject({ x: tiles[1].hx, y: tiles[1].hy });
  });
});
