import { cleanPictureMetadata } from '../shared/pictureMetadata.js';
import { WebSocketServer } from 'ws';
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { DEFAULT_LINES, isLineSize } from '../shared/lines.js';
import { BOX_COUNTS, MAX_TILES, clampTile, cleanTileText, duplicateTilePosition, nextHome, snapTile, tileKind } from '../shared/tiles.js';
import { cleanBoxTap, cleanBoxTaps, cleanSoundBoxState, nextBoxEpoch } from '../shared/soundBoxes.js';
import { MAX_OFFERS, MAX_PICTURES, MAX_PICTURE_SIDE, MAX_PIECES, clampPiece, cleanCrop, isFacePiece, isPictureId, pieceSize, startingWidth } from '../shared/pieces.js';
import { cleanAct } from '../shared/bridge.js';
import { cleanIntent } from '../shared/phoneme.js';

// Live rooms for the Alphabet Whiteboard: one tutor and one student per room.
// Pointers go both ways. The board is an ordered list of strokes (pen ink or
// eraser paths) that the server keeps and both screens replay. Rooms live in
// memory, so the app has to run as a single replica.

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const STAGE = { width: 1600, height: 1000 };
const REPLACED = 4000; // close code: the same person connected again somewhere else
const MODES = new Set(['pen', 'eraser', 'none']); // what a shared pointer shows
const TOOLS = new Set(['pen', 'eraser']);
const MAX_STROKES = 2000;
const MAX_GAME_CHARS = 8000; // a game's state, as JSON: the bridge's letters, or Phoneme Pop's word and sounds
const MAX_STROKE_NUMBERS = 8000; // 4,000 points
const MAX_CHUNK_NUMBERS = 256;
const POINTER_PER_SECOND = 60;
const DRAW_PER_SECOND = 120;
const RTC_PER_SECOND = 100; // ICE candidates arrive in bursts
const MAX_SDP = 20000;
const TURN_LOGIN_SECONDS = 6 * 60 * 60; // a TURN login outlasts a long lesson, then expires

const isCode = (value) =>
  typeof value === 'string' && value.length === 4 && [...value].every((c) => c >= '0' && c <= '9');
const isKey = (value) => typeof value === 'string' && value.length === 32;
const isStrokeId = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 40 &&
  [...value].every((c) => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-');
const clamp01 = (n) => Math.min(1, Math.max(0, n));

// The two shared hands, right (r) and left (l): one pair in the lesson, which either person can
// move by holding it. They wait just under the letters (above the board, so a phone shows them
// in its alphabet bar, not off its screen), right on the right, left on the left;
// the right one is out to start. A held hand lets go if its holder goes quiet (while holding,
// the screen says so every 2 seconds), disconnects, or (the student) loses their tools.
const HAND_SIDES = ['r', 'l'];
const HAND_HOLD_MS = 6000;
const HAND_HOME = { r: { x: 0.6, y: 0.17 }, l: { x: 0.4, y: 0.17 } };
const freshHands = () => ({
  r: { on: true, ...HAND_HOME.r, letter: null, by: null, timer: null },
  l: { on: false, ...HAND_HOME.l, letter: null, by: null, timer: null },
});
const publicHand = (h) => ({ on: h.on, x: h.x, y: h.y, letter: h.letter, by: h.by });
const letGo = (h) => {
  h.by = null;
  clearTimeout(h.timer);
  h.timer = null;
};
const cleanLetter = (l) => (typeof l === 'string' && l.length === 1 && LETTERS.includes(l) ? l : null);
const clampTo = (n, max) => Math.round(Math.min(max, Math.max(0, n)) * 10) / 10;

// Validates a flat [x, y, x, y, ...] list of stage coordinates and clamps it to the stage.
function cleanPoints(pts) {
  if (!Array.isArray(pts) || pts.length === 0 || pts.length % 2 !== 0) return null;
  const out = [];
  for (let i = 0; i < pts.length; i += 2) {
    if (!Number.isFinite(pts[i]) || !Number.isFinite(pts[i + 1])) return null;
    out.push(clampTo(pts[i], STAGE.width), clampTo(pts[i + 1], STAGE.height));
  }
  return out;
}

// The tutor's game state, if it's a reasonable size. Only the tutor can send it, so it's kept as sent.
function cleanGame(game) {
  if (!game || typeof game !== 'object' || Array.isArray(game)) return undefined;
  const json = JSON.stringify(game);
  return json.length <= MAX_GAME_CHARS ? JSON.parse(json) : undefined;
}

// A part of the board (x, y, w, h in board units), tidied up, or null.
function viewRect(m) {
  if (![m.x, m.y, m.w, m.h].every(Number.isFinite)) return null;
  const x = Math.min(Math.max(Math.round(m.x), 0), 1600);
  const y = Math.min(Math.max(Math.round(m.y), 0), 1000);
  const w = Math.min(Math.round(m.w), 1600 - x);
  const h = Math.min(Math.round(m.h), 1000 - y);
  return w >= 20 && h >= 20 ? { x, y, w, h } : null;
}

const MAX_LIBRARY_PICTURES = 32; // library cards a session may hold; uploads have their own limit

// A library card's predefined Magic Select regions (its mouth photo), checked: up to 8, each a
// named box inside the picture.
function cleanRegions(list, w, h) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 8).flatMap((r) => {
    const n = (v) => Math.round(Number(v));
    const region = { id: String(r?.id || ''), label: String(r?.label || r?.id || '').slice(0, 40), x: n(r?.x), y: n(r?.y), w: n(r?.w), h: n(r?.h), r: Math.max(0, n(r?.r) || 0) };
    const ok =
      /^[a-z][a-z0-9-]{0,23}$/.test(region.id) &&
      [region.x, region.y, region.w, region.h].every(Number.isFinite) &&
      region.x >= 0 && region.y >= 0 && region.w >= 8 && region.h >= 8 && region.x + region.w <= w && region.y + region.h <= h;
    return ok ? [region] : [];
  });
}

// What both screens learn about a picture: its size, plus a library card's id, title and regions.
function sharedPicture({ id, w, h, regions, library, title, material }) {
  return { id, w, h, ...(regions?.length ? { regions } : {}), ...(library ? { library } : {}), ...cleanPictureMetadata({ title, material }) };
}

// Azure's ingress appends the real client address as the last X-Forwarded-For entry.
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',').pop().trim();
  return req.socket.remoteAddress || 'unknown';
}

function cleanRtcIdentity(msg) {
  const identity = {};
  for (const field of ['id', 'to']) {
    if (msg[field] === undefined) continue;
    if (typeof msg[field] !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(msg[field])) return null;
    identity[field] = msg[field];
  }
  return identity;
}

