import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import WebSocket from 'ws';
import { createHmac } from 'node:crypto';
import { attachRealtime } from './realtime.js';

const ORIGIN = 'http://localhost:8080';
let server;
let realtime;
let url;

beforeAll(async () => {
  server = http.createServer((req, res) => res.end());
  realtime = attachRealtime(server, { allowedOrigins: new Set([ORIGIN]), tutorGraceMs: 150, joinAttemptsPerWindow: 1000, maxRoomsPerIp: 1000, turn: { host: 'turn.example', secret: 'test-secret', tls: true } });
  await new Promise((resolve) => server.listen(0, resolve));
  url = `ws://localhost:${server.address().port}/ws`;
});

afterAll(() => {
  realtime.close();
  server.close();
});

// Waits for (and removes) the first message of a given type.
function take(inbox, type, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const i = inbox.findIndex((m) => m.t === type);
      if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
      if (Date.now() - started > timeout) return reject(new Error(`no '${type}' message`));
      setTimeout(check, 5);
    };
    check();
  });
}

function connect(origin = ORIGIN, target = url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target, { origin });
    const inbox = [];
    ws.on('message', (data) => inbox.push(JSON.parse(data.toString())));
    ws.once('error', reject);
    ws.once('open', () =>
      resolve({
        ws,
        send: (msg) => ws.send(JSON.stringify(msg)),
        take: (type, timeout) => take(inbox, type, timeout),
      }),
    );
  });
}

async function openRoom() {
  const tutor = await connect();
  tutor.send({ t: 'create' });
  const room = await tutor.take('room');
  await tutor.take('presence');
  return { tutor, ...room };
}

async function joinRoom(code, key) {
  const student = await connect();
  student.send({ t: 'join', code, key });
  const room = await student.take('room');
  const board = await student.take('board');
  return { student, key: room.key, board };
}

async function withTools() {
  const { tutor, code, key } = await openRoom();
  const { student } = await joinRoom(code);
  tutor.send({ t: 'tools', on: true });
  await student.take('tools');
  return { tutor, student, code, key };
}

// For things the server must ignore: no message of this type turns up.
const nothing = (client, type) => expect(client.take(type, 150)).rejects.toThrow();

describe('whiteboard rooms', () => {
  it('only accepts connections from this site', async () => {
    await expect(connect('https://somewhere-else.example')).rejects.toThrow('403');
  });

  it('relays pointers both ways, clamped, with the letter and the tool', async () => {
    const { tutor, code } = await openRoom();
    expect(code).toMatch(/^[0-9]{4}$/);
    const { student } = await joinRoom(code);
    expect(await tutor.take('presence')).toMatchObject({ tutor: true, student: true });

    student.send({ t: 'p', x: 0.48, y: 1.7, l: 'M', m: 'hand' });
    expect(await tutor.take('p')).toEqual({ t: 'p', x: 0.48, y: 1, l: 'M', m: 'hand' });

    student.send({ t: 'p', x: 0.1, y: 0.1, l: 'not a letter' });
    expect((await tutor.take('p')).l).toBeNull();

    tutor.send({ t: 'p', x: 0.5, y: 0.5, m: 'pen' });
    expect(await student.take('p')).toMatchObject({ x: 0.5, y: 0.5, l: null, m: 'pen' });
    tutor.send({ t: 'p', m: 'none' });
    expect(await student.take('p')).toEqual({ t: 'p', m: 'none' });
  });

  it('keeps a second student out but lets the first one take their seat back', async () => {
    const { code } = await openRoom();
    const first = await joinRoom(code);

    const intruder = await connect();
    intruder.send({ t: 'join', code });
    expect((await intruder.take('error')).reason).toBe('room-full');

    const back = await joinRoom(code, first.key);
    expect(back.key).toBe(first.key);
  });

  it('says so when a code does not exist', async () => {
    const student = await connect();
    student.send({ t: 'join', code: '0000' });
    expect((await student.take('error')).reason).toBe('no-room');
  });

  it('closes the room when the tutor ends it, or leaves and does not come back', async () => {
    const ended = await openRoom();
    const s1 = await joinRoom(ended.code);
    ended.tutor.send({ t: 'end' });
    expect((await s1.student.take('closed')).reason).toBe('ended');

    const left = await openRoom();
    const s2 = await joinRoom(left.code);
    left.tutor.ws.close();
    expect((await s2.student.take('closed', 2000)).reason).toBe('tutor-left');
  });
});

