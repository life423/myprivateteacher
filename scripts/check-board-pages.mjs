import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createApp } from '../server/index.js';
import { attachRealtime } from '../server/realtime.js';
import { WORD_BANK, WORD_LEVELS } from '../server/wordBank.js';

// Real tutor/student components, HTTP image uploads, and room WebSockets. All
// services and pictures are ephemeral fixtures; no running user app or cloud data.
let dev = false, browserName = 'chrome', output;
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === '--dev') dev = true;
  else if (arg === '--browser') browserName = process.argv[++index];
  else if (arg === '--output') output = process.argv[++index];
  else if (arg === '--help') {
    console.log('Usage: node scripts/check-board-pages.mjs [--dev] [--browser chrome|chromium|webkit] [--output DIRECTORY]');
    process.exit(0);
  } else throw new Error(`Unknown option: ${arg}`);
}
assert(['chrome', 'chromium', 'webkit'].includes(browserName), 'Unsupported browser');
const root = fileURLToPath(new URL('../', import.meta.url));
assert(dev || existsSync(join(root, 'dist/index.html')), 'Build first, or pass --dev.');
const out = output ? resolve(output) : mkdtempSync(join(tmpdir(), 'mpt-board-pages-'));
mkdirSync(out, { recursive: true });
const report = { browser: browserName, frontend: dev ? 'isolated Vite' : 'production build', fixtureServices: true,
  realWebSockets: true, actualUserSession: false, cloudServices: false, cases: [], pageErrors: [],
  limitations: ['No OAuth, billing, cloud storage, live media, or saved lessons.', 'Chrome phone interaction uses trusted touch; WebKit phone-sized interaction uses mouse input.', 'Restart means a controlled in-memory fixture-server restart while the tutor browser stays open; it is not persistent cloud lesson storage.'] };
