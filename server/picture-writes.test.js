import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import WebSocket from 'ws';
import { createApp } from './index.js';
import { attachRealtime } from './realtime.js';

const JPEG = Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(100)]);
const ID = 'a'.repeat(32);
const card = { bytes: JPEG, w: 1200, h: 1200, title: 'Test card' };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

// Exercise real HTTP body parsing and WebSocket room lifecycle together. A late
// response must neither restore the picture nor announce it to either browser.
describe('asynchronous lesson picture writes', () => {
  let server, realtime, origin, imageStarted, imageResult, writeStarted;
  const clients = [];

  beforeEach(async () => {
    imageStarted = deferred();
    imageResult = deferred();
    writeStarted = deferred();
    const pictures = {
      beginWrite: (code, key) => {
        const token = realtime.pictures.beginWrite(code, key);
        writeStarted.resolve();
        return token;
      },
      add: (upload) => realtime.pictures.add(upload),
      get: (code, id) => realtime.pictures.get(code, id),
      isTutor: (code, key) => realtime.pictures.isTutor(code, key),
    };
    const library = {
      list: async () => [],
      image: async () => {
        imageStarted.resolve();
        return imageResult.promise;
      },
    };
    server = http.createServer(createApp({ pictures, library }));
    const allowedOrigins = new Set();
    realtime = attachRealtime(server, { allowedOrigins, tutorGraceMs: 2000 });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    allowedOrigins.add(origin);
  });

  afterEach(async () => {
    imageResult.resolve(card);
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
      ws, messages,
      send: (msg) => ws.send(JSON.stringify(msg)),
      take: async (type) => {
        for (let i = 0; i < 200; i += 1) {
          const index = messages.findIndex((msg) => msg.t === type);
          if (index >= 0) return messages.splice(index, 1)[0];
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error(`Missing ${type}`);
      },
    };
    clients.push(client);
    return client;
  }

  async function openRoom(previous) {
    const tutor = await connect();
    tutor.send({ t: 'create', ...(previous && { code: previous.code, key: previous.key }) });
    const room = await tutor.take('room');
    return { tutor, ...room };
  }

  async function startCopy(room) {
    const response = fetch(`${origin}/api/rooms/${room.code}/pictures/${ID}/from-library/test-card`, {
      method: 'POST', headers: { 'x-room-key': room.key },
    });
    await imageStarted.promise;
    return { response };
  }

  function expectNoPicture(room) {
    expect(realtime.rooms.get(room.code)?.pictures.size).toBe(0);
    for (const client of clients) expect(client.messages.some((msg) => msg.t === 'pic:add')).toBe(false);
  }

  it('commits a current copy and broadcasts it once', async () => {
    const room = await openRoom();
    const { response } = await startCopy(room);
    imageResult.resolve(card);
    expect((await response).status).toBe(201);
    expect((await room.tutor.take('pic:add')).pic.id).toBe(ID);
    expect(realtime.rooms.get(room.code).pictures.size).toBe(1);
  });

  it('rejects a delayed library copy after clearing pictures', async () => {
    const room = await openRoom();
    const { response } = await startCopy(room);
    room.tutor.send({ t: 'pieces:clear' });
    await room.tutor.take('pieces');
    imageResult.resolve(card);
    expect((await response).status).toBe(409);
    expectNoPicture(room);
  });

  it('rejects a delayed library copy after the tutor disconnects and rejoins', async () => {
    const room = await openRoom();
    const { response } = await startCopy(room);
    await new Promise((resolve) => { room.tutor.ws.once('close', resolve); room.tutor.ws.close(); });
    const next = await openRoom(room);
    expect(next.code).toBe(room.code);
    expect(next.key).toBe(room.key);
    imageResult.resolve(card);
    expect((await response).status).toBe(409);
    expectNoPicture(next);
  });

  it('rejects a delayed library copy when another tutor connection takes the seat', async () => {
    const room = await openRoom();
    const { response } = await startCopy(room);
    const next = await openRoom(room);
    imageResult.resolve(card);
    expect((await response).status).toBe(409);
    expectNoPicture(next);
  });

  it.each(['same key', 'new key'])('rejects a delayed copy when a room code is recreated with the %s', async (reuse) => {
    const room = await openRoom();
    const { response } = await startCopy(room);
    room.tutor.send({ t: 'end' });
    await room.tutor.take('closed');
    const next = await openRoom({ code: room.code, key: reuse === 'same key' ? room.key : 'b'.repeat(32) });
    expect(next.code).toBe(room.code);
    expect(next.key === room.key).toBe(reuse === 'same key');
    imageResult.resolve(card);
    expect((await response).status).toBe(409);
    expectNoPicture(next);
  });

  it('captures upload identity before the body finishes arriving', async () => {
    const room = await openRoom();
    let upload;
    const response = new Promise((resolve, reject) => {
      upload = http.request(`${origin}/api/rooms/${room.code}/pictures/${ID}?w=1200&h=1200`, {
        method: 'POST', headers: { 'x-room-key': room.key, 'content-type': 'image/jpeg', 'content-length': JPEG.length },
      }, (res) => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
      upload.once('error', reject);
      upload.write(JPEG.subarray(0, 1));
    });
    await writeStarted.promise;
    room.tutor.send({ t: 'pieces:clear' });
    await room.tutor.take('pieces');
    upload.end(JPEG.subarray(1));
    expect(await response).toBe(409);
    expectNoPicture(room);
  });

  it('accepts a new request made after a clear', async () => {
    const room = await openRoom();
    room.tutor.send({ t: 'pieces:clear' });
    await room.tutor.take('pieces');
    const { response } = await startCopy(room);
    imageResult.resolve(card);
    expect((await response).status).toBe(201);
    expect(realtime.rooms.get(room.code).pictures.size).toBe(1);
  });
});