describe('drawing', () => {
  it('keeps the student off the board until the tutor turns tools on', async () => {
    const { tutor, code } = await openRoom();
    const { student } = await joinRoom(code);

    student.send({ t: 's', id: 'early', tool: 'pen', x: 100, y: 300 });
    await nothing(tutor, 's');

    tutor.send({ t: 'tools', on: true });
    expect(await student.take('tools')).toEqual({ t: 'tools', on: true });

    student.send({ t: 's', id: 's1', tool: 'pen', x: 100, y: 300 });
    expect(await tutor.take('s')).toMatchObject({ id: 's1', by: 'student', tool: 'pen', x: 100, y: 300 });
    expect((await student.take('ack')).id).toBe('s1');
    student.send({ t: 'm', id: 's1', pts: [150, 320, 5000, -20] });
    expect((await tutor.take('m')).pts).toEqual([150, 320, 1600, 0]);
    student.send({ t: 'e', id: 's1' });
    expect(await tutor.take('e')).toEqual({ t: 'e', id: 's1' });
  });

  it('lets each person undo only their own strokes', async () => {
    const { tutor, student } = await withTools();
    tutor.send({ t: 's', id: 't1', tool: 'pen', x: 200, y: 300 });
    tutor.send({ t: 'e', id: 't1' });
    student.send({ t: 's', id: 's1', tool: 'pen', x: 300, y: 300 });
    student.send({ t: 'e', id: 's1' });
    await tutor.take('e');
    await student.take('e');

    student.send({ t: 'undo' });
    expect((await tutor.take('undo')).id).toBe('s1');
    expect((await student.take('undo')).id).toBe('s1');

    student.send({ t: 'undo' }); // nothing of theirs is left
    await nothing(tutor, 'undo');

    tutor.send({ t: 'undo' });
    expect((await student.take('undo')).id).toBe('t1');
  });

  it('keeps erasing in order, so undoing an erase brings the ink back', async () => {
    const { tutor, code } = await openRoom();
    tutor.send({ t: 's', id: 'ink', tool: 'pen', x: 400, y: 400 });
    tutor.send({ t: 'm', id: 'ink', pts: [500, 400] });
    tutor.send({ t: 'e', id: 'ink' });
    tutor.send({ t: 's', id: 'rub', tool: 'eraser', x: 450, y: 400 });
    tutor.send({ t: 'e', id: 'rub' });
    await tutor.take('ack');
    await tutor.take('ack');

    const first = await joinRoom(code);
    expect(first.board.strokes.map((s) => [s.id, s.tool])).toEqual([
      ['ink', 'pen'],
      ['rub', 'eraser'],
    ]);

    tutor.send({ t: 'undo' });
    expect((await first.student.take('undo')).id).toBe('rub');

    const again = await joinRoom(code, first.key);
    expect(again.board.strokes.map((s) => s.id)).toEqual(['ink']);
    expect(again.board.strokes[0].pts).toEqual([400, 400, 500, 400]);
  });

  it('stops the student mid-stroke when the tutor turns tools off', async () => {
    const { tutor, student } = await withTools();
    student.send({ t: 's', id: 's1', tool: 'pen', x: 100, y: 300 });
    await tutor.take('s');

    tutor.send({ t: 'tools', on: false });
    expect(await tutor.take('e')).toEqual({ t: 'e', id: 's1' });
    expect(await student.take('tools')).toEqual({ t: 'tools', on: false });

    student.send({ t: 'm', id: 's1', pts: [120, 320] });
    student.send({ t: 'undo' });
    await nothing(tutor, 'm');
    await nothing(tutor, 'undo');
  });

  it('clears the board for both, and only the tutor can', async () => {
    const { tutor, student } = await withTools();
    tutor.send({ t: 's', id: 't1', tool: 'pen', x: 200, y: 300 });
    await student.take('s');

    student.send({ t: 'clear' });
    await nothing(student, 'board');

    tutor.send({ t: 'clear' });
    expect((await student.take('board')).strokes).toEqual([]);
    expect((await tutor.take('board')).strokes).toEqual([]);
  });

  it('gets the board back from the tutor after a restart', async () => {
    const { tutor, student, code, key } = await withTools();
    tutor.send({ t: 's', id: 't1', tool: 'pen', x: 200, y: 300 });
    student.send({ t: 's', id: 's1', tool: 'pen', x: 300, y: 300 });
    await tutor.take('s');
    await student.take('s');

    realtime.rooms.delete(code); // the server restarts and forgets everything
    tutor.ws.close();
    student.ws.close();

    const back = await connect();
    back.send({ t: 'create', code, key });
    expect(await back.take('room')).toMatchObject({ code, key, fresh: true });
    back.send({ t: 'rs', id: 't1', by: 'tutor', tool: 'pen', pts: [200, 300] });
    back.send({ t: 'rs', id: 's1', by: 'student', tool: 'pen', pts: [300, 300] });
    back.send({ t: 'restored', tools: true });
    const board = await back.take('board');
    expect(board.tools).toBe(true);
    expect(board.strokes.map((s) => [s.id, s.by])).toEqual([
      ['t1', 'tutor'],
      ['s1', 'student'],
    ]);

    const rejoined = await joinRoom(code);
    expect(rejoined.board.strokes).toHaveLength(2);
    expect(rejoined.board.tools).toBe(true);
  });
});

