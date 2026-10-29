import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import WebSocket from 'ws';
import { createApp } from './index.js';
import { attachRealtime } from './realtime.js';

const JPEG = Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(100)]);

// Exercise the upload route and the shared room data together: a worksheet's label
// organizes materials, but cannot grant a student extra permissions or upload rights.
describe('lesson material metadata', () => {
  let server, realtime, origin;
  const clients = [];
  beforeEach(async () => {
    let rooms;
    const pictures = {
      beginWrite: (...args) => rooms.pictures.beginWrite(...args),
      add: (upload) => rooms.pictures.add(upload),
      get: (...args) => rooms.pictures.get(...args),
    };
    server = http.createServer(createApp({ pictures }));
    const allowedOrigins = new Set();
    realtime = rooms = attachRealtime(server, { allowedOrigins, tutorGraceMs: 2000 });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    allowedOrigins.add(origin);
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) client.ws.terminate();
    realtime.close();
    server.closeIdleConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  async function connect() {
    const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/ws`, { origin });
    const messages = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const client = {
      ws,
      send: (message) => ws.send(JSON.stringify(message)),
      take: async (type) => {
        for (let n = 0; n < 200; n += 1) {
          const index = messages.findIndex((message) => message.t === type);
          if (index >= 0) return messages.splice(index, 1)[0];
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error(`Missing ${type}`);
      },
    };
    clients.push(client);
    return client;
  }
  async function roomWithStudent() {
    const tutor = await connect();
    tutor.send({ t: 'create' });
    const room = await tutor.take('room');
    const student = await connect();
    student.send({ t: 'join', code: room.code });
    const seat = await student.take('room');
    await student.take('board');
    return { tutor, student, room, seat };
  }
  const upload = (room, id, metadata = {}) => fetch(`${origin}/api/rooms/${room.code}/pictures/${id}?${new URLSearchParams({ w: '1200', h: '900', ...metadata })}`, {
    method: 'POST', headers: { 'x-room-key': room.key, 'content-type': 'image/jpeg' }, body: JPEG,
  });

  it('shares worksheet classification and filename on upload and student reconnect, without giving parts', async () => {
    const { tutor, student, room, seat } = await roomWithStudent();
    const id = 'a'.repeat(32);
    expect((await upload(room, id, { material: 'worksheet', title: 'Short a passage.jpg' })).status).toBe(201);
    for (const client of [tutor, student]) {
      expect((await client.take('pic:add')).pic).toMatchObject({ id, material: 'worksheet', title: 'Short a passage.jpg' });
    }
    const returning = await connect();
    returning.send({ t: 'join', code: room.code, key: seat.key });
    await returning.take('room');
    const board = await returning.take('board');
    expect(board.pictures).toContainEqual(expect.objectContaining({ id, material: 'worksheet', title: 'Short a passage.jpg' }));
    expect(board.offers).toEqual([]);
    expect(board.pieces).toEqual([]);
    const image = await fetch(`${origin}/api/rooms/${room.code}/pictures/${id}`);
    expect(image.status).toBe(200);
    expect(Buffer.from(await image.arrayBuffer())).toEqual(JPEG);
  });

  it('keeps old uploads as ordinary pictures and sanitizes untrusted labels', async () => {
    const { tutor, room } = await roomWithStudent();
    expect((await upload(room, 'b'.repeat(32), { material: 'answers', title: '\u0000  ' + 'x'.repeat(200) + '\n' })).status).toBe(201);
    const picture = (await tutor.take('pic:add')).pic;
    expect(picture.material).not.toBe('worksheet');
    expect(picture.title).toBe('x'.repeat(120));
    expect((await upload(room, 'c'.repeat(32))).status).toBe(201);
    const legacy = (await tutor.take('pic:add')).pic;
    expect(legacy.material).not.toBe('worksheet');
  });

  it('refuses student uploads even when their tools are enabled', async () => {
    const { tutor, room, seat } = await roomWithStudent();
    tutor.send({ t: 'tools', on: true });
    expect((await upload({ code: room.code, key: seat.key }, 'd'.repeat(32), { material: 'worksheet', title: 'Answer sheet' })).status).toBe(403);
    expect(realtime.rooms.get(room.code).pictures.size).toBe(0);
  });

  it('counts ordinary pictures and worksheets against the same session upload limit', async () => {
    const { room } = await roomWithStudent();
    for (let n = 1; n <= 8; n += 1) {
      expect((await upload(room, n.toString(16).padStart(32, '0'), { ...(n % 2 ? { material: 'worksheet' } : {}), title: `Material ${n}` })).status).toBe(201);
    }
    expect((await upload(room, 'f'.repeat(32), { material: 'worksheet', title: 'Ninth upload' })).status).toBe(409);
    expect(realtime.rooms.get(room.code).pictures.size).toBe(8);
  });

  it('crops the existing picture piece in place on both screens', async () => {
    const { tutor, student, room } = await roomWithStudent();
    const pic = 'e'.repeat(32);
    expect((await upload(room, pic, { material: 'worksheet', title: 'Passage' })).status).toBe(201);
    await tutor.take('pic:add'); await student.take('pic:add');
    tutor.send({ t: 'piece:add', piece: { id: 'crop-piece-1', pic, x: 150, y: 360, w: 240, crop: { x: 0, y: 0, w: 1200, h: 900 } } });
    const before = (await tutor.take('piece:add')).piece;
    await student.take('piece:add');
    const crop = { x: 10, y: 20, w: 300, h: 600, r: 0 };
    tutor.send({ t: 'piece:crop', id: before.id, crop });
    for (const client of [tutor, student]) {
      const after = (await client.take('piece:drop')).piece;
      expect(after).toMatchObject({ id: before.id, pic, z: before.z, crop, w: before.w, h: before.w * 2 });
    }
    expect(realtime.rooms.get(room.code).pictures.size).toBe(1);
    expect(realtime.rooms.get(room.code).pieces.size).toBe(1);
  });

  it('rejects student and out-of-source crops without changing the original', async () => {
    const { tutor, student, room, seat } = await roomWithStudent();
    const pic = 'e'.repeat(32);
    await upload(room, pic); await tutor.take('pic:add'); await student.take('pic:add');
    tutor.send({ t: 'piece:add', piece: { id: 'crop-piece-2', pic, x: 150, y: 360, w: 240, crop: { x: 0, y: 0, w: 1200, h: 900 } } });
    const before = (await tutor.take('piece:add')).piece; await student.take('piece:add');
    tutor.send({ t: 'tools', on: true });
    student.send({ t: 'piece:crop', id: before.id, crop: { x: 10, y: 20, w: 200, h: 200 } });
    student.send({ t: 'join', code: room.code, key: seat.key }); await student.take('room');
    expect((await student.take('board')).pieces).toContainEqual(before);
    tutor.send({ t: 'piece:crop', id: before.id, crop: { x: 1190, y: 0, w: 100, h: 100 } });
    tutor.send({ t: 'create', code: room.code, key: room.key }); await tutor.take('room');
    expect((await tutor.take('board')).pieces).toContainEqual(before);
  });

});
