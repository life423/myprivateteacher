// Opens a tutor and a student connection against a running site. Where anyone may start a
// lesson (no billing), it checks that a pointer, a pen stroke and a tile drag make the trip.
// Where starting one needs a signed-in tutor with a plan (the live site), it checks that an
// unsigned lesson is refused and that joining answers, without ever entering a real lesson.
// Usage: node server/smoke.js https://myprivateteacher.com
import WebSocket from 'ws';

const site = new URL(process.argv[2] || 'http://localhost:8080');
const url = `${site.protocol === 'https:' ? 'wss:' : 'ws:'}//${site.host}/ws`;

const open = () =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { origin: site.origin });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });

const next = (ws, type) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for '${type}' from ${url}`)), 5000);
    const onMessage = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.t !== type) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(msg);
    };
    ws.on('message', onMessage);
  });

// The first of several message types.
const nextOf = (ws, types) => Promise.race(types.map((type) => next(ws, type)));

const say = (ws, msg) => ws.send(JSON.stringify(msg));

const tutor = await open();
const created = nextOf(tutor, ['room', 'error']);
say(tutor, { t: 'create' });
const reply = await created;
if (reply.t === 'error') {
  if (!['sign-in', 'plan'].includes(reply.reason)) throw new Error(`starting a lesson failed: ${reply.reason}`);
  // A malformed code can never match a real lesson, so this never joins anyone's.
  const student = await open();
  const answered = next(student, 'error');
  say(student, { t: 'join', code: 'smoke' });
  const answer = await answered;
  if (answer.reason !== 'no-room') throw new Error(`joining answered ${JSON.stringify(answer)}`);
  console.log(`Realtime OK over ${url}: a lesson without sign-in was refused (${answer.reason === 'no-room' ? reply.reason : ''}) and joining answers`);
  tutor.close();
  student.close();
  process.exit(0);
}
const { code } = reply;

const student = await open();
const joined = next(student, 'room');
say(student, { t: 'join', code });
await joined;

const pointed = next(tutor, 'p');
say(student, { t: 'p', x: 0.5, y: 0.1, m: 'pen' });
const pointer = await pointed;
if (pointer.m !== 'pen' || pointer.x !== 0.5) throw new Error(`pointer arrived as ${JSON.stringify(pointer)}`);

const toolsOn = next(student, 'tools');
say(tutor, { t: 'tools', on: true });
await toolsOn;

const drawn = next(tutor, 's');
say(student, { t: 's', id: 'smoke', tool: 'pen', x: 400, y: 500 });
const stroke = await drawn;
if (stroke.by !== 'student' || stroke.tool !== 'pen') throw new Error(`stroke arrived as ${JSON.stringify(stroke)}`);
say(student, { t: 'e', id: 'smoke' });

const added = next(student, 'tile:add');
say(tutor, { t: 'tile:add', tiles: [{ id: 'smoketile', text: 'sh' }] });
const [tile] = (await added).tiles;
const dropped = next(tutor, 'tile:drop');
say(student, { t: 'tile:grab', id: tile.id });
say(student, { t: 'tile:drop', id: tile.id, x: 700, y: 600 });
const drop = await dropped;
if (drop.tile.x !== 700 || drop.tile.y !== 600) throw new Error(`tile arrived as ${JSON.stringify(drop.tile)}`);

say(tutor, { t: 'end' });
console.log(`Realtime OK: room ${code} relayed a pointer, a pen stroke and a tile drag over ${url}`);
tutor.close();
student.close();