describe('pointers', () => {
  it('shares two hands: the right one out to start, both on the board for whoever joins', async () => {
    const { code } = await openRoom();
    const { board } = await joinRoom(code);
    expect(board.hands.r).toMatchObject({ on: true, by: null });
    expect(board.hands.l).toMatchObject({ on: false, by: null });
  });

  it('lets whoever holds a hand move it, and the tutor take one back from the student', async () => {
    const { tutor, code } = await openRoom();
    const { student } = await joinRoom(code);
    student.send({ t: 'hand', side: 'r', a: 'grab' }); // no tools yet: nothing
    await nothing(tutor, 'hand');
    tutor.send({ t: 'tools', on: true });
    await student.take('tools');
    student.send({ t: 'hands', l: true });
    expect((await tutor.take('hands')).hands.l.on).toBe(true);
    student.send({ t: 'hand', side: 'l', a: 'grab' });
    expect(await tutor.take('hand')).toMatchObject({ side: 'l', by: 'student' });
    expect(await student.take('hand')).toMatchObject({ side: 'l', by: 'student' }); // both screens hear who holds it
    student.send({ t: 'hand', side: 'l', a: 'move', x: 0.3, y: 0.05, letter: 'B' });
    expect(await tutor.take('hand')).toMatchObject({ side: 'l', x: 0.3, y: 0.05, letter: 'B', by: 'student' });
    tutor.send({ t: 'hand', side: 'l', a: 'grab' }); // the tutor takes it mid-drag
    expect(await student.take('hand')).toMatchObject({ side: 'l', by: 'tutor' });
    expect(await tutor.take('hand')).toMatchObject({ side: 'l', by: 'tutor' });
    student.send({ t: 'hand', side: 'l', a: 'move', x: 0.9, y: 0.9 }); // no longer theirs
    await nothing(tutor, 'hand');
    student.send({ t: 'hand', side: 'l', a: 'grab' }); // and they can't take it back
    expect(await student.take('hand')).toMatchObject({ side: 'l', by: 'tutor' });
    tutor.send({ t: 'hand', side: 'l', a: 'drop' });
    expect(await student.take('hand')).toMatchObject({ side: 'l', by: null, x: 0.3, letter: 'B' });
  });

  it('lets go of the student’s hand when their tools go off or they leave', async () => {
    const { tutor, code } = await openRoom();
    const { student } = await joinRoom(code);
    tutor.send({ t: 'tools', on: true });
    await student.take('tools');
    student.send({ t: 'hand', side: 'r', a: 'grab' });
    expect(await tutor.take('hand')).toMatchObject({ side: 'r', by: 'student' });
    tutor.send({ t: 'tools', on: false });
    expect(await tutor.take('hand')).toMatchObject({ side: 'r', by: null });
    student.send({ t: 'hands', r: false }); // tools off: they can't switch hands either
    await nothing(tutor, 'hands');
  });

  it('shows a returning tutor where the student is pointing', async () => {
    const { tutor, code, key } = await openRoom();
    const { student } = await joinRoom(code);
    student.send({ t: 'p', x: 0.3, y: 0.08, l: 'H', m: 'hand' });
    await tutor.take('p');

    const back = await connect(); // the tutor refreshes: same code and key, new connection
    back.send({ t: 'create', code, key });
    await back.take('room');
    expect(await back.take('p')).toMatchObject({ x: 0.3, y: 0.08, l: 'H', m: 'hand' });
  });
});