export function attachRealtime(server, options = {}) {
  const {
    allowedOrigins = new Set(),
    tutorGraceMs = 60_000,
    maxRooms = 500,
    maxRoomsPerIp = 10,
    joinAttemptsPerWindow = 30,
    joinWindowMs = 5 * 60_000,
    heartbeatMs = 25_000,
    turn = {}, // { host, secret, tls } for the TURN relay; without a secret, calls use STUN only
    maxPictureBytes = 200 * 1024 * 1024, // every room's pictures together, since they live in memory
    // May this person start a new lesson? Given their cookie header; answers { ok, reason }.
    canStartLesson = async () => ({ ok: true }),
  } = options;

  const rooms = new Map();
  // Opaque, server-only tickets bind asynchronous picture writes to one lesson state.
  const pictureWrites = new WeakMap();
  const joinAttempts = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  let pictureBytes = 0;

  const send = (ws, msg) => {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const roleOf = (ws) => {
    const room = ws.room;
    if (!room) return null;
    if (room.tutor === ws) return 'tutor';
    if (room.student === ws) return 'student';
    return null;
  };
  const otherSide = (room, role) => (role === 'tutor' ? room.student : room.tutor);
  const canDraw = (room, role) => role === 'tutor' || (role === 'student' && room.tools);

  // A per-second budget for each kind of message on a socket.
  const allow = (ws, kind, perSecond) => {
    const now = Date.now();
    const bucket = ws.budget[kind] || (ws.budget[kind] = { start: now, count: 0 });
    if (now - bucket.start >= 1000) {
      bucket.start = now;
      bucket.count = 0;
    }
    bucket.count += 1;
    return bucket.count <= perSecond;
  };

  const boardMessage = (room) => ({
    t: 'board',
    tools: room.tools,
    hands: publicHands(room),
    strip: room.strip,
    boxes: room.boxes,
    boxTaps: room.boxTaps,
    boxEpoch: room.boxEpoch,
    lines: room.lines,
    strokes: room.strokes.map(({ id, by, tool, pts, seq }) => ({ id, by, tool, pts, seq })),
    tiles: [...room.tiles.values()],
    pictures: [...room.pictures.values()].map(sharedPicture),
    pieces: [...room.pieces.values()],
    offers: [...room.offers.values()],
    game: room.game,
  });

  const broadcast = (room, msg) => {
    send(room.tutor, msg);
    send(room.student, msg);
  };

  const broadcastBoxes = (room) => broadcast(room, { t: 'boxes:set', count: room.boxes, taps: room.boxTaps, epoch: room.boxEpoch });
  const resetBoxTaps = (room) => {
    room.boxTaps = [];
    room.boxEpoch = nextBoxEpoch(room.boxEpoch);
  };

  const publicHands = (room) => ({ r: publicHand(room.hands.r), l: publicHand(room.hands.l) });
  const sendHand = (room, side) => broadcast(room, { t: 'hand', side, ...publicHand(room.hands[side]) });
  // Lets go of whatever this person holds.
  const releaseHands = (room, role) => {
    for (const side of HAND_SIDES) {
      if (room.hands[side].by !== role) continue;
      letGo(room.hands[side]);
      sendHand(room, side);
    }
  };
  const keepHolding = (room, side) => {
    const hand = room.hands[side];
    clearTimeout(hand.timer);
    hand.timer = setTimeout(() => {
      if (!hand.by) return;
      letGo(hand);
      sendHand(room, side);
    }, HAND_HOLD_MS);
    hand.timer.unref?.();
  };

  const isTutor = (ws) => Boolean(ws.room && ws.room.tutor === ws);

  const broadcastBoard = (room) => {
    const msg = boardMessage(room);
    send(room.tutor, msg);
    send(room.student, msg);
  };

  const sendPresence = (room) => {
    const msg = { t: 'presence', tutor: Boolean(room.tutor), student: Boolean(room.student) };
    send(room.tutor, msg);
    send(room.student, msg);
  };

  // Ends whatever stroke this socket was drawing and tells the other person.
  const finishStroke = (ws, room) => {
    const stroke = ws.openStroke && room.strokeById.get(ws.openStroke);
    ws.openStroke = null;
    if (!stroke || stroke.done) return;
    stroke.done = true;
    send(otherSide(room, stroke.by), { t: 'e', id: stroke.id });
  };

  // Lets go of any tile this socket was dragging.
  const releaseTiles = (ws, room) => {
    const role = room.tutor === ws ? 'tutor' : room.student === ws ? 'student' : null;
    if (!role) return;
    for (const tile of room.tiles.values()) {
      if (tile.heldBy !== role) continue;
      tile.heldBy = null;
      send(otherSide(room, role), { t: 'tile:drop', tile });
    }
    for (const piece of room.pieces.values()) {
      if (piece.heldBy !== role) continue;
      piece.heldBy = null;
      send(otherSide(room, role), { t: 'piece:drop', piece });
    }
  };

  // Pictures only live as long as their room, or until the tutor clears them.
  const forgetPictures = (room) => {
    room.pictureGeneration += 1;
    for (const pic of room.pictures.values()) pictureBytes -= pic.bytes.length;
    room.pictures.clear();
    room.offers.clear();
  };

  const closeRoom = (room, reason) => {
    clearTimeout(room.closeTimer);
    forgetPictures(room);
    if (rooms.get(room.code) === room) rooms.delete(room.code);
    for (const ws of [room.tutor, room.student]) {
      if (!ws) continue;
      ws.room = null;
      ws.openStroke = null;
      send(ws, { t: 'closed', reason });
    }
  };

  const leaveRoom = (ws) => {
    const room = ws.room;
    if (!room) return;
    finishStroke(ws, room);
    releaseTiles(ws, room);
    ws.room = null;
    if (room.tutor === ws) {
      room.tutor = null;
      delete room.pointers.tutor;
      releaseHands(room, 'tutor');
      clearTimeout(room.closeTimer);
      room.closeTimer = setTimeout(() => closeRoom(room, 'tutor-left'), tutorGraceMs);
    } else if (room.student === ws) {
      room.student = null;
      delete room.pointers.student;
      releaseHands(room, 'student');
    }
    sendPresence(room);
  };

  const replace = (room, oldWs, newWs) => {
    if (!oldWs || oldWs === newWs) return;
    finishStroke(oldWs, room);
    oldWs.room = null;
    oldWs.close(REPLACED, 'replaced');
  };

  const newCode = () => {
    for (let i = 0; i < 100; i += 1) {
      const code = String(randomInt(1000, 10000));
      if (!rooms.has(code)) return code;
    }
    return null;
  };

  // Only wrong codes count toward the join limit: it's there to stop someone guessing codes,
  // so joining a real room (or coming back to it) never uses it up. Refused tries don't count
  // either, so waiting always clears it.
  const missesOf = (ip) => (joinAttempts.get(ip) || []).filter((t) => Date.now() - t < joinWindowMs);
  const tooManyMisses = (ip) => missesOf(ip).length >= joinAttemptsPerWindow;
  const recordMiss = (ip) => joinAttempts.set(ip, [...missesOf(ip), Date.now()]);

  // ICE servers for a call: STUN, plus TURN with a login that expires. This is the TURN REST
  // API scheme: the relay checks an HMAC of the username against the secret it shares with us.
  const iceServersFor = (room, role) => {
    if (!turn.host) return [];
    const servers = [{ urls: `stun:${turn.host}:3478` }];
    if (turn.secret) {
      const username = `${Math.floor(Date.now() / 1000) + TURN_LOGIN_SECONDS}:${room.code}-${role}`;
      const credential = createHmac('sha1', turn.secret).update(username).digest('base64');
      const urls = [`turn:${turn.host}:3478?transport=udp`, `turn:${turn.host}:3478?transport=tcp`];
      if (turn.tls) urls.push(`turns:${turn.host}:443?transport=tcp`);
      servers.push({ urls, username, credential });
    }
    return servers;
  };

  const cleanDescription = (d) =>
    d && (d.type === 'offer' || d.type === 'answer') && typeof d.sdp === 'string' && d.sdp.length <= MAX_SDP
      ? { type: d.type, sdp: d.sdp }
      : null;

  // An ICE candidate, or null for end-of-candidates. Anything else comes back undefined and is dropped.
  const cleanCandidate = (c) => {
    if (c === null) return null;
    if (!c || typeof c.candidate !== 'string' || c.candidate.length > 1000) return undefined;
    return {
      candidate: c.candidate,
      sdpMid: typeof c.sdpMid === 'string' ? c.sdpMid.slice(0, 64) : null,
      sdpMLineIndex: Number.isInteger(c.sdpMLineIndex) ? c.sdpMLineIndex : null,
      usernameFragment: typeof c.usernameFragment === 'string' ? c.usernameFragment.slice(0, 256) : null,
    };
  };

  const relayRtc = (ws, msg) => {
    const role = roleOf(ws);
    if (!role || !allow(ws, 'rtc', RTC_PER_SECOND)) return;
    send(otherSide(ws.room, role), msg);
  };

  // A new piece from a client's description, checked and fitted to the board, or null.
  const makePiece = (room, p) => {
    if (!p || !isStrokeId(p.id) || room.pieces.has(p.id) || room.pieces.size >= MAX_PIECES) return null;
    const pic = room.pictures.get(p.pic);
    const crop = cleanCrop(p.crop, pic);
    if (!crop) return null;
    const size = pieceSize(crop, Number.isFinite(p.w) ? p.w : startingWidth(crop));
    const pos = clampPiece(size, p.x, p.y);
    if (!pos) return null;
    room.zTop += 1;
    return { id: p.id, pic: pic.id, crop, ...pos, ...size, z: room.zTop, heldBy: null };
  };

  // A part of a picture the tutor gives the student, checked, or null.
  const makeOffer = (room, o, taken = false) => {
    if (!o || !isStrokeId(o.id) || room.offers.has(o.id) || room.offers.size >= MAX_OFFERS) return null;
    const pic = room.pictures.get(o.pic);
    const crop = cleanCrop(o.crop, pic);
    return crop ? { id: o.id, pic: pic.id, crop, taken } : null;
  };

  // Moves a piece, and resizes it too when a width comes along and this person may resize.
  const placePiece = (room, role, piece, msg) => {
    const canResize = canDraw(room, role) && (role === 'tutor' || !isFacePiece(piece, room.pictures.get(piece.pic)));
    const size = Number.isFinite(msg.w) && canResize ? pieceSize(piece.crop, msg.w) : { w: piece.w, h: piece.h };
    const pos = clampPiece(size, msg.x, msg.y);
    if (!pos) return false;
    Object.assign(piece, size, pos);
    return true;
  };

  const handlers = {
    // The alphabet bridge game. The tutor's copy is the one that counts: the tutor sets the game
    // (or null, to put the bridge away) and the student's screen follows it. The student's moves
    // go to the tutor to apply.
    game(ws, msg) {
      const room = ws.room;
      if (!room || room.tutor !== ws || !allow(ws, 'game', DRAW_PER_SECOND)) return;
      const game = msg.game === null ? null : cleanGame(msg.game);
      if (game === undefined) return;
      room.game = game;
      send(room.student, { t: 'game', game });
    },
    'game:act'(ws, msg) {
      const room = ws.room;
      if (!room || room.student !== ws || !room.game || !allow(ws, 'game:act', DRAW_PER_SECOND)) return;
      // What a student may send depends on the game that's on: Phoneme Pop taps, or bridge placements
      const act = room.game.kind === 'phoneme' ? cleanIntent(msg.act) : cleanAct(msg.act);
      if (act) send(room.tutor, { t: 'game:act', act });
    },
    // A tutor opens a room, or takes theirs back after a reconnect or a server restart.
    create(ws, msg, cleared = false) {
      let room = isCode(msg.code) ? rooms.get(msg.code) : undefined;
      if (room && room.key !== msg.key) room = undefined;
      // A new lesson needs the go-ahead (once billing is on: a signed-in tutor with a trial or
      // plan). Rejoining your own lesson, with its key, never does, so nobody is cut off mid-lesson.
      if (!room && !cleared) {
        if (ws.checking) return;
        ws.checking = true;
        Promise.resolve()
          .then(() => canStartLesson(ws.cookie))
          .catch(() => ({ ok: false, reason: 'unavailable' }))
          .then((verdict) => {
            ws.checking = false;
            if (ws.readyState !== 1) return;
            if (verdict?.ok) handlers.create(ws, msg, true);
            else send(ws, { t: 'error', reason: verdict?.reason || 'plan' });
          });
        return;
      }
      let fresh = false;
      if (!room) {
        const reuse = isCode(msg.code) && isKey(msg.key) && !rooms.has(msg.code);
        const code = reuse ? msg.code : newCode();
        let owned = 0;
        for (const r of rooms.values()) if (r.ip === ws.ip) owned += 1;
        if (!code || rooms.size >= maxRooms || owned >= maxRoomsPerIp) return send(ws, { t: 'error', reason: 'busy' });
        room = {
          code,
          key: reuse ? msg.key : randomBytes(16).toString('hex'),
          ip: ws.ip,
          tutor: null,
          student: null,
          studentKey: null,
          closeTimer: null,
          tools: false,
          game: null, // the alphabet bridge, as the tutor last set it
          strokes: [],
          strokeById: new Map(),
          seq: 0,
          pointers: {}, // last known pointer of each person, for whoever (re)joins
          hands: freshHands(),
          tiles: new Map(),
          pictures: new Map(), // id -> { id, w, h, type, bytes }, for this session only
          pictureGeneration: 0,
          pieces: new Map(),
          offers: new Map(), // parts the tutor gave the student: id -> { id, pic, crop, taken }
          zTop: 0, // stacking order: the tile picked up last sits on top
          order: 0, // creation order, for packing the tray
          strip: true,
          boxes: 0,
          boxTaps: [],
          boxEpoch: 0,
          lines: DEFAULT_LINES,
          // After a restart the tutor's browser hands back its copy of the board.
          restoring: reuse,
        };
        rooms.set(code, room);
        fresh = true;
      }
      if (ws.room !== room) leaveRoom(ws);
      clearTimeout(room.closeTimer);
      replace(room, room.tutor, ws);
      room.tutor = ws;
      room.pictureGeneration += 1;
      ws.room = room;
      send(ws, { t: 'room', role: 'tutor', code: room.code, key: room.key, fresh });
      sendPresence(room);
      if (!fresh) send(ws, boardMessage(room));
      if (room.pointers.student) send(ws, { t: 'p', ...room.pointers.student });
    },

    // A student joins with their tutor's code. Their key lets them take back
    // their own seat after a dropped connection.
    join(ws, msg) {
      if (tooManyMisses(ws.ip)) return send(ws, { t: 'error', reason: 'slow-down' });
      const room = isCode(msg.code) ? rooms.get(msg.code) : undefined;
      if (!room) {
        recordMiss(ws.ip);
        return send(ws, { t: 'error', reason: 'no-room' });
      }
      const returning = isKey(msg.key) && msg.key === room.studentKey;
      if (room.student && room.student !== ws && !returning) return send(ws, { t: 'error', reason: 'room-full' });
      if (ws.room !== room) leaveRoom(ws);
      replace(room, room.student, ws);
      room.student = ws;
      room.studentKey = returning ? msg.key : randomBytes(16).toString('hex');
      ws.room = room;
      send(ws, { t: 'room', role: 'student', code: room.code, key: room.studentKey });
      sendPresence(room);
      send(ws, boardMessage(room));
      if (room.pointers.tutor) send(ws, { t: 'p', ...room.pointers.tutor });
      if (returning && room.pointers.student) {
        const { x, y, l } = room.pointers.student;
        send(ws, { t: 'moved', x, y, l });
      }
    },

    // Pointers go to the other person: 0-1 stage coordinates, the tool in hand,
    // and for the pointing hand, the letter under the fingertip.
    p(ws, msg) {
      const role = roleOf(ws);
      if (!role || !allow(ws, 'pointer', POINTER_PER_SECOND)) return;
      const room = ws.room;
      const to = otherSide(room, role);
      const mode = MODES.has(msg.m) ? msg.m : 'none';
      if (mode === 'none') {
        delete room.pointers[role];
        return send(to, { t: 'p', m: 'none' });
      }
      if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
      const pointer = { x: clamp01(msg.x), y: clamp01(msg.y), m: mode };
      room.pointers[role] = pointer;
      send(to, { t: 'p', ...pointer });
    },

    // Tutor only: guide the student's hand. There is no way to move the tutor's.
    // The two shared hands. Either person switches them on and off (the student only while
    // their tools are on); after a server restart the tutor also hands back where they were.
    hands(ws, msg) {
      const role = roleOf(ws);
      const room = ws.room;
      if (!role || (role === 'student' && !room.tools) || !allow(ws, 'hands', 10)) return;
      for (const side of HAND_SIDES) {
        const hand = room.hands[side];
        if (typeof msg[side] === 'boolean') {
          hand.on = msg[side];
          if (!hand.on) letGo(hand);
        }
        const at = role === 'tutor' ? msg.at?.[side] : null;
        if (at && !hand.by && Number.isFinite(at.x) && Number.isFinite(at.y)) {
          hand.x = clamp01(at.x);
          hand.y = clamp01(at.y);
          hand.letter = cleanLetter(at.letter);
        }
      }
      broadcast(room, { t: 'hands', hands: publicHands(room) });
    },

    // Holding one: grab, move, drop. Whoever holds a hand is the only one moving it, except
    // that the tutor can always take it, even from the student mid-drag. The student can't
    // take one the tutor holds (they're told who has it).
    hand(ws, msg) {
      const role = roleOf(ws);
      const room = ws.room;
      if (!role || !HAND_SIDES.includes(msg.side) || (role === 'student' && !room.tools)) return;
      const hand = room.hands[msg.side];
      if (!hand.on) return;
      if (msg.a === 'grab') {
        if (!allow(ws, 'grab', 30)) return;
        if (hand.by && hand.by !== role && role !== 'tutor') return send(ws, { t: 'hand', side: msg.side, ...publicHand(hand) });
        const taken = hand.by !== role;
        hand.by = role;
        keepHolding(room, msg.side);
        if (taken) sendHand(room, msg.side);
        return;
      }
      if (hand.by !== role) return;
      if (msg.a === 'drop') {
        letGo(hand);
        return sendHand(room, msg.side);
      }
      if (!allow(ws, 'hand', POINTER_PER_SECOND * 2) || !Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
      hand.x = clamp01(msg.x);
      hand.y = clamp01(msg.y);
      hand.letter = cleanLetter(msg.letter);
      keepHolding(room, msg.side);
      send(otherSide(room, role), { t: 'hand', side: msg.side, ...publicHand(hand) });
    },

    // Stroke start. The student may only draw while the tutor has their tools on.
    s(ws, msg) {
      const role = roleOf(ws);
      if (!role || !canDraw(ws.room, role) || !allow(ws, 'draw', DRAW_PER_SECOND)) return;
      const room = ws.room;
      if (!isStrokeId(msg.id) || room.strokeById.has(msg.id) || !TOOLS.has(msg.tool)) return;
      if (room.strokes.length >= MAX_STROKES) return send(ws, { t: 'error', reason: 'board-full' });
      const start = cleanPoints([msg.x, msg.y]);
      if (!start) return;
      finishStroke(ws, room);
      room.restoring = false;
      room.seq += 1;
      const stroke = { id: msg.id, by: role, tool: msg.tool, pts: start, seq: room.seq, done: false };
      room.strokes.push(stroke);
      room.strokeById.set(stroke.id, stroke);
      ws.openStroke = stroke.id;
      send(ws, { t: 'ack', id: stroke.id, seq: stroke.seq });
      send(otherSide(room, role), { t: 's', id: stroke.id, by: role, tool: stroke.tool, x: start[0], y: start[1], seq: stroke.seq });
    },

    // More points for the stroke this socket is drawing.
    m(ws, msg) {
      const role = roleOf(ws);
      if (!role || !allow(ws, 'draw', DRAW_PER_SECOND)) return;
      const room = ws.room;
      const stroke = room.strokeById.get(msg.id);
      if (!stroke || stroke.done || ws.openStroke !== stroke.id) return;
      if (!Array.isArray(msg.pts) || msg.pts.length > MAX_CHUNK_NUMBERS) return;
      const pts = cleanPoints(msg.pts);
      if (!pts || stroke.pts.length + pts.length > MAX_STROKE_NUMBERS) return;
      for (const n of pts) stroke.pts.push(n);
      send(otherSide(room, role), { t: 'm', id: stroke.id, pts });
    },

    e(ws, msg) {
      if (ws.room && isStrokeId(msg.id) && ws.openStroke === msg.id) finishStroke(ws, ws.room);
    },

    // Takes back the sender's own most recent stroke, never the other person's.
    undo(ws) {
      const role = roleOf(ws);
      if (!role || !canDraw(ws.room, role) || !allow(ws, 'draw', DRAW_PER_SECOND)) return;
      const room = ws.room;
      for (let i = room.strokes.length - 1; i >= 0; i -= 1) {
        const stroke = room.strokes[i];
        if (stroke.by !== role) continue;
        room.strokes.splice(i, 1);
        room.strokeById.delete(stroke.id);
        if (ws.openStroke === stroke.id) ws.openStroke = null;
        send(room.tutor, { t: 'undo', id: stroke.id });
        send(room.student, { t: 'undo', id: stroke.id });
        return;
      }
    },

    // Tutor only: wipe the board for both.
    clear(ws) {
      const room = ws.room;
      if (!room || room.tutor !== ws) return;
      room.strokes = [];
      room.strokeById.clear();
      resetBoxTaps(room);
      for (const w of [room.tutor, room.student]) if (w) w.openStroke = null;
      broadcastBoard(room);
    },

    // Tutor only: turn the student's toolbar on or off.
    tools(ws, msg) {
      const room = ws.room;
      if (!room || room.tutor !== ws) return;
      room.tools = Boolean(msg.on);
      if (!room.tools && room.student) finishStroke(room.student, room);
      if (!room.tools) releaseHands(room, 'student');
      send(room.tutor, { t: 'tools', on: room.tools });
      send(room.student, { t: 'tools', on: room.tools });
    },

    // Tutor only, right after a restart: one stroke of the board they kept.
    rs(ws, msg) {
      const room = ws.room;
      if (!room || room.tutor !== ws || !room.restoring || room.strokes.length >= MAX_STROKES) return;
      if (!isStrokeId(msg.id) || room.strokeById.has(msg.id) || !TOOLS.has(msg.tool)) return;
      if (msg.by !== 'tutor' && msg.by !== 'student') return;
      if (!Array.isArray(msg.pts) || msg.pts.length > MAX_STROKE_NUMBERS) return;
      const pts = cleanPoints(msg.pts);
      if (!pts) return;
      room.seq += 1;
      const stroke = { id: msg.id, by: msg.by, tool: msg.tool, pts, seq: room.seq, done: true };
      room.strokes.push(stroke);
      room.strokeById.set(stroke.id, stroke);
    },

    // Tutor only: the restore is complete, so everyone gets the board.
    restored(ws, msg) {
      const room = ws.room;
      if (!room || room.tutor !== ws || !room.restoring) return;
      room.restoring = false;
      room.tools = Boolean(msg.tools);
      room.strip = msg.strip !== false;
      Object.assign(room, cleanSoundBoxState(msg));
      room.lines = isLineSize(msg.lines) ? msg.lines : DEFAULT_LINES;
      broadcastBoard(room);
    },

    // Tutor only: new tiles line up on the tray, in the order typed.
    'tile:add'(ws, msg) {
      const room = ws.room;
      if (!isTutor(ws) || !Array.isArray(msg.tiles)) return;
      const added = [];
      for (const item of msg.tiles.slice(0, MAX_TILES)) {
        const text = cleanTileText(item && item.text);
        if (room.tiles.size >= MAX_TILES || !text || !isStrokeId(item.id) || room.tiles.has(item.id)) continue;
        const home = nextHome([...room.tiles.values()], text);
        room.zTop += 1;
        room.order += 1;
        const tile = { id: item.id, text, kind: tileKind(text), x: home.hx, y: home.hy, ...home, z: room.zTop, order: room.order, heldBy: null };
        room.tiles.set(tile.id, tile);
        added.push(tile);
      }
      if (added.length) broadcast(room, { t: 'tile:add', tiles: added });
    },

    // A tutor dragging from the alphabet creates one tile at a validated drop point.
    'tile:add-at'(ws, msg) {
      if (!isTutor(ws)) return;
      const room = ws.room;
      const item = msg.tile;
      const text = cleanTileText(item?.text);
      const at = text && clampTile(text, item.x, item.y);
      if (!at || room.tiles.size >= MAX_TILES || !isStrokeId(item.id) || room.tiles.has(item.id)) return;
      const home = nextHome([...room.tiles.values()], text);
      room.zTop += 1;
      room.order += 1;
      const tile = { id: item.id, text, kind: tileKind(text), ...home, ...at, z: room.zTop, order: room.order, heldBy: null };
      Object.assign(tile, snapTile(tile, room.boxes, [...room.tiles.values()]) || {});
      room.tiles.set(tile.id, tile);
      broadcast(room, { t: 'tile:add', tiles: [tile] });
    },

    // Tutor only: a copy has its own id/home and starts in nearby free board space.
    'tile:duplicate'(ws, msg) {
      if (!isTutor(ws)) return;
      const room = ws.room;
      const original = room.tiles.get(msg.id);
      if (!original || room.tiles.size >= MAX_TILES || !isStrokeId(msg.copyId) || room.tiles.has(msg.copyId) || (original.heldBy && original.heldBy !== 'tutor')) return;
      const existing = [...room.tiles.values()];
      const home = nextHome(existing, original.text);
      const at = duplicateTilePosition(original, existing);
      room.zTop += 1;
      room.order += 1;
      const tile = { ...original, id: msg.copyId, ...home, ...at, z: room.zTop, order: room.order, heldBy: null };
      room.tiles.set(tile.id, tile);
      broadcast(room, { t: 'tile:add', tiles: [tile] });
    },

    // Either person picks up a tile; it's theirs until they drop it, so nobody fights over it.
    'tile:grab'(ws, msg) {
      const role = roleOf(ws);
      const tile = role && ws.room.tiles.get(msg.id);
      if (!tile || !allow(ws, 'tile', POINTER_PER_SECOND)) return;
      if (tile.heldBy && tile.heldBy !== role) return send(ws, { t: 'tile:denied', tile });
      ws.room.zTop += 1;
      tile.z = ws.room.zTop;
      tile.heldBy = role;
      broadcast(ws.room, { t: 'tile:grab', id: tile.id, by: role, z: tile.z });
    },

    'tile:move'(ws, msg) {
      const role = roleOf(ws);
      const tile = role && ws.room.tiles.get(msg.id);
      if (!tile || tile.heldBy !== role || !allow(ws, 'tile', POINTER_PER_SECOND)) return;
      const pos = clampTile(tile.text, msg.x, msg.y);
      if (!pos) return;
      Object.assign(tile, pos);
      send(otherSide(ws.room, role), { t: 'tile:move', id: tile.id, x: tile.x, y: tile.y });
    },

    // Dropping settles the tile (into a sound box, if it lands on a free one) and lets go.
    'tile:drop'(ws, msg) {
      const role = roleOf(ws);
      const room = ws.room;
      const tile = role && room.tiles.get(msg.id);
      if (!tile) return;
      if (tile.heldBy !== role) return send(ws, { t: 'tile:denied', tile });
      Object.assign(tile, clampTile(tile.text, msg.x, msg.y) || {});
      Object.assign(tile, snapTile(tile, room.boxes, [...room.tiles.values()]) || {});
      tile.heldBy = null;
      broadcast(room, { t: 'tile:drop', tile });
    },

    'tile:delete'(ws, msg) {
      if (!isTutor(ws) || !ws.room.tiles.delete(msg.id)) return;
      broadcast(ws.room, { t: 'tile:delete', id: msg.id });
    },

    // Tutor only: swap a tile's letters in place, for word chains (map, mat, sat).
    'tile:edit'(ws, msg) {
      const tile = isTutor(ws) && ws.room.tiles.get(msg.id);
      const text = cleanTileText(msg.text);
      if (!tile || !text) return;
      tile.text = text;
      tile.kind = tileKind(text);
      Object.assign(tile, clampTile(text, tile.x, tile.y));
      broadcast(ws.room, { t: 'tile:edit', tile });
    },

    // Tutor only: every tile back to its home on the tray, packed so there are no gaps.
    'tiles:reset'(ws) {
      if (!isTutor(ws)) return;
      const ordered = [...ws.room.tiles.values()].sort((a, b) => a.order - b.order);
      const placed = [];
      for (const tile of ordered) {
        Object.assign(tile, nextHome(placed, tile.text));
        tile.x = tile.hx;
        tile.y = tile.hy;
        tile.heldBy = null;
        placed.push(tile);
      }
      broadcast(ws.room, { t: 'tiles', tiles: ordered });
    },

    'tiles:clear'(ws) {
      if (!isTutor(ws)) return;
      ws.room.tiles.clear();
      broadcast(ws.room, { t: 'tiles', tiles: [] });
    },

    // Tutor only: show or hide the alphabet strip on both screens.
    'strip:set'(ws, msg) {
      if (!isTutor(ws)) return;
      ws.room.strip = Boolean(msg.on);
      broadcast(ws.room, { t: 'strip:set', on: ws.room.strip });
    },

    // Tutor only: the handwriting lines (big, medium, small or off) on both screens.
    'lines:set'(ws, msg) {
      if (!isTutor(ws) || !isLineSize(msg.size)) return;
      ws.room.lines = msg.size;
      broadcast(ws.room, { t: 'lines:set', size: ws.room.lines });
    },

    // Tutor only: sound boxes off (0) or 2 to 5 of them.
    'boxes:set'(ws, msg) {
      if (!isTutor(ws) || !BOX_COUNTS.includes(msg.count) || !allow(ws, 'boxes:control', 20)) return;
      const room = ws.room;
      if (room.boxes !== msg.count) {
        room.boxes = msg.count;
        resetBoxTaps(room);
      }
      broadcastBoxes(room);
    },

    // Counter marks are shared, while the tutor retains the exercise settings.
    'boxes:tap'(ws, msg) {
      const role = roleOf(ws);
      if (!role || !canDraw(ws.room, role) || !allow(ws, 'boxes:tap', 20)) return;
      const room = ws.room;
      const tap = cleanBoxTap(msg, room.boxes, room.boxEpoch);
      if (!tap) return;
      room.boxTaps = tap.pressed ? cleanBoxTaps(room.boxes, [...room.boxTaps, tap.index]) : room.boxTaps.filter((index) => index !== tap.index);
      broadcastBoxes(room);
    },

    'boxes:reset'(ws) {
      if (!isTutor(ws) || !allow(ws, 'boxes:control', 20)) return;
      resetBoxTaps(ws.room);
      broadcastBoxes(ws.room);
    },

    // Tutor only, right after a restart: one tile of the board they kept.
    'rs-tile'(ws, msg) {
      const room = ws.room;
      if (!isTutor(ws) || !room.restoring || room.tiles.size >= MAX_TILES) return;
      const t = msg.tile || {};
      const text = cleanTileText(t.text);
      if (!text || !isStrokeId(t.id) || room.tiles.has(t.id)) return;
      const pos = clampTile(text, t.x, t.y);
      const home = clampTile(text, t.hx, t.hy);
      if (!pos || !home) return;
      room.zTop += 1;
      room.order += 1;
      room.tiles.set(t.id, { id: t.id, text, kind: tileKind(text), ...pos, hx: home.x, hy: home.y, z: room.zTop, order: room.order, heldBy: null });
    },

    // Zoom and pan stay on each screen. The student's screen tells the tutor's which part of the
    // board it shows, and the tutor can bring the student's screen to a part of the board.
    view(ws, msg) {
      const rect = viewRect(msg);
      if (roleOf(ws) !== 'student' || !rect || !allow(ws, 'view', 12)) return;
      send(otherSide(ws.room, 'student'), { t: 'view', ...rect });
    },
    // The picture library, shared as awareness, never control: the student's screen says whether
    // the slide-out is open and which picture they're on; the tutor can point at a picture.
    browse(ws, msg) {
      if (roleOf(ws) !== 'student' || !allow(ws, 'view', 12)) return;
      const pic = isPictureId(msg.pic) && ws.room.pictures.has(msg.pic) ? msg.pic : null;
      send(otherSide(ws.room, 'student'), { t: 'browse', open: msg.open === true, pic });
    },
    guide(ws, msg) {
      if (!isTutor(ws) || !allow(ws, 'view', 12)) return;
      const pic = isPictureId(msg.pic) && ws.room.pictures.has(msg.pic) ? msg.pic : null;
      send(otherSide(ws.room, 'tutor'), { t: 'guide', pic });
    },
    focus(ws, msg) {
      const rect = viewRect(msg);
      if (!isTutor(ws) || !rect || !allow(ws, 'view', 12)) return;
      send(otherSide(ws.room, 'tutor'), { t: 'focus', ...rect });
    },
    // Picture pieces: a window onto one of the session's pictures, placed on the board.
    // The tutor can add any part. The student, while their tools are on, can only take a part
    // the tutor gave them, once, and gets exactly that part whatever their browser asks for.
    'piece:add'(ws, msg) {
      const role = roleOf(ws);
      const room = ws.room;
      if (!role || !canDraw(room, role) || !allow(ws, 'tile', POINTER_PER_SECOND)) return;
      const offer = role === 'student' ? room.offers.get(msg.piece?.offer) : null;
      // A library card's predefined region (its mouth photo): the student may take it themselves,
      // with their tools on. The crop always comes from the card, never from the message.
      const region = role === 'student' && !offer ? room.pictures.get(msg.piece?.pic)?.regions?.find((r) => r.id === msg.piece?.region) : null;
      if (role === 'student' && !region && (!offer || offer.taken)) return;
      const given = offer
        ? { ...msg.piece, pic: offer.pic, crop: offer.crop }
        : region
          ? { ...msg.piece, crop: { x: region.x, y: region.y, w: region.w, h: region.h, r: region.r } }
          : msg.piece;
      // A student cannot bypass the face-size restriction by forging the width
      // of a fresh copy. Existing tutor-sized faces keep their current size.
      const newPiece = role === 'student' && isFacePiece(given, room.pictures.get(given?.pic))
        ? { ...given, w: startingWidth(given.crop) }
        : given;
      const piece = makePiece(room, newPiece);
      if (!piece) return;
      room.pieces.set(piece.id, piece);
      if (offer) {
        offer.taken = true;
        broadcast(room, { t: 'offer', offer });
      }
      broadcast(room, { t: 'piece:add', piece });
    },
    // Tutor only: give the student a part of a picture to take, once.
    'offer:add'(ws, msg) {
      if (!isTutor(ws)) return;
      const offer = makeOffer(ws.room, msg.offer);
      if (!offer) return;
      ws.room.offers.set(offer.id, offer);
      broadcast(ws.room, { t: 'offer', offer });
    },
    'offer:remove'(ws, msg) {
      if (!isTutor(ws) || !ws.room.offers.delete(msg.id)) return;
      broadcast(ws.room, { t: 'offer:remove', id: msg.id });
    },
    // Tutor only: let the student take a part again.
    'offer:reset'(ws, msg) {
      const offer = isTutor(ws) ? ws.room.offers.get(msg.id) : null;
      if (!offer) return;
      offer.taken = false;
      broadcast(ws.room, { t: 'offer', offer });
    },
    // Tutor only, right after a restart: one of the parts they had given the student.
    'rs-offer'(ws, msg) {
      const room = ws.room;
      if (!isTutor(ws) || !room.restoring) return;
      const offer = makeOffer(room, msg.offer, Boolean(msg.offer?.taken));
      if (offer) room.offers.set(offer.id, offer);
    },
    // Like tiles: whoever picks a piece up has it until they drop it.
    'piece:grab'(ws, msg) {
      const role = roleOf(ws);
      const piece = role && ws.room.pieces.get(msg.id);
      if (!piece || !allow(ws, 'tile', POINTER_PER_SECOND)) return;
      if (piece.heldBy && piece.heldBy !== role) return send(ws, { t: 'piece:denied', piece });
      piece.heldBy = role;
      broadcast(ws.room, { t: 'piece:grab', id: piece.id, by: role, z: piece.z });
    },
    'piece:move'(ws, msg) {
      const role = roleOf(ws);
      const piece = role && ws.room.pieces.get(msg.id);
      if (!piece || piece.heldBy !== role || !allow(ws, 'tile', POINTER_PER_SECOND)) return;
      if (!placePiece(ws.room, role, piece, msg)) return;
      send(otherSide(ws.room, role), { t: 'piece:move', id: piece.id, x: piece.x, y: piece.y, w: piece.w, h: piece.h });
    },
    'piece:drop'(ws, msg) {
      const role = roleOf(ws);
      const piece = role && ws.room.pieces.get(msg.id);
      if (!piece) return;
      if (piece.heldBy !== role) return send(ws, { t: 'piece:denied', piece });
      placePiece(ws.room, role, piece, msg);
      piece.heldBy = null;
      broadcast(ws.room, { t: 'piece:drop', piece });
    },
    // Crop an existing piece in place. The source and identity are never replaced.
    'piece:crop'(ws, msg) {
      if (!isTutor(ws)) return;
      const piece = ws.room.pieces.get(msg.id);
      if (!piece) return;
      if (piece.heldBy && piece.heldBy !== 'tutor') return send(ws, { t: 'piece:denied', piece });
      const crop = cleanCrop(msg.crop, ws.room.pictures.get(piece.pic));
      if (!crop) return;
      const size = pieceSize(crop, piece.w);
      Object.assign(piece, { crop, ...size, ...clampPiece(size, piece.x, piece.y), heldBy: null });
      broadcast(ws.room, { t: 'piece:drop', piece });
    },
    // Selecting or moving a picture keeps its layer. Only the tutor changes the order.
    'piece:layer'(ws, msg) {
      if (!isTutor(ws) || !allow(ws, 'tile', POINTER_PER_SECOND)) return;
      if (msg.direction !== 'front' && msg.direction !== 'back') return;
      const piece = ws.room.pieces.get(msg.id);
      if (!piece) return;
      if (piece.heldBy && piece.heldBy !== 'tutor') return send(ws, { t: 'piece:denied', piece });
      const ordered = [...ws.room.pieces.values()].filter((p) => p.id !== piece.id).sort((a, b) => a.z - b.z);
      if (msg.direction === 'front') ordered.push(piece);
      else ordered.unshift(piece);
      const layers = ordered.map((p, i) => {
        p.z = i + 1;
        return { id: p.id, z: p.z };
      });
      ws.room.zTop = Math.max(ws.room.zTop, layers.length);
      broadcast(ws.room, { t: 'piece:layer', layers });
    },
    'piece:delete'(ws, msg) {
      if (!isTutor(ws)) return;
      const piece = ws.room.pieces.get(msg.id);
      if (!piece) return;
      if (piece.heldBy && piece.heldBy !== 'tutor') return send(ws, { t: 'piece:denied', piece });
      ws.room.pieces.delete(msg.id);
      broadcast(ws.room, { t: 'piece:delete', id: msg.id });
    },
    // Tutor only: every piece off the board, and the pictures forgotten.
    'pieces:clear'(ws) {
      if (!isTutor(ws)) return;
      ws.room.pieces.clear();
      forgetPictures(ws.room);
      broadcast(ws.room, { t: 'pieces', pieces: [], pictures: [], offers: [] });
    },
    // Tutor only, right after a restart: one piece of the board they kept (its picture goes up first).
    'rs-piece'(ws, msg) {
      const room = ws.room;
      if (!isTutor(ws) || !room.restoring) return;
      const piece = makePiece(room, msg.piece);
      if (piece) room.pieces.set(piece.id, piece);
    },
    // Video calls. The server only introduces the two browsers; the audio and video go
    // directly between them (or through the TURN relay), never through this server.
    'rtc:config'(ws) {
      const role = roleOf(ws);
      if (role) send(ws, { t: 'rtc:config', iceServers: iceServersFor(ws.room, role) });
    },

    // A one-line note about how a call went (device, browser, route type; no addresses), so a
    // failed call on someone's device leaves a trace in the server log.
    'rtc:report'(ws, msg) {
      const role = roleOf(ws);
      if (!role || typeof msg.text !== 'string') return;
      ws.callReports = (ws.callReports || 0) + 1;
      if (ws.callReports > 20) return;
      console.log(`Video ${ws.room.code} ${role}: ${msg.text.replace(/[^ -~’]/g, ' ').slice(0, 200)}`);
    },

    'rtc:ready'(ws, msg) {
      // Optional recovery generation. Older clients still receive/send plain ready;
      // only a small opaque ID is relayed, never arbitrary user-supplied fields.
      const id = typeof msg.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(msg.id) ? msg.id : undefined;
      if (msg.id !== undefined && !id) return;
      relayRtc(ws, { t: 'rtc:ready', ...(id ? { id } : {}) });
    },

    'rtc:leave'(ws) {
      relayRtc(ws, { t: 'rtc:leave' });
    },

    'rtc:description'(ws, msg) {
      const description = cleanDescription(msg.description);
      const identity = cleanRtcIdentity(msg);
      if (description && identity) relayRtc(ws, { t: 'rtc:description', ...identity, description });
    },

    'rtc:candidate'(ws, msg) {
      const candidate = cleanCandidate(msg.candidate);
      const identity = cleanRtcIdentity(msg);
      if (candidate !== undefined && identity) relayRtc(ws, { t: 'rtc:candidate', ...identity, candidate });
    },

    end(ws) {
      if (ws.room && ws.room.tutor === ws) closeRoom(ws.room, 'ended');
    },

    leave(ws) {
      leaveRoom(ws);
    },
  };

  wss.on('connection', (ws, req) => {
    ws.ip = clientIp(req);
    ws.isAlive = true;
    ws.room = null;
    ws.openStroke = null;
    ws.budget = {};
    ws.cookie = req.headers.cookie || '';
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg && typeof msg.t === 'string' && Object.hasOwn(handlers, msg.t)) handlers[msg.t](ws, msg);
    });
    ws.on('close', () => leaveRoom(ws));
  });

  // Only this site may open a socket, and only on /ws.
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname !== '/ws' || !allowedOrigins.has(req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  // Drop connections that stopped answering, and forget old join attempts.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
    const cutoff = Date.now() - joinWindowMs;
    for (const [ip, times] of joinAttempts) if (times.every((t) => t < cutoff)) joinAttempts.delete(ip);
  }, heartbeatMs);
  heartbeat.unref();

  // On shutdown (a deploy), close sockets with 1012 so clients reconnect to the new version.
  const close = () => {
    clearInterval(heartbeat);
    for (const room of rooms.values()) clearTimeout(room.closeTimer);
    for (const ws of wss.clients) ws.close(1012, 'restarting');
    wss.close();
  };

  // Picture uploads arrive over HTTP (see index.js), from the room's tutor only.
  const pictures = {
    // Capture before awaiting Blob storage or reading an upload body. These tickets never
    // leave the server; a clear, tutor reconnect, or reused room code makes them stale.
    beginWrite(code, key) {
      const room = isCode(code) ? rooms.get(code) : undefined;
      if (!room || !isKey(key) || room.key !== key) return null;
      const ticket = {};
      pictureWrites.set(ticket, { room, tutor: room.tutor, generation: room.pictureGeneration });
      return ticket;
    },
    add({ code, key, id, w, h, type, bytes, regions, library, title, material, writeToken }) {
      const room = isCode(code) ? rooms.get(code) : undefined;
      if (writeToken !== undefined) {
        const pending = pictureWrites.get(writeToken);
        pictureWrites.delete(writeToken);
        if (!pending || room !== pending.room || room.tutor !== pending.tutor || room.pictureGeneration !== pending.generation) return { status: 409 };
      }
      if (!room || !isKey(key) || room.key !== key) return { status: 403 };
      const sideOk = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_PICTURE_SIDE;
      if (!isPictureId(id) || !sideOk(w) || !sideOk(h)) return { status: 400 };
      if (room.pictures.has(id)) return { status: 200 }; // already here (a retry, or a restore)
      // Uploads and library cards have separate limits (library cards are first-party).
      const card = typeof library === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(library) ? library : null;
      const alike = [...room.pictures.values()].filter((p) => Boolean(p.library) === Boolean(card)).length;
      if (alike >= (card ? MAX_LIBRARY_PICTURES : MAX_PICTURES)) return { status: 409 };
      if (pictureBytes + bytes.length > maxPictureBytes) return { status: 503 };
      const known = cleanRegions(regions, w, h);
      const metadata = cleanPictureMetadata({ title, material: card ? undefined : material });
      const picture = { id, w, h, type, bytes, regions: known, library: card, ...metadata };
      room.pictures.set(id, picture);
      pictureBytes += bytes.length;
      broadcast(room, { t: 'pic:add', pic: sharedPicture(picture) });
      return { status: 201 };
    },
    get(code, id) {
      const room = isCode(code) ? rooms.get(code) : undefined;
      return (room && isPictureId(id) && room.pictures.get(id)) || null;
    },
    // Whether this is the tutor of a live room (their room key matches).
    isTutor(code, key) {
      const room = isCode(code) ? rooms.get(code) : undefined;
      return Boolean(room && isKey(key) && room.key === key);
    },
  };

  return { rooms, close, pictures };
}