let server, vite, devTransport, realtime, browser, handler;
const connections=new WeakMap();
const origins = new Set();
const pause = ms => new Promise(done => setTimeout(done, ms));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function buildFingerprint(){
  const html=readFileSync(join(root,'dist/index.html'));
  const scripts=[...html.toString().matchAll(/<script[^>]+src="([^"]+)"/g)].map(match=>match[1]);
  return {indexSha256:digest(html),scripts:scripts.map(url=>({url,sha256:digest(readFileSync(join(root,'dist',url.replace(/^\//,''))))}))};
}
if(!dev)report.build=buildFingerprint();
const pageTrigger = page => page.getByRole('button', { name: /^Board pages, page \d+ of \d+$/ });
const chooser = page => page.getByRole('dialog', { name: 'Board pages', exact: true });
const latest = (page, type) => page.evaluate(t => window.pageReceived.filter(msg => msg.t === t).at(-1), type);
const marker = page => page.evaluate(() => window.pageReceived.length);
const authoritative = code => { const room = realtime.rooms.get(code); assert(room, 'Fixture lesson must exist'); return room; };
function snapshot(page) {
  // A restart can compact numeric z gaps. Compare actual cross-type stacking
  // order and object geometry, not the incidental magnitudes of layer numbers.
  const layers=[...[...page.tiles.values()].map(item=>({key:`tile:${item.id}`,z:item.z})),
    ...[...page.pieces.values()].map(item=>({key:`picture:${item.id}`,z:item.z}))].sort((a,b)=>a.z-b.z);
  const ranks=new Map(layers.map((item,index)=>[item.key,index+1]));
  const ordered=(items,type)=>items.map(item=>({...item,z:ranks.get(`${type}:${item.id}`)})).sort((a,b)=>a.id.localeCompare(b.id));
  return JSON.parse(JSON.stringify({ strokes: page.strokes.map(({ id, by, tool, pts }) => ({ id, by, tool, pts })),
    tiles: ordered([...page.tiles.values()],'tile'), pieces: ordered([...page.pieces.values()],'picture'), offers: [...page.offers.values()],
    boxes: page.boxes, boxTaps: page.boxTaps, lines: page.lines, strip: page.strip, game: page.game, pictureIds: [...page.pictureIds] }));
}
function assets(code) {
  return [...authoritative(code).pictures.values()].map(pic => ({ id: pic.id, bytes: pic.bytes.length, hash: digest(pic.bytes) }));
}
async function condition(fn, description, timeout = 12_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await pause(25); }
  assert.fail(description);
}
async function check(session, name, action) {
  const item = { viewport: session.mobile ? 'phone' : 'desktop', name };
  report.cases.push(item);
  try { Object.assign(item, await action()); item.passed = true; return true; }
  catch (error) {
    item.passed = false; item.error = error.stack;
    await session.tutor.screenshot({ path: join(out, `failure-${report.cases.length}.png`) }).catch(() => {});
    const trace = {};
    for (const [role, page] of [['tutor', session.tutor], ['student', session.student]]) trace[role] = await page.evaluate(() => ({
      sent: window.pageSent.slice(-80).map(({ key, ...msg }) => msg),
      received: window.pageReceived.slice(-80).map(({ key, ...msg }) => msg),
      geometry: [...document.querySelectorAll('button[aria-label^="Board pages"], button[aria-label="Show drawing tools"]')].map(node => {
        const r=node.getBoundingClientRect(); return { label:node.getAttribute('aria-label'), x:r.x,y:r.y,width:r.width,height:r.height,hit:node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)) };
      }),
    })).catch(() => null);
    const current=realtime.rooms.get(session.code);
    if(current)trace.server={pageId:current.pageId,restoring:current.restoring,pages:[...current.pages].map(([id,page])=>({id,...snapshot(page)})),assets:assets(session.code)};
    writeFileSync(join(out,`failure-${report.cases.length}-trace.json`),JSON.stringify(trace,null,2));
    return false;
  } finally {
    writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({viewport:item.viewport,name:item.name,passed:item.passed}));
  }
}
async function instrument(page) {
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.pageSent = []; window.pageReceived = []; window.pageSockets = [];
    // These tests inspect game state, not speech synthesis or the host speakers.
    if (window.speechSynthesis) { window.speechSynthesis.speak = () => {}; window.speechSynthesis.cancel = () => {}; }
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        if (String(args[0]).endsWith('/ws')) window.pageSockets.push(this);
        this.addEventListener('message', event => { try { window.pageReceived.push(JSON.parse(event.data)); } catch {} });
      }
      send(data) { try { window.pageSent.push(JSON.parse(data)); } catch {} super.send(data); }
    };
  });
}
function attach(server) {
  return attachRealtime(server, { allowedOrigins: origins, maxRoomsPerIp: 100, canStartLesson: async () => ({ ok: true }) });
}
async function listen(port = 0) {
  server = http.createServer(handler);
  const sockets=new Set();connections.set(server,sockets);
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  realtime = attach(server);
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  const base = `http://127.0.0.1:${server.address().port}`;
  origins.add(base);
  return base;
}
async function start() {
  const pictures = Object.fromEntries(['beginWrite', 'add', 'get', 'isTutor'].map(method => [method, (...args) => realtime.pictures[method](...args)]));
  const words = Object.fromEntries(WORD_LEVELS.map(({ level }) => [level, WORD_BANK.filter(item => item.level === level).map(({ word, phonemes, display }) => ({ word, phonemes, display }))]));
  const app = createApp({ pictures, library: { list: async () => [], image: async () => null },
    words: { bank: async () => ({ levels: WORD_LEVELS.map(item => ({ ...item, count: words[item.level].length })), words }) } });
  if (dev) {
    const { createServer } = await import('vite');
    const { default: config } = await import('../vite.config.js');
    devTransport = http.createServer();
    await new Promise((done, fail) => { devTransport.once('error', fail); devTransport.listen(0, '127.0.0.1', done); });
    vite = await createServer({ ...config, root, configFile: false, cacheDir: join(out, 'vite-cache'),
      server: { ...config.server, middlewareMode: true, hmr: false, ws: { server: devTransport, host: '127.0.0.1', clientPort: devTransport.address().port }, proxy: undefined }, appType: 'spa' });
  }
  handler = dev ? (request, response) => {
    if (/^\/(?:api|auth)(?:\/|$)|^\/healthz(?:\?|$)/.test(request.url || '')) app(request, response);
    else vite.middlewares(request, response, () => { response.statusCode = 404; response.end('Not found'); });
  } : app;
  const base = await listen();
  browser = await (browserName === 'webkit' ? webkit : chromium).launch(browserName === 'chrome' ? { channel: 'chrome' } : {});
  return base;
}
async function restart() {
  const port = server.address().port;
  const previous=realtime, previousServer=server;
  previous.close();
  server.closeIdleConnections();
  await new Promise(done => server.close(done));
  // Socket close handlers may schedule room grace timers after close() clears
  // existing timers. This retired fixture must not keep the harness alive.
  await condition(()=>connections.get(previousServer).size===0,'Retired fixture connections must close');
  for(const room of previous.rooms.values())clearTimeout(room.closeTimer);
  await listen(port);
}
async function session(base, mobile) {
  const context = await browser.newContext({ viewport: mobile ? { width: 393, height: 852 } : { width: 1440, height: 900 }, hasTouch: mobile, isMobile: mobile });
  context.setDefaultTimeout(12_000);
  const tutor = await context.newPage(), student = await context.newPage();
  await instrument(tutor); await instrument(student);
  await tutor.goto(`${base}/whiteboard/teach`);
  await tutor.waitForFunction(() => window.pageReceived.some(msg => msg.t === 'room'));
  const code = (await latest(tutor, 'room')).code;
  await student.goto(`${base}/whiteboard/${code}`);
  await tutor.waitForFunction(() => window.pageReceived.some(msg => msg.t === 'presence' && msg.student));
  for (const page of [tutor, student]) for (const button of await page.getByRole('button', { name: 'Close this message', exact: true }).all()) if (await button.isVisible()) await button.click();
  await tutor.bringToFront();
  return { context, tutor, student, code, base, mobile, cdp: mobile && browserName !== 'webkit' ? await context.newCDPSession(tutor) : null };
}
async function activate(room, locator) { if (room.cdp) await locator.tap(); else await locator.click(); }
async function openPages(room) {
  if (!await chooser(room.tutor).isVisible()) await activate(room, pageTrigger(room.tutor));
  await chooser(room.tutor).waitFor({ state: 'visible' });
}
async function waitPage(room, index) {
  const lesson = authoritative(room.code), id = [...lesson.pages.keys()][index];
  assert(id, `Board ${index + 1} must exist`);
  for (const page of [room.tutor, room.student]) await page.waitForFunction(id => window.pageReceived.filter(msg => msg.t === 'board').at(-1)?.pageId === id, id);
  await pageTrigger(room.tutor).filter({ hasText: `${index + 1} / ${lesson.pages.size}` }).waitFor();
  await room.student.locator(`[data-board-page-indicator][aria-label="Page ${index + 1} of ${lesson.pages.size}"]`).waitFor();
  return id;
}
async function switchPage(room, index) {
  const expected = [...authoritative(room.code).pages.keys()][index];
  await openPages(room);
  await activate(room, chooser(room.tutor).locator('ol button').nth(index));
  await condition(() => authoritative(room.code).pageId === expected, 'Tutor page selection must reach server');
  return waitPage(room, index);
}
async function addPage(room) {
  const before = authoritative(room.code).pages.size;
  if (!room.mobile) await activate(room, room.tutor.getByRole('button', { name: 'Add blank board page', exact: true }));
  else { await openPages(room); await activate(room, chooser(room.tutor).getByRole('button', { name: 'Blank page', exact: true })); }
  await condition(() => authoritative(room.code).pages.size === before + 1, 'Blank page must be added');
  return waitPage(room, before);
}
async function closeMaterials(room) {
  const close = room.tutor.getByRole('button', { name: 'Close Materials', exact: true });
  if (await close.isVisible()) await activate(room, close);
}
async function materials(room, tab) {
  const { tutor } = room;
  const back = tutor.getByRole('button', { name: 'Return to materials', exact: true });
  if (await back.isVisible()) await activate(room, back);
  if (!await tutor.getByRole('tab', { name: tab, exact: true }).isVisible()) await activate(room, tutor.getByRole('button', { name: 'Materials', exact: true }));
  await activate(room, tutor.getByRole('tab', { name: tab, exact: true }));
}
async function games(room) {
  const { tutor } = room;
  if (await tutor.locator('[data-games-panel]').isVisible()) return;
  if (!await tutor.getByRole('button', { name: /^(Games|Game controls)$/ }).isVisible()) await activate(room, tutor.getByRole('button', { name: 'Materials', exact: true }));
  await activate(room, tutor.getByRole('button', { name: /^(Games|Game controls)$/ }));
}
async function countBoth(room, selector, count) {
  for (const page of [room.tutor, room.student]) await page.waitForFunction(({ selector, count }) => document.querySelectorAll(selector).length === count, { selector, count });
}
async function point(page, x, y) {
  return page.evaluate(({ x, y }) => { const svg = document.querySelector('[data-board-surface] > svg[role="img"]'); const point = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()); return { x: point.x, y: point.y }; }, { x, y });
}
async function ink(room) {
  const { tutor } = room;
  if (!await tutor.getByRole('button', { name: 'Draw', exact: true }).isVisible()) await activate(room, tutor.getByRole('button', { name: 'Show drawing tools', exact: true }));
  await activate(room, tutor.getByRole('button', { name: 'Draw', exact: true }));
  const close = tutor.getByRole('button', { name: 'Close drawing tools', exact: true });
  if (await close.isVisible()) await activate(room, close);
  const a = await point(tutor, 700, 650), b = await point(tutor, 900, 700);
  if (room.cdp) {
    await room.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a, id: 1 }] });
    for (let n = 1; n <= 5; n++) await room.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x-a.x)*n/5, y: a.y+(b.y-a.y)*n/5, id: 1 }] });
    await room.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else { await tutor.mouse.move(a.x,a.y); await tutor.mouse.down(); await tutor.mouse.move(b.x,b.y,{steps:5}); await tutor.mouse.up(); }
  await condition(() => authoritative(room.code).board.strokes.length > 0 && authoritative(room.code).board.strokes.every(s => s.done), 'A completed actual input stroke must be stored');
}
async function renderedInk(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-board-surface] canvas')].reduce((total, canvas) => { const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data; let pixels=0; for(let i=3;i<data.length;i+=4) if(data[i]) pixels++; return total+pixels; },0));
}
async function imageWorks(room) {
  for (const page of [room.tutor, room.student]) {
    await page.locator('[data-picture-piece] image').first().waitFor();
    const href = await page.locator('[data-picture-piece] image').first().getAttribute('href');
    const result = await page.evaluate(async url => { const res=await fetch(url); return {status:res.status, bytes:(await res.arrayBuffer()).byteLength}; },href);
    assert.equal(result.status,200); assert(result.bytes>0);
  }
}
async function run(base, mobile) {
  const room = await session(base, mobile), { tutor, student } = room;
  try {
    if (!await check(room, 'Board 1 accepts real tiles, ink, sound boxes and an uploaded picture on both screens', async () => {
      await materials(room,'Letters');
      await tutor.getByRole('textbox',{name:'Add tiles',exact:true}).fill('c a t');
      await activate(room,tutor.getByRole('button',{name:'Add',exact:true}));
      await countBoth(room,'[data-letter-tile]',3);
      await activate(room,tutor.getByRole('group',{name:'Sound boxes',exact:true}).getByRole('button',{name:'3',exact:true}));
      await activate(room,tutor.getByRole('button',{name:'Show boxes in view',exact:true}));
      await closeMaterials(room);
      const counter=tutor.getByRole('button',{name:'Sound box 2 counter',exact:true});
      await counter.focus(); await tutor.keyboard.press('Enter');
      await student.locator('[data-sound-box="1"][data-sound-pressed="true"]').waitFor();
      await ink(room);
      for (const page of [tutor,student]) await condition(async()=>await renderedInk(page)>0,'Ink must render on both screens');
      await materials(room,'Pictures');
      await tutor.locator('input[type="file"][accept="image/*"]').first().setInputFiles({name:'board-pages-fixture.jpg',mimeType:'image/jpeg',buffer:readFileSync(join(root,'src/whiteboard/fixtures/lip-biter-240.jpg'))});
      await countBoth(room,'[data-picture-piece]',1); await closeMaterials(room); await imageWorks(room);
      room.originalId=authoritative(room.code).pageId; room.original=snapshot(authoritative(room.code).board); room.assets=assets(room.code);
      assert.deepEqual(room.original.tiles.map(t=>t.text).sort(),['a','c','t']); assert.equal(room.original.boxes,3); assert.deepEqual(room.original.boxTaps,[1]); assert.equal(room.assets.length,1);
      await tutor.screenshot({path:join(out,`board-1-${mobile?'phone':'desktop'}.png`)});
      return {tiles:3,strokes:room.original.strokes.length,boxes:3,pressedBox:2,pictures:room.assets.length,input:room.cdp?'trusted touch':'mouse'};
    })) return;
    await check(room,'Blank board 2 follows the tutor; students have an indicator without navigation',async()=>{
      room.secondId=await addPage(room);
      const board=authoritative(room.code).board;
      assert.equal(board.tiles.size,0); assert.equal(board.strokes.length,0); assert.equal(board.pieces.size,0); assert.equal(board.boxes,0); assert.equal(board.game,null);
      await countBoth(room,'[data-letter-tile]',0); await countBoth(room,'[data-picture-piece]',0);
      assert.equal(await pageTrigger(student).count(),0); assert.equal(await student.getByRole('button',{name:'Add blank board page',exact:true}).count(),0);
      for(const page of[tutor,student]) assert.equal(await renderedInk(page),0);
      await tutor.screenshot({path:join(out,`blank-board-${mobile?'phone':'desktop'}.png`)});
      return {studentFollows:true,studentHasNoPageCommands:true,blank:true};
    });
    await check(room,'Returning to board 1 restores its tiles, ink, box counters and image',async()=>{
      await switchPage(room,0); assert.deepEqual(snapshot(authoritative(room.code).board),room.original);
      await countBoth(room,'[data-letter-tile]',3); await countBoth(room,'[data-picture-piece]',1); await imageWorks(room);
      for(const page of[tutor,student]) { assert(await renderedInk(page)>0); await page.locator('[data-sound-box="1"][data-sound-pressed="true"]').waitFor(); }
      return {preserved:true,sharedAssets:assets(room.code)};
    });
    await check(room,'Duplicated board work is independent while image bytes remain shared',async()=>{
      await openPages(room); await activate(room,chooser(tutor).getByRole('button',{name:'Duplicate',exact:true}));
      await condition(()=>authoritative(room.code).pages.size===3,'Duplicate creates exactly one board');
      room.copyId=await waitPage(room,2); assert.deepEqual(snapshot(authoritative(room.code).board),room.original); assert.deepEqual(assets(room.code),room.assets);
      await materials(room,'Letters'); await tutor.getByRole('textbox',{name:'Add tiles',exact:true}).fill('x'); await activate(room,tutor.getByRole('button',{name:'Add',exact:true})); await closeMaterials(room);
      await countBoth(room,'[data-letter-tile]',4); assert.equal(authoritative(room.code).pages.get(room.originalId).tiles.size,3);
      await switchPage(room,0); await countBoth(room,'[data-letter-tile]',3); assert.deepEqual(snapshot(authoritative(room.code).board),room.original);
      await switchPage(room,2); await countBoth(room,'[data-letter-tile]',4);
      return {cloneIndependent:true,bytesCopied:false,assets:assets(room.code)};
    });
    await check(room,'Removing clone pictures does not delete an image still referenced by another board',async()=>{
      await materials(room,'Pictures');
      await activate(room,tutor.getByRole('button',{name:'Remove all session images',exact:true}));
      await activate(room,tutor.getByRole('button',{name:'Sure? All session images and their board pieces go',exact:true}));
      await closeMaterials(room); await countBoth(room,'[data-picture-piece]',0);
      assert.deepEqual(assets(room.code),room.assets); assert.equal(authoritative(room.code).pages.get(room.originalId).pieces.size,1);
      await switchPage(room,0); await countBoth(room,'[data-picture-piece]',1); await imageWorks(room);
      return {originalImageRetained:true,sharedAssets:assets(room.code)};
    });
    await check(room,'A Phoneme Pop celebration cannot publish into another board after switching',async()=>{
      await switchPage(room,1); await games(room);
      await activate(room,tutor.getByRole('button',{name:'Start Phoneme Pop',exact:true}));
      await activate(room,tutor.getByRole('button',{name:'Level 2',exact:true}));
      await condition(()=>authoritative(room.code).board.game?.kind==='phoneme'&&authoritative(room.code).board.game.level===2,'Real game must publish level 2');
      await student.getByRole('button',{name:/^Hear .* and split it into sounds$/}).click();
      await condition(()=>authoritative(room.code).board.game?.phase==='tiles','Student split action must reach tutor');
      const count=authoritative(room.code).board.game.word.phonemes.length;
      for(let n=0;n<count;n++){ await activate(room,tutor.getByRole('button',{name:'Show me the next sound',exact:true})); await condition(()=>authoritative(room.code).board.game.selected.length===n+1,'Tutor sound selection must publish'); }
      await student.getByRole('button',{name:'Check word',exact:true}).click();
      await condition(()=>authoritative(room.code).board.game?.phase==='celebrating','A real correct answer must schedule the celebration timer');
      const game=JSON.parse(JSON.stringify(authoritative(room.code).board.game));
      await closeMaterials(room); await switchPage(room,0); const start=await tutor.evaluate(()=>window.pageSent.length);
      await pause(2100);
      assert.equal(authoritative(room.code).board.game,null); assert.deepEqual(authoritative(room.code).pages.get(room.secondId).game,game);
      const messages=await tutor.evaluate(n=>window.pageSent.slice(n).filter(msg=>msg.t==='game'),start);
      assert.equal(messages.length,0,'No old celebration timer may publish after the page boundary');
      await countBoth(room,'[data-letter-tile]',3);
      return {scheduledCelebration:true,waitedMs:2100,oldPagePublications:messages.length};
    });
    await check(room,'Phoneme Pop and Alphabet Bridge preserve independent per-board state',async()=>{
      await switchPage(room,1); await games(room); await activate(room,tutor.getByRole('button',{name:'Level 2',exact:true}));
      await condition(()=>authoritative(room.code).board.game?.kind==='phoneme'&&authoritative(room.code).board.game.phase==='word','Set a stable game state before persistence checks');
      const phoneme=JSON.parse(JSON.stringify(authoritative(room.code).board.game));
      await closeMaterials(room); room.bridgeId=await addPage(room); await games(room);
      await activate(room,tutor.getByRole('button',{name:'Start the bridge',exact:true}));
      await activate(room,tutor.getByRole('button',{name:'Show me the next gap',exact:true}));
      await condition(()=>Object.keys(authoritative(room.code).board.game?.placed||{}).length===1,'Bridge demonstration must publish one filled gap');
      const bridge=JSON.parse(JSON.stringify(authoritative(room.code).board.game)); await closeMaterials(room);
      await switchPage(room,1); assert.deepEqual(authoritative(room.code).board.game,phoneme); await student.getByRole('button',{name:/^Hear .* and split it into sounds$/}).waitFor();
      await switchPage(room,3); assert.deepEqual(authoritative(room.code).board.game,bridge); await student.getByRole('list',{name:'The bridge',exact:true}).waitFor();
      await tutor.screenshot({path:join(out,`bridge-board-${mobile?'phone':'desktop'}.png`)});
      await switchPage(room,0);
      room.deck=new Map([...authoritative(room.code).pages].map(([id,page])=>[id,snapshot(page)]));
      return {phonemeLevel:phoneme.level,bridgeFilledGaps:Object.keys(bridge.placed).length,boards:room.deck.size};
    });
    await check(room,'Starting Phoneme Pop on a blank board does not inherit another board’s score or round',async()=>{
      const previous=JSON.parse(JSON.stringify(authoritative(room.code).pages.get(room.secondId).game));
      assert(previous.score>0,'A progressed prior game is necessary to exercise inheritance');
      await addPage(room); await games(room);
      await activate(room,tutor.getByRole('button',{name:'Start Phoneme Pop',exact:true}));
      await condition(()=>authoritative(room.code).board.game?.kind==='phoneme','New board must start the real game');
      const fresh=authoritative(room.code).board.game;
      assert.equal(fresh.phase,'word');assert.equal(fresh.score,0);assert.equal(fresh.streak,0);assert.deepEqual(fresh.selected,[]);assert.deepEqual(fresh.solved,[]);assert.equal(fresh.feedback,null);
      await student.getByRole('button',{name:/^Hear .* and split it into sounds$/}).waitFor();
      await closeMaterials(room);await switchPage(room,1);
      assert.deepEqual(authoritative(room.code).board.game,previous,'Starting another board must retain the old game');
      await switchPage(room,0);
      room.deck=new Map([...authoritative(room.code).pages].map(([id,page])=>[id,snapshot(page)]));
      return {priorScore:previous.score,newScore:fresh.score,newPhase:fresh.phase,oldGamePreserved:true,boards:room.deck.size};
    });
    await check(room,'Tutor socket reconnect preserves active and inactive boards without another image upload',async()=>{
      const before=await marker(tutor);
      await tutor.evaluate(()=>window.pageSockets.findLast(socket=>socket.readyState===WebSocket.OPEN)?.close(1000,'fixture reconnect'));
      await tutor.waitForFunction(n=>window.pageReceived.slice(n).some(msg=>msg.t==='board'&&msg.reason==='sync'),before);
      await waitPage(room,0); assert.deepEqual(assets(room.code),room.assets);
      for(const[id,expected]of room.deck)assert.deepEqual(snapshot(authoritative(room.code).pages.get(id)),expected);
      return {boards:authoritative(room.code).pages.size,imageBytesDuplicated:false};
    });
    await check(room,'Browser refresh hydrates inactive boards and their games from the server',async()=>{
      await tutor.reload(); await tutor.waitForFunction(()=>window.pageReceived.some(msg=>msg.t==='board'&&msg.reason==='sync'));
      await waitPage(room,0); await imageWorks(room);
      await tutor.waitForFunction(count=>window.pageReceived.filter(msg=>msg.t==='page:cache').length>=count,room.deck.size-1);
      for(const index of[1,2,3,4,0])await switchPage(room,index);
      for(const[id,expected]of room.deck)assert.deepEqual(snapshot(authoritative(room.code).pages.get(id)),expected);
      return {inactiveBoardCachePackets:await tutor.evaluate(()=>window.pageReceived.filter(msg=>msg.t==='page:cache').length),restoredNavigation:true};
    });
    await check(room,'Controlled server restart restores the whole browser-retained deck atomically',async()=>{
      const beforeTutor=await marker(tutor),beforeStudent=await marker(student);
      await restart();
      await tutor.waitForFunction(({n,id})=>window.pageReceived.slice(n).some(msg=>msg.t==='board'&&msg.pageId===id&&msg.tiles?.length===3&&msg.pieces?.length===1),{n:beforeTutor,id:room.originalId},{timeout:25_000});
      await student.waitForFunction(({n,id})=>window.pageReceived.slice(n).some(msg=>msg.t==='board'&&msg.pageId===id&&msg.tiles?.length===3&&msg.pieces?.length===1),{n:beforeStudent,id:room.originalId},{timeout:25_000});
      await waitPage(room,0);
      assert.equal(authoritative(room.code).pages.size,room.deck.size);
      for(const[id,expected]of room.deck)assert.deepEqual(snapshot(authoritative(room.code).pages.get(id)),expected);
      assert.deepEqual(assets(room.code),room.assets);
      await countBoth(room,'[data-letter-tile]',3); await countBoth(room,'[data-picture-piece]',1); await imageWorks(room);
      const partial=await student.evaluate(({n,id})=>window.pageReceived.slice(n).filter(msg=>msg.t==='board'&&(msg.tiles?.length||msg.strokes?.length||msg.pieces?.length)&&!(msg.pageId===id&&msg.tiles?.length===3&&msg.strokes?.length===1&&msg.pieces?.length===1)),{n:beforeStudent,id:room.originalId});
      assert.equal(partial.length,0,'Student must not receive a partially restored live board');
      await tutor.screenshot({path:join(out,`restored-deck-${mobile?'phone':'desktop'}.png`)});
      return {boards:room.deck.size,activeTiles:3,sharedAssets:assets(room.code),partialStudentSnapshots:0};
    });
    if(mobile)await check(room,'Page controls, student indicator and chooser remain reachable on narrow and landscape phones',async()=>{
      const sizes=[{width:320,height:852},{width:740,height:390}],measurements=[];
      for(const viewport of sizes){
        await tutor.setViewportSize(viewport); await student.setViewportSize(viewport);
        await tutor.emulateMedia({reducedMotion:'reduce'});
        await tutor.locator('[data-board-footer]').waitFor();
        const footer=await tutor.locator('[data-board-footer]').evaluate(node=>{
          const f=node.getBoundingClientRect();
          return {x:f.x,y:f.y,width:f.width,height:f.height,actions:[...node.querySelectorAll('button')].filter(button=>button.getBoundingClientRect().width>0).map(button=>{const r=button.getBoundingClientRect();return {label:button.getAttribute('aria-label')||button.textContent.trim(),x:r.x,y:r.y,width:r.width,height:r.height,enabled:!button.disabled,hit:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})};
        });
        for(const action of footer.actions){
          assert(action.x>=footer.x-1&&action.x+action.width<=footer.x+footer.width+1,`${action.label} must fit the ${viewport.width}px board footer`);
          if(action.enabled)assert(action.hit,`${action.label} must receive native pointer input at ${viewport.width}px`);
        }
        await openPages(room);
        const bounds=await chooser(tutor).boundingBox();
        assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height+1,'Page chooser must fit the viewport');
        for(const button of await chooser(tutor).locator('button').all()){
          await button.scrollIntoViewIfNeeded();
          const hit=await button.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
          assert(hit,`Page chooser action ${await button.innerText()} must receive pointer input`);
        }
        await tutor.screenshot({path:join(out,`page-chooser-${viewport.width}x${viewport.height}.png`)});
        await tutor.keyboard.press('Escape');
        await tutor.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')?.startsWith('Board pages,'));
        assert.equal(await pageTrigger(student).count(),0);
        const studentBounds=await student.locator('[data-board-page-indicator]').boundingBox();
        assert(studentBounds.x>=0&&studentBounds.x+studentBounds.width<=viewport.width+1,'Student page status must fit');
        measurements.push({viewport,footer,chooser:bounds,studentIndicator:studentBounds});
      }
      return {measurements};
    });
  } finally { await room.context.close(); }
}
try { const base=await start(); for(const mobile of[false,true])await run(base,mobile); }
catch(error){report.fatal=error.stack;}
finally {
  await browser?.close(); realtime?.close(); await vite?.close();
  if(server?.listening)await new Promise(done=>server.close(done));
  if(server&&connections.has(server))await condition(()=>connections.get(server).size===0,'Final fixture connections must close').catch(error=>{report.cleanupError=error.message;});
  for(const room of realtime?.rooms.values()||[])clearTimeout(room.closeTimer);
  if(devTransport?.listening)await new Promise(done=>devTransport.close(done));
  if(!dev){report.buildUnchanged=JSON.stringify(report.build)===JSON.stringify(buildFingerprint());if(!report.buildUnchanged)report.fatal='Production build changed during the run.';}
  report.passed=!report.cleanupError&&!report.fatal&&!report.pageErrors.length&&report.cases.length>0&&report.cases.every(item=>item.passed);
  writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));
  const failed=report.cases.filter(item=>!item.passed);
  console.log(JSON.stringify({output:out,passed:report.cases.length-failed.length,total:report.cases.length,pageErrors:report.pageErrors,fatal:report.fatal,failures:failed.map(({viewport,name,error})=>({viewport,name,error}))},null,2));
  if(!report.passed)process.exitCode=1;
}