describe('letter tiles', () => {
  let n = 0;
  const addTiles = async (tutor, texts) => {
    tutor.send({ t: 'tile:add', tiles: texts.map((text) => ({ id: `tile${(n += 1)}`, text })) });
    return (await tutor.take('tile:add')).tiles;
  };

  it('only the tutor adds tiles, and they line up on the tray for both', async () => {
    const { tutor, code } = await openRoom();
    const { student } = await joinRoom(code);
    student.send({ t: 'tile:add', tiles: [{ id: 'sneaky', text: 'z' }] });
    await nothing(tutor, 'tile:add');

    const tiles = await addTiles(tutor, ['sh', 'i', 'p', 'bad!']);
    expect(tiles.map((t) => [t.text, t.kind])).toEqual([
      ['sh', 'team'],
      ['i', 'vowel'],
      ['p', 'consonant'],
    ]);
    expect(tiles.every((t) => t.y === 848 && t.x === t.hx)).toBe(true);
    expect((await student.take('tile:add')).tiles).toHaveLength(3);
  });

  it('streams a drag live, and holds the tile for whoever is dragging it', async () => {
    const { tutor, code } = await openRoom();
    const { student } = await joinRoom(code);
    const [tile] = await addTiles(tutor, ['c']);
    await student.take('tile:add');

    student.send({ t: 'tile:grab', id: tile.id });
    expect(await tutor.take('tile:grab')).toMatchObject({ id: tile.id, by: 'student' });
    student.send({ t: 'tile:move', id: tile.id, x: 600, y: 600 });
    expect(await tutor.take('tile:move')).toEqual({ t: 'tile:move', id: tile.id, x: 600, y: 600 });

    tutor.send({ t: 'tile:grab', id: tile.id }); // the student has it
    expect((await tutor.take('tile:denied')).tile.heldBy).toBe('student');
    tutor.send({ t: 'tile:move', id: tile.id, x: 100, y: 100 });
    await nothing(student, 'tile:move');

    student.send({ t: 'tile:drop', id: tile.id, x: 5000, y: 610 });
    expect((await tutor.take('tile:drop')).tile).toMatchObject({ x: 1576 - 84, y: 610, heldBy: null });
  });

  it('snaps a tile into a free sound box when it is dropped there', async () => {
    const { tutor } = await openRoom();
    tutor.send({ t: 'boxes:set', count: 3 });
    expect((await tutor.take('boxes:set')).count).toBe(3);
    const [sh, i] = await addTiles(tutor, ['sh', 'i']);

    tutor.send({ t: 'tile:grab', id: sh.id });
    tutor.send({ t: 'tile:drop', id: sh.id, x: 500, y: 240 });
    expect((await tutor.take('tile:drop')).tile).toMatchObject({ x: 514, y: 225 });

    tutor.send({ t: 'tile:grab', id: i.id });
    tutor.send({ t: 'tile:drop', id: i.id, x: 520, y: 230 }); // same box, already taken
    expect((await tutor.take('tile:drop')).tile).toMatchObject({ x: 520, y: 230 });
  });

  it('keeps tile management and board settings with the tutor', async () => {
    const { tutor, code } = await openRoom();
    const { student } = await joinRoom(code);
    const [m, a] = await addTiles(tutor, ['m', 'a', 'p']);

    for (const msg of [
      { t: 'tile:delete', id: m.id },
      { t: 'tiles:clear' },
      { t: 'tiles:reset' },
      { t: 'strip:set', on: false },
      { t: 'boxes:set', count: 4 },
      { t: 'tile:edit', id: m.id, text: 'x' },
    ]) {
      student.send(msg);
    }
    await nothing(tutor, 'tile:delete');
    await nothing(tutor, 'tiles');
    await nothing(tutor, 'strip:set');

    tutor.send({ t: 'tile:edit', id: a.id, text: 'o' }); // map becomes mop
    expect((await student.take('tile:edit')).tile).toMatchObject({ id: a.id, text: 'o', kind: 'vowel' });
    tutor.send({ t: 'tile:delete', id: m.id });
    expect((await student.take('tile:delete')).id).toBe(m.id);
    tutor.send({ t: 'tiles:reset' });
    expect((await student.take('tiles')).tiles.map((t) => [t.text, t.x])).toEqual([
      ['o', 48],
      ['p', 148],
    ]);
    tutor.send({ t: 'strip:set', on: false });
    expect(await student.take('strip:set')).toEqual({ t: 'strip:set', on: false });
    tutor.send({ t: 'tiles:clear' });
    expect((await student.take('tiles')).tiles).toEqual([]);
  });

  it('gives late joiners the tiles and settings, and gets them back after a restart', async () => {
    const { tutor, code, key } = await openRoom();
    tutor.send({ t: 'strip:set', on: false });
    tutor.send({ t: 'boxes:set', count: 3 });
    const [tile] = await addTiles(tutor, ['ck']);
    const late = await joinRoom(code);
    expect(late.board).toMatchObject({ strip: false, boxes: 3 });
    expect(late.board.tiles.map((t) => t.text)).toEqual(['ck']);

    realtime.rooms.delete(code); // the server restarts and forgets everything
    late.student.ws.close();
    const back = await connect();
    back.send({ t: 'create', code, key });
    expect(await back.take('room')).toMatchObject({ fresh: true });
    back.send({ t: 'rs-tile', tile });
    back.send({ t: 'restored', tools: false, strip: false, boxes: 3 });
    const board = await back.take('board');
    expect(board).toMatchObject({ strip: false, boxes: 3 });
    expect(board.tiles.map((t) => [t.text, t.x, t.y])).toEqual([['ck', tile.x, tile.y]]);
  });
});

describe('video call setup', () => {
  it('passes call setup between the two people in a room, and nobody else', async () => {
    const { tutor, code } = await openRoom();
    const { student } = await joinRoom(code);
    const outsider = await openRoom();

    tutor.send({ t: 'rtc:ready' });
    expect(await student.take('rtc:ready')).toEqual({ t: 'rtc:ready' });

    const offer = { type: 'offer', sdp: 'v=0 fake offer' };
    student.send({ t: 'rtc:description', description: offer });
    expect((await tutor.take('rtc:description')).description).toEqual(offer);

    const candidate = { candidate: 'candidate:1 1 udp 2122260223 192.0.2.1 54400 typ host', sdpMid: '0', sdpMLineIndex: 0 };
    tutor.send({ t: 'rtc:candidate', candidate });
    expect((await student.take('rtc:candidate')).candidate).toMatchObject(candidate);
    await nothing(outsider.tutor, 'rtc:candidate');
  });

  it('drops malformed or oversized call messages', async () => {
    const { tutor, code } = await openRoom();
    const { student } = await joinRoom(code);
    tutor.send({ t: 'rtc:description', description: { type: 'offer', sdp: 'x'.repeat(20001) } });
    tutor.send({ t: 'rtc:description', description: { type: 'pranswer', sdp: 'v=0' } });
    tutor.send({ t: 'rtc:candidate', candidate: { candidate: 42 } });
    await nothing(student, 'rtc:description');
    await nothing(student, 'rtc:candidate');
  });

  it('hands out TURN logins that expire and that the relay can verify', async () => {
    const { tutor, code } = await openRoom();
    tutor.send({ t: 'rtc:config' });
    const { iceServers } = await tutor.take('rtc:config');
    expect(iceServers[0]).toEqual({ urls: 'stun:turn.example:3478' });
    const relay = iceServers[1];
    expect(relay.urls).toContain('turns:turn.example:443?transport=tcp');
    const [expires, user] = relay.username.split(':');
    expect(user).toBe(`${code}-tutor`);
    expect(Number(expires)).toBeGreaterThan(Date.now() / 1000);
    expect(relay.credential).toBe(createHmac('sha1', 'test-secret').update(relay.username).digest('base64'));
  });
});

describe('the join limit', () => {
  it('only counts wrong codes, and clears for someone who waits', async () => {
    const limited = http.createServer((req, res) => res.end());
    const rt = attachRealtime(limited, { allowedOrigins: new Set([ORIGIN]), joinAttemptsPerWindow: 3, joinWindowMs: 400 });
    await new Promise((resolve) => limited.listen(0, resolve));
    const address = `ws://localhost:${limited.address().port}/ws`;
    try {
      const tutor = await connect(ORIGIN, address);
      tutor.send({ t: 'create' });
      const { code } = await tutor.take('room');
      const student = await connect(ORIGIN, address);
      for (let i = 0; i < 5; i++) {
        student.send({ t: 'join', code }); // real joins, from the same network, never use it up
        await student.take('room');
      }
      const guesser = await connect(ORIGIN, address);
      const wrong = code === '0000' ? '0001' : '0000';
      for (let i = 0; i < 3; i++) {
        guesser.send({ t: 'join', code: wrong });
        expect((await guesser.take('error')).reason).toBe('no-room');
      }
      guesser.send({ t: 'join', code: wrong });
      expect((await guesser.take('error')).reason).toBe('slow-down');
      guesser.send({ t: 'join', code: wrong }); // refused tries don't add to the wait
      expect((await guesser.take('error')).reason).toBe('slow-down');
      await new Promise((resolve) => setTimeout(resolve, 450));
      guesser.send({ t: 'join', code: wrong });
      expect((await guesser.take('error')).reason).toBe('no-room');
    } finally {
      rt.close();
      limited.close();
    }
  });
});

describe('pictures and pieces', () => {
  const PIC = 'a'.repeat(32);
  const photo = { x: 32, y: 246, w: 646, h: 698, r: 41 };
  const addPicture = (code, key, id = PIC) =>
    realtime.pictures.add({ code, key, id, w: 976, h: 974, type: 'image/jpeg', bytes: Buffer.alloc(2000) });
  const newPiece = (id, extra = {}) => ({ id, pic: PIC, crop: photo, x: 100, y: 200, w: 300, ...extra });

  it('only takes pictures from the room tutor, and tells both screens', async () => {
    const { tutor, code, key } = await openRoom();
    const { student } = await joinRoom(code);
    expect(addPicture(code, 'b'.repeat(32)).status).toBe(403);
    expect(addPicture(code, key, '../../etc/passwd').status).toBe(400);
    expect(addPicture(code, key).status).toBe(201);
    expect((await student.take('pic:add')).pic).toEqual({ id: PIC, w: 976, h: 974 });
    expect((await tutor.take('pic:add')).pic.id).toBe(PIC);
    expect(realtime.pictures.get(code, PIC).bytes.length).toBe(2000);
  });

  it('places a copy of part of a picture, then moves and resizes it in its own shape', async () => {
    const { tutor, code, key } = await openRoom();
    const { student } = await joinRoom(code);
    addPicture(code, key);
    tutor.send({ t: 'piece:add', piece: newPiece('p1') });
    const { piece } = await student.take('piece:add');
    expect(piece).toMatchObject({ id: 'p1', pic: PIC, crop: photo, x: 100, y: 200, w: 300 });
    expect(piece.h).toBeCloseTo((300 * 698) / 646, 1);
    tutor.send({ t: 'piece:grab', id: 'p1' });
    await student.take('piece:grab');
    tutor.send({ t: 'piece:move', id: 'p1', x: 150, y: 250, w: 200 });
    expect(await student.take('piece:move')).toMatchObject({ x: 150, y: 250, w: 200 });
    tutor.send({ t: 'piece:drop', id: 'p1', x: 160, y: 260, w: 200 });
    expect((await student.take('piece:drop')).piece).toMatchObject({ x: 160, y: 260, w: 200, heldBy: null });
  });

  it('lets the student copy and resize only while their tools are on, and never delete', async () => {
    const { tutor, code, key } = await openRoom();
    const { student } = await joinRoom(code);
    addPicture(code, key);
    student.send({ t: 'piece:add', piece: newPiece('s1') });
    await nothing(tutor, 'piece:add');
    tutor.send({ t: 'piece:add', piece: newPiece('t1') });
    await student.take('piece:add');
    await tutor.take('piece:add');
    student.send({ t: 'piece:grab', id: 't1' }); // moving is fine, resizing isn't
    await tutor.take('piece:grab');
    student.send({ t: 'piece:move', id: 't1', x: 400, y: 300, w: 120 });
    expect(await tutor.take('piece:move')).toMatchObject({ x: 400, y: 300, w: 300 });
    student.send({ t: 'piece:drop', id: 't1', x: 400, y: 300 });
    await tutor.take('piece:drop');
    tutor.send({ t: 'tools', on: true });
    await student.take('tools');
    student.send({ t: 'piece:add', piece: newPiece('s2') }); // no part given to them
    await nothing(tutor, 'piece:add');
    student.send({ t: 'piece:delete', id: 't1' });
    await nothing(tutor, 'piece:delete');
  });

  it('lets the student take only the part the tutor gave them, once, with their tools on', async () => {
    const { tutor, code, key } = await openRoom();
    const { student } = await joinRoom(code);
    addPicture(code, key);
    tutor.send({ t: 'offer:add', offer: { id: 'o1', pic: PIC, crop: photo } });
    expect((await student.take('offer')).offer).toMatchObject({ id: 'o1', crop: photo, taken: false });
    await tutor.take('offer');
    student.send({ t: 'piece:add', piece: newPiece('s1', { offer: 'o1' }) }); // tools still off
    await nothing(tutor, 'piece:add');
    tutor.send({ t: 'tools', on: true });
    await student.take('tools');
    const wholeCard = { x: 0, y: 0, w: 976, h: 974 };
    student.send({ t: 'piece:add', piece: newPiece('s2', { offer: 'o1', crop: wholeCard }) });
    expect((await tutor.take('piece:add')).piece.crop).toEqual(photo); // the given part, not what was asked
    expect((await tutor.take('offer')).offer.taken).toBe(true);
    await student.take('offer');
    student.send({ t: 'piece:add', piece: newPiece('s3', { offer: 'o1' }) }); // only once
    await nothing(tutor, 'piece:add');
    tutor.send({ t: 'offer:reset', id: 'o1' });
    expect((await student.take('offer')).offer.taken).toBe(false);
    student.send({ t: 'piece:add', piece: newPiece('s4', { offer: 'o1' }) });
    expect((await tutor.take('piece:add')).piece.id).toBe('s4');
  });

  it('only lets the tutor give parts to the student', async () => {
    const { tutor, code, key } = await openRoom();
    const { student } = await joinRoom(code);
    addPicture(code, key);
    student.send({ t: 'offer:add', offer: { id: 'o1', pic: PIC, crop: photo } });
    await nothing(tutor, 'offer');
  });

  it('forgets the pictures when the tutor clears them or the room closes', async () => {
    const { tutor, code, key } = await openRoom();
    addPicture(code, key);
    tutor.send({ t: 'pieces:clear' });
    expect(await tutor.take('pieces')).toMatchObject({ pieces: [], pictures: [] });
    expect(realtime.pictures.get(code, PIC)).toBeNull();
    addPicture(code, key);
    tutor.send({ t: 'end' });
    await tutor.take('closed');
    expect(realtime.pictures.get(code, PIC)).toBeNull();
  });

  it('gives someone joining later the pictures and pieces', async () => {
    const { tutor, code, key } = await openRoom();
    addPicture(code, key);
    tutor.send({ t: 'piece:add', piece: newPiece('p1') });
    await tutor.take('piece:add');
    const { board } = await joinRoom(code);
    expect(board.pictures).toEqual([{ id: PIC, w: 976, h: 974 }]);
    expect(board.pieces.map((p) => p.id)).toEqual(['p1']);
  });

  it('refuses pieces of pictures that are not in the room, or crops outside the picture', async () => {
    const { tutor, code, key } = await openRoom();
    addPicture(code, key);
    tutor.send({ t: 'piece:add', piece: newPiece('x1', { pic: 'c'.repeat(32) }) });
    tutor.send({ t: 'piece:add', piece: newPiece('x2', { crop: { x: 900, y: 900, w: 300, h: 300 } }) });
    await nothing(tutor, 'piece:add');
  });
});

describe('each screen’s view of the board', () => {
  it('shows the tutor what the student can see, and brings the student to the tutor’s view', async () => {
    const { tutor, code } = await openRoom();
    const { student } = await joinRoom(code);
    student.send({ t: 'view', x: 10.4, y: -5, w: 540, h: 1000 });
    expect(await tutor.take('view')).toMatchObject({ x: 10, y: 0, w: 540, h: 1000 });
    tutor.send({ t: 'focus', x: 24, y: 24, w: 400, h: 250 });
    expect(await student.take('focus')).toMatchObject({ x: 24, y: 24, w: 400, h: 250 });
  });

  it('only lets the tutor move the student’s view, and ignores nonsense', async () => {
    const { tutor, code } = await openRoom();
    const { student } = await joinRoom(code);
    tutor.send({ t: 'view', x: 0, y: 0, w: 400, h: 250 });
    await nothing(student, 'view');
    student.send({ t: 'focus', x: 0, y: 0, w: 400, h: 250 });
    await nothing(tutor, 'focus');
    tutor.send({ t: 'focus', x: 'a', y: 0, w: 400, h: 250 });
    tutor.send({ t: 'focus', x: 0, y: 0, w: 5, h: 5 });
    await nothing(student, 'focus');
  });
});

describe('library cards with predefined regions', () => {
  it('lets the student take the card mouth region themselves, with tools on, and nothing else', async () => {
    const { tutor, code, key } = await openRoom();
    const { student } = await joinRoom(code);
    const id = 'b'.repeat(32);
    const mouth = { id: 'mouth', label: 'Mouth', x: 48, y: 300, w: 744, h: 852, r: 36 };
    realtime.pictures.add({ code, key, id, w: 1200, h: 1200, type: 'image/jpeg', bytes: Buffer.alloc(2000), regions: [mouth, { id: 'Bad!', x: 0, y: 0, w: 5, h: 5 }] });
    expect((await student.take('pic:add')).pic.regions).toEqual([mouth]);
    const piece = (pid, extra) => ({ id: pid, pic: id, crop: { x: 0, y: 0, w: 1200, h: 1200 }, x: 100, y: 100, w: 300, ...extra });
    student.send({ t: 'piece:add', piece: piece('m1', { region: 'mouth' }) }); // tools still off
    await nothing(tutor, 'piece:add');
    tutor.send({ t: 'tools', on: true });
    await student.take('tools');
    student.send({ t: 'piece:add', piece: piece('m2', { region: 'mouth' }) });
    expect((await tutor.take('piece:add')).piece.crop).toMatchObject({ x: 48, y: 300, w: 744, h: 852 });
    student.send({ t: 'piece:add', piece: piece('m3', { region: 'title' }) }); // not a region of this card
    await nothing(tutor, 'piece:add');
    student.send({ t: 'piece:add', piece: piece('m4') }); // a crop of their own
    await nothing(tutor, 'piece:add');
  });
});

describe('library cards in a session', () => {
  it('keeps them apart from uploads: their own limit, with their card id and title', async () => {
    const { code, key } = await openRoom();
    const { student } = await joinRoom(code);
    for (let i = 0; i < 9; i++) {
      const id = i.toString(16).padStart(32, 'c');
      expect(realtime.pictures.add({ code, key, id, w: 100, h: 100, type: 'image/jpeg', bytes: Buffer.alloc(10), library: `card${i}`, title: `Card ${i}` }).status).toBe(201);
    }
    expect((await student.take('pic:add')).pic).toMatchObject({ library: 'card0', title: 'Card 0' });
    const upload = { code, key, id: 'd'.repeat(32), w: 100, h: 100, type: 'image/jpeg', bytes: Buffer.alloc(10) };
    expect(realtime.pictures.add(upload).status).toBe(201); // nine library cards, and an upload still fits
  });
});

describe('the shared picture library', () => {
  it('tells the tutor where the student is browsing, and shows the student the tutor pick', async () => {
    const { tutor, code, key } = await openRoom();
    const { student } = await joinRoom(code);
    const pic = 'e'.repeat(32);
    realtime.pictures.add({ code, key, id: pic, w: 100, h: 100, type: 'image/jpeg', bytes: Buffer.alloc(10) });
    await student.take('pic:add');
    student.send({ t: 'browse', open: true, pic });
    expect(await tutor.take('browse')).toMatchObject({ open: true, pic });
    student.send({ t: 'browse', open: true, pic: 'f'.repeat(32) }); // not a picture in this session
    expect((await tutor.take('browse')).pic).toBeNull();
    tutor.send({ t: 'guide', pic });
    expect(await student.take('guide')).toMatchObject({ pic });
    student.send({ t: 'guide', pic }); // only the tutor points
    await nothing(tutor, 'guide');
    tutor.send({ t: 'browse', open: true, pic }); // only the student reports
    await nothing(student, 'browse');
  });
});

describe('starting a lesson', () => {
  it('needs the go-ahead for a new lesson, but never for rejoining your own', async () => {
    let verdict = { ok: false, reason: 'sign-in' };
    const gated = http.createServer((req, res) => res.end());
    const rt = attachRealtime(gated, { allowedOrigins: new Set([ORIGIN]), canStartLesson: async () => verdict });
    await new Promise((resolve) => gated.listen(0, resolve));
    const address = `ws://localhost:${gated.address().port}/ws`;
    try {
      const tutor = await connect(ORIGIN, address);
      tutor.send({ t: 'create' });
      expect((await tutor.take('error')).reason).toBe('sign-in');
      verdict = { ok: true };
      tutor.send({ t: 'create' });
      const { code, key } = await tutor.take('room');
      verdict = { ok: false, reason: 'plan' };
      const reloaded = await connect(ORIGIN, address);
      reloaded.send({ t: 'create', code, key }); // the same lesson, after a reload: never stopped
      expect((await reloaded.take('room')).code).toBe(code);
      const other = await connect(ORIGIN, address);
      other.send({ t: 'create', code: code === '1234' ? '4321' : '1234', key: 'f'.repeat(32) }); // an invented lesson is a new one
      expect((await other.take('error')).reason).toBe('plan');
    } finally {
      rt.close?.();
      gated.close();
    }
  });
});
