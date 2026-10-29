import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium, webkit } from '@playwright/test';
import { createApp } from '../server/index.js';
import { attachRealtime } from '../server/realtime.js';

// Tests the built app with real browser input and tutor/student WebSockets. The server
// has empty in-memory materials and no accounts, database, billing, or cloud adapters.
// Build first for production, or pass --dev for isolated Vite/StrictMode coverage.
// This script never builds or uses a running dev server.
const args = process.argv.slice(2);
let browserName = 'chrome', requestedOutput, dev = false;
for (let n = 0; n < args.length; n++) {
  const arg = args[n];
  if (arg === '--dev') dev = true;
  else if (arg === '--browser') browserName = args[++n];
  else if (arg.startsWith('--browser=')) browserName = arg.slice(10);
  else if (arg === '--output') requestedOutput = args[++n];
  else if (arg.startsWith('--output=')) requestedOutput = arg.slice(9);
  else if (arg === '--help') {
    console.log('Usage: npm run test:alphabet-drag -- [--dev] [--browser chrome|chromium|webkit] [--output DIRECTORY]');
    process.exit(0);
  } else throw new Error(`Unknown option: ${arg}`);
}
assert(['chrome', 'chromium', 'webkit'].includes(browserName), 'Choose chrome, chromium, or webkit.');
const root = fileURLToPath(new URL('../', import.meta.url));
if (!dev) assert(existsSync(join(root, 'dist/index.html')), 'Build the app first with npm run build.');
const out = requestedOutput ? resolve(requestedOutput) : mkdtempSync(join(tmpdir(), 'mpt-alphabet-drag-'));
mkdirSync(out, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { frontend: dev ? 'vite middleware' : 'production build', browser: browserName, isolatedProductionServer: true, ephemeralPort: true, realWebSockets: true, cloudServices: false, cases: [] };
let server, realtime, browser, base, vite;

async function startServer() {
  const allowedOrigins = new Set();
  const pictures = {
    beginWrite: (code, key) => realtime.pictures.beginWrite(code, key),
    add: upload => realtime.pictures.add(upload),
    get: (code, id) => realtime.pictures.get(code, id),
    isTutor: (code, key) => realtime.pictures.isTutor(code, key),
  };
  const app = createApp({ pictures, library: { list: async () => [] }, words: { bank: async () => ({ levels: [], words: {} }) } });
  if (dev) {
    const { createServer } = await import('vite');
    const { default: config } = await import('../vite.config.js');
    vite = await createServer({ ...config, root, configFile: false, cacheDir: join(out, 'vite-cache'),
      server: { ...config.server, middlewareMode: true, hmr: false, proxy: undefined, port: undefined, strictPort: false }, appType: 'spa' });
  }
  server = http.createServer(dev ? (req, res) => {
    if (/^\/(?:api|auth)(?:\/|$)|^\/healthz(?:\?|$)/.test(req.url || '')) app(req, res);
    else vite.middlewares(req, res, () => { res.statusCode = 404; res.end('Not found'); });
  } : app);
  realtime = attachRealtime(server, { allowedOrigins, canStartLesson: async () => ({ ok: true }) });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  base = `http://127.0.0.1:${server.address().port}`;
  allowedOrigins.add(base);
}

async function stopServer() {
  realtime?.close();
  await vite?.close();
  if (server?.listening) await new Promise(done => server.close(done));
}

async function instrument(page) {
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.dragReceived = []; window.dragSent = []; window.dragCSP = []; window.dragKeys = [];
    window.addEventListener('keydown', event => window.dragKeys.push({ key: event.key, focused: document.hasFocus() }), true);
    document.addEventListener('securitypolicyviolation', event => window.dragCSP.push(`${event.effectiveDirective}:${event.blockedURI}`));
    document.addEventListener('pointerdown', event => { window.dragPointerId = event.pointerId; }, true);
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        if (new URL(args[0], window.location.href).pathname === '/ws') window.dragSocket = this;
        this.addEventListener('message', event => {
          try {
            const message = JSON.parse(event.data);
            // A controlled network-delivery delay verifies that the UI waits for the
            // authoritative echo rather than announcing success immediately on release.
            if (message.t === 'tile:add' && window.dragDelayNextTileAdd && !event.dragReplayed) {
              const delay = window.dragDelayNextTileAdd; window.dragDelayNextTileAdd = 0;
              event.stopImmediatePropagation();
              setTimeout(() => { const replay = new MessageEvent('message', { data: event.data }); replay.dragReplayed = true; this.dispatchEvent(replay); }, delay);
              return;
            }
            window.dragReceived.push(message);
          } catch {}
        });
      }
      send(data) { try { window.dragSent.push(JSON.parse(data)); } catch {} super.send(data); }
    };
  });
}

async function dismissNotices(page) {
  for (const close of await page.getByRole('button', { name: 'Close this message', exact: true }).all()) {
    if (await close.isVisible()) await close.click();
  }
}

async function setup(viewport, mobile) {
  const tutorContext = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const studentContext = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  const tutor = await tutorContext.newPage(), student = await studentContext.newPage();
  await instrument(tutor); await instrument(student);
  await tutor.goto(`${base}/whiteboard/teach`);
  await tutor.waitForFunction(() => window.dragReceived.some(message => message.t === 'room'));
  const code = await tutor.evaluate(() => window.dragReceived.find(message => message.t === 'room').code);
  const session = { tutorContext, studentContext, tutor, student, mobile, touch: mobile && browserName !== 'webkit', viewport, cdp: mobile && browserName !== 'webkit' ? await tutorContext.newCDPSession(tutor) : null };
  if (viewport.width === 1024) await noticeCase(session);
  await student.goto(`${base}/whiteboard/${code}`);
  await tutor.getByText('Student connected', { exact: true }).waitFor();
  if (viewport.width !== 1024) await dismissNotices(tutor);
  await dismissNotices(student);
  const x = (24 + 11.5 * 1552 / 26) / 1600;
  await tutor.evaluate(x => window.dragSocket.send(JSON.stringify({ t: 'hands', r: true, l: false, at: { r: { x, y: 0.09, letter: 'L' } } })), x);
  await tutor.waitForFunction(x => {
    const hand = window.dragReceived.filter(message => message.t === 'hands').at(-1)?.hands.r;
    return hand?.on && hand.letter === 'L' && Math.abs(hand.x - x) < 0.001;
  }, x);
  await pause(150); await tutor.bringToFront();
  return session;
}

async function sourcePoint(session, letter = 'L') {
  if (session.mobile) {
    const rect = await session.tutor.getByRole('group', { name: 'Alphabet', exact: true }).locator(`[data-letter="${letter}"]`).boundingBox();
    assert(rect); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }
  return session.tutor.evaluate(letter => {
    const svg = document.querySelector('[data-board-surface] > svg[role="img"]');
    const x = 24 + ('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(letter) + 0.5) * 1552 / 26;
    const p = new DOMPoint(x, 90).matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  }, letter);
}

async function dropPoint(session) {
  return session.tutor.evaluate(mobile => {
    const svg = document.querySelector('[data-board-surface] > svg[role="img"]');
    if (!mobile) { const p = new DOMPoint(500, 450).matrixTransform(svg.getScreenCTM()); return { x: p.x, y: p.y }; }
    const paper = svg.getBoundingClientRect(), frame = document.querySelector('[data-board-surface]').getBoundingClientRect();
    return { x: Math.max(paper.left, frame.left) + Math.min(paper.width, frame.width) * 0.5, y: Math.max(paper.top, frame.top) + Math.min(paper.height, frame.height) * 0.5 };
  }, session.mobile);
}

async function press(session, at) {
  if (session.touch) await session.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at, id: 1 }] });
  else { await session.tutor.mouse.move(at.x, at.y); await session.tutor.mouse.down(); }
}

async function move(session, from, to) {
  if (!session.touch) return session.tutor.mouse.move(to.x, to.y, { steps: 12 });
  for (let n = 1; n <= 12; n++) {
    await session.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * n / 12, y: from.y + (to.y - from.y) * n / 12, id: 1 }] });
    await pause(12);
  }
}

async function release(session, cancelled = false) {
  if (session.touch) await session.cdp.send('Input.dispatchTouchEvent', { type: cancelled ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  else await session.tutor.mouse.up();
}

async function pickup(session, letter, point) {
  const portal = session.tutor.locator('[data-alphabet-pickup]');
  await portal.waitFor({ state: 'visible', timeout: 2000 });
  assert.equal(await portal.locator('[data-hand-pose="grab"]').count(), 1, 'Immediate pickup must contain the fist pose');
  assert((await portal.textContent()).includes(letter), 'Immediate pickup must identify the selected letter');
  const rect = await portal.boundingBox(); assert(rect);
  assert(point.x >= rect.x - 120 && point.x <= rect.x + rect.width + 120, 'Pickup should be near the pointer');
  return rect;
}

async function cleared(session) {
  await session.tutor.locator('[data-alphabet-pickup]').waitFor({ state: 'detached' });
  assert.equal(await session.tutor.locator('[data-alphabet-preview]').count(), 0, 'Drop/cancel must clear the board preview');
}

async function recordCase(session, name, action) {
  const result = { viewport: session.viewport, input: session.touch ? 'trusted Chrome touch' : `${browserName} mouse`, name };
  report.cases.push(result);
  try { Object.assign(result, await action()); result.passed = true; }
  catch (error) {
    result.failure = error.message;
    await session.tutor.screenshot({ path: `${out}/failure-${session.viewport.width}-${report.cases.length}.png` }).catch(() => {});
    await session.tutor.evaluate(() => window.dispatchEvent(new Event('blur'))).catch(() => {});
    await release(session, true).catch(() => {});
  }
}

async function noticeCase(session) {
  await recordCase(session, 'Alphabet press through the initial notice body', async () => {
    const close = session.tutor.getByRole('button', { name: 'Close this message', exact: true });
    await close.waitFor({ state: 'visible' });
    const notice = await close.locator('..').boundingBox(), button = await close.boundingBox();
    assert(notice && button);
    let chosen;
    for (const letter of 'LMNOPKJI') {
      const point = await sourcePoint(session, letter);
      if (point.x > notice.x && point.x < notice.x + notice.width && point.y > notice.y && point.y < notice.y + notice.height && !(point.x >= button.x && point.x <= button.x + button.width && point.y >= button.y && point.y <= button.y + button.height)) { chosen = { letter, point }; break; }
    }
    assert(chosen, 'This viewport must reproduce a notice body overlapping an alphabet letter');
    await press(session, chosen.point); await pickup(session, chosen.letter, chosen.point);
    await session.tutor.screenshot({ path: `${out}/notice-through-pickup-1024.png` });
    await release(session); await cleared(session);
    assert.equal(await session.tutor.locator('[data-letter-tile]').count(), 0);
    await close.click(); await close.waitFor({ state: 'detached' });
    return { letter: chosen.letter, noticeBodyPassesPointer: true, closeButtonWorks: true, clickDidNotCreateTile: true };
  });
}

async function resetGlove(session, on = true) {
  await session.tutor.evaluate(on => window.dragSocket.send(JSON.stringify({ t: 'hands', r: on, l: false, at: { r: { x: (24 + 11.5 * 1552 / 26) / 1600, y: 0.09, letter: 'L' } } })), on);
  await pause(100);
}

async function palmCase(session) {
  await recordCase(session, 'Shared hand remains draggable by its palm below the alphabet', async () => {
    await resetGlove(session);
    const count = await session.tutor.locator('[data-letter-tile]').count();
    const point = await session.tutor.evaluate(() => {
      const svg = document.querySelector('[data-board-surface] > svg[role="img"]');
      const p = new DOMPoint(24 + 11.5 * 1552 / 26, 202).matrixTransform(svg.getScreenCTM());
      return { x: p.x, y: p.y };
    });
    await press(session, point);
    await session.tutor.locator('[data-board-surface] [data-hand="r"][data-hand-pose="grab"]').waitFor({ state: 'visible' });
    assert.equal(await session.tutor.locator('[data-alphabet-pickup]').count(), 0, 'Shared-hand dragging must not show a letter badge');
    await move(session, point, await dropPoint(session)); await release(session); await pause(100);
    assert.equal(await session.tutor.locator('[data-letter-tile]').count(), count);
    assert.equal(await session.student.locator('[data-letter-tile]').count(), count);
    await session.tutor.locator('[data-board-surface] [data-hand="r"][data-hand-pose="point"]').waitFor({ state: 'visible' });
    const hand = await session.student.evaluate(() => window.dragReceived.filter(message => message.t === 'hand' && message.side === 'r').at(-1));
    assert(hand && hand.by === null && hand.y > 0.2);
    await resetGlove(session);
    return { fistWhileHeld: true, noLetterPickup: true, noTileCreated: true, handMovementSynced: true };
  });
}

async function studentCase(session) {
  await recordCase(session, 'Student cannot create alphabet tiles even with tools enabled', async () => {
    await resetGlove(session, false);
    await session.tutor.evaluate(() => window.dragSocket.send(JSON.stringify({ t: 'tools', on: true })));
    await session.student.waitForFunction(() => window.dragReceived.some(message => message.t === 'tools' && message.on));
    const studentSession = { ...session, tutor: session.student, mobile: false };
    const count = await session.student.locator('[data-letter-tile]').count();
    const sent = await session.student.evaluate(() => window.dragSent.length);
    const start = await sourcePoint(studentSession, 'A'), end = await dropPoint(studentSession);
    await session.student.bringToFront(); await press(studentSession, start);
    assert.equal(await session.student.locator('[data-alphabet-pickup]').count(), 0);
    await move(studentSession, start, end); await release(studentSession); await pause(120);
    assert.equal(await session.student.locator('[data-letter-tile]').count(), count);
    assert.equal(await session.tutor.locator('[data-letter-tile]').count(), count);
    assert.equal(await session.student.evaluate(sent => window.dragSent.slice(sent).filter(message => message.t === 'tile:add-at').length, sent), 0);
    await session.tutor.evaluate(() => window.dragSocket.send(JSON.stringify({ t: 'tools', on: false })));
    await session.tutor.bringToFront(); await resetGlove(session);
    return { toolsEnabled: true, noPickup: true, noTileCreationMessage: true, noTileOnEitherScreen: true };
  });
}

async function multiTouchCase(session) {
  await recordCase(session, 'Second touch on the board cancels a pickup from the mobile alphabet', async () => {
    const count = await session.tutor.locator('[data-letter-tile]').count();
    const start = await sourcePoint(session), second = await dropPoint(session);
    const sent = await session.tutor.evaluate(() => window.dragSent.length);
    await press(session, start); await pickup(session, 'L', start);
    await session.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }, { ...second, id: 2 }] });
    await cleared(session);
    await session.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await pause(100);
    assert.equal(await session.tutor.locator('[data-letter-tile]').count(), count);
    const messages = await session.tutor.evaluate(sent => window.dragSent.slice(sent).map(message => message.t), sent);
    assert(!messages.includes('tile:add-at') && !messages.includes('begin'), 'Cancellation must not create a tile or ink');
    return { crossSurfaceCancellation: true, noTileCreated: true, noInkCreated: true };
  });
}

async function edgeCase(session) {
  await recordCase(session, 'Pickup remains inside the bottom and right viewport edges', async () => {
    const count = await session.tutor.locator('[data-letter-tile]').count();
    const start = await sourcePoint(session), corner = { x: session.viewport.width - 2, y: session.viewport.height - 2 };
    await press(session, start); await pickup(session, 'L', start); await move(session, start, corner);
    const rect = await session.tutor.locator('[data-alphabet-pickup]').boundingBox();
    assert(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= session.viewport.width && rect.y + rect.height <= session.viewport.height, `Pickup outside viewport: ${JSON.stringify(rect)}`);
    await session.tutor.screenshot({ path: `${out}/edge-${session.viewport.width}.png` });
    await release(session); await cleared(session); await pause(100);
    await invalidStatus(session);
    assert.equal(await session.tutor.locator('[data-letter-tile]').count(), count, 'Releasing outside the paper must not create a tile');
    return { viewportFit: true, invalidDropCreatesNoTile: true, bounds: rect };
  });
}

async function success(session) {
  await recordCase(session, 'L drag with shared glove on L', async () => {
    const { tutor, student } = session;
    const count = await tutor.locator('[data-letter-tile]').count();
    const sent = await tutor.evaluate(() => window.dragSent.length);
    const start = await sourcePoint(session), end = await dropPoint(session);
    await press(session, start);
    const initial = await pickup(session, 'L', start);
    await tutor.screenshot({ path: `${out}/pickup-${session.viewport.width}.png` });
    await move(session, start, end);
    const moved = await pickup(session, 'L', end);
    assert(Math.hypot(moved.x - initial.x, moved.y - initial.y) > 25, 'Pickup must visibly follow the pointer after leaving the strip');
    assert.equal(await tutor.locator('[data-alphabet-preview]').count(), 1, 'Valid board drop target must be visible');
    await tutor.screenshot({ path: `${out}/drag-${session.viewport.width}.png` });
    await release(session); await cleared(session);
    await confirmedStatus(session, 'L');
    await tutor.waitForFunction(count => document.querySelectorAll('[data-letter-tile]').length === count + 1, count);
    await student.waitForFunction(count => document.querySelectorAll('[data-letter-tile]').length === count + 1, count);
    const messages = await tutor.evaluate(sent => window.dragSent.slice(sent).filter(message => message.t === 'tile:add-at' || message.t === 'hand'), sent);
    const adds = messages.filter(message => message.t === 'tile:add-at');
    assert.equal(adds.length, 1, 'One drag must send exactly one tile creation');
    assert.equal(adds[0].tile.text, 'L');
    assert.equal(messages.filter(message => message.t === 'hand' && message.a === 'grab').length, 0, 'Letter press must win over the shared glove');
    const tile = adds[0].tile;
    for (const page of [tutor, student]) {
      const actual = await page.evaluate(id => window.dragReceived.filter(message => message.t === 'tile:add').flatMap(message => message.tiles).find(value => value.id === id), tile.id);
      assert(actual && actual.text === 'L' && Number.isFinite(actual.x) && Number.isFinite(actual.y));
      await page.locator(`[data-letter-tile="${tile.id}"]`).waitFor();
    }
    return { immediateFistAndLetter: true, followedPointer: true, tileMessages: adds.length, tutorStudentSameTile: true, sharedHandNotGrabbed: true };
  });
}



async function confirmedStatus(session, letter) {
  const status = session.tutor.locator('[data-letter-drop-status="placed"]');
  await status.waitFor({ state: 'visible', timeout: 5000 });
  assert((await status.textContent()).includes(`${letter} added`));
}

async function invalidStatus(session) {
  const status = session.tutor.locator('[data-letter-drop-status="error"]');
  await status.waitFor({ state: 'visible' });
  assert((await status.textContent()).includes('white writing area'));
}

async function pendingConfirmationCase(session) {
  await recordCase(session, 'Drop confirmation waits for the authoritative tile echo', async () => {
    const { tutor, student } = session;
    const count = await tutor.locator('[data-letter-tile]').count();
    await tutor.evaluate(() => { window.dragDelayNextTileAdd = 500; });
    const start = await sourcePoint(session, 'P'), end = await stagePoint(tutor, { x: 1200, y: 700 });
    await press(session, start); await pickup(session, 'P', start); await move(session, start, end); await release(session);
    const pending = tutor.locator('[data-letter-drop-status="pending"]');
    await pending.waitFor({ state: 'visible' });
    assert((await pending.textContent()).includes('Placing P'));
    assert.equal(await tutor.locator('[data-letter-tile]').count(), count, 'Tutor must wait for its shared-state echo');
    await student.waitForFunction(count => document.querySelectorAll('[data-letter-tile]').length === count + 1, count);
    await confirmedStatus(session, 'P');
    assert.equal(await tutor.locator('[data-letter-tile]').count(), count + 1);
    return { pendingBeforeEcho: true, placedOnlyAfterEcho: true, noExtraClickNeeded: true, controlledDeliveryDelayMs: 500 };
  });
}

async function disconnectedCase(session) {
  await recordCase(session, 'Disconnected release explains reconnecting without losing a sent tile', async () => {
    const count = await session.tutor.locator('[data-letter-tile]').count();
    await session.tutorContext.setOffline(true);
    try {
      await session.tutor.evaluate(() => window.dragSocket.close());
      await session.tutor.waitForFunction(() => window.dragSocket.readyState !== WebSocket.OPEN);
      await pause(100);
      const sentBefore = await session.tutor.evaluate(() => window.dragSent.length);
      const start = await sourcePoint(session, 'R'), end = await stagePoint(session.tutor, { x: 1200, y: 700 });
      await press(session, start); await pickup(session, 'R', start); await move(session, start, end); await release(session);
      const status = session.tutor.locator('[data-letter-drop-status="error"]');
      await status.waitFor({ state: 'visible' });
      assert((await status.textContent()).toLowerCase().includes('reconnecting'));
      assert.equal(await session.tutor.evaluate(n => window.dragSent.slice(n).filter(message => message.t === 'tile:add-at').length, sentBefore), 0);
      assert.equal(await session.tutor.locator('[data-letter-tile]').count(), count);
      return { explicitReconnectMessage: true, noTileSendWhileDisconnected: true };
    } finally {
      await session.tutorContext.setOffline(false);
      await session.tutor.waitForFunction(() => window.dragSocket.readyState === WebSocket.OPEN, undefined, { timeout: 15000 });
      await pause(150);
    }
  });
}

async function fullBoardCase(session) {
  await recordCase(session, 'A full tile board explains the limit before sending another tile', async () => {
    const { tutor, student } = session;
    await tutor.evaluate(() => window.dragSocket.send(JSON.stringify({ t: 'tile:add', tiles: Array.from({ length: 60 }, (_, n) => ({ id: `cap-${Date.now()}-${n}`, text: 'a' })) })));
    for (const page of [tutor, student]) await page.waitForFunction(() => document.querySelectorAll('[data-letter-tile]').length === 60);
    const sentBefore = await tutor.evaluate(() => window.dragSent.length);
    const start = await sourcePoint(session, 'L'), end = await stagePoint(tutor, { x: 800, y: 400 });
    await press(session, start); await pickup(session, 'L', start); await move(session, start, end); await release(session);
    const status = tutor.locator('[data-letter-drop-status="error"]'); await status.waitFor({ state: 'visible' });
    assert((await status.textContent()).includes('60 tiles'));
    assert.equal(await tutor.evaluate(n => window.dragSent.slice(n).filter(message => message.t === 'tile:add-at').length, sentBefore), 0);
    assert.equal(await tutor.locator('[data-letter-tile]').count(), 60);
    return { explicitLimitMessage: true, noAdditionalTileSent: true, tileLimit: 60 };
  });
}

async function stagePoint(page, point) {
  return page.evaluate(point => {
    const svg = document.querySelector('[data-board-surface] > svg[role="img"]');
    const p = new DOMPoint(point.x, point.y).matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  }, point);
}

async function releaseCase(session, name, point, valid, letter = 'L') {
  await recordCase(session, name, async () => {
    const { tutor, student } = session;
    const count = await tutor.locator('[data-letter-tile]').count();
    const sentBefore = await tutor.evaluate(() => window.dragSent.length);
    const start = await sourcePoint(session, letter), end = await stagePoint(tutor, point);
    assert(end.x >= 0 && end.x <= session.viewport.width && end.y >= 0 && end.y <= session.viewport.height, 'Requested release point must be visible');
    await press(session, start); await pickup(session, letter, start); await move(session, start, end);
    const dropReady = await tutor.locator('[data-alphabet-pickup]').getAttribute('data-drop-ready');
    assert.equal(dropReady, String(valid), 'Preview must agree with the paper boundary');
    await release(session); await cleared(session);
    if (valid) {
      await tutor.waitForFunction(count => document.querySelectorAll('[data-letter-tile]').length === count + 1, count);
      await student.waitForFunction(count => document.querySelectorAll('[data-letter-tile]').length === count + 1, count);
    } else await pause(150);
    if (valid) await confirmedStatus(session, letter); else await invalidStatus(session);
    const adds = await tutor.evaluate(n => window.dragSent.slice(n).filter(message => message.t === 'tile:add-at'), sentBefore);
    assert.equal(adds.length, valid ? 1 : 0);
    assert.equal(await tutor.locator('[data-letter-tile]').count(), count + (valid ? 1 : 0));
    const sent = adds[0]?.tile;
    const echo = sent ? await tutor.evaluate(id => window.dragReceived.filter(message => message.t === 'tile:add').flatMap(message => message.tiles).find(tile => tile.id === id), sent.id) : null;
    if (valid) {
      assert(echo && echo.text === letter, 'Authoritative server echo must match the letter');
      assert(Math.abs(echo.x - sent.x) <= 0.11 && Math.abs(echo.y - sent.y) <= 0.11, 'Server coordinates must agree with the released tile');
      await student.locator(`[data-letter-tile="${sent.id}"]`).waitFor();
      assert(echo.x >= 24 && echo.y >= 184 && echo.x + 84 <= 1576 && echo.y + 112 <= 976, 'Accepted alphabet tile must fit fully inside the paper');
    }
    return { releaseStagePoint: point, dropReady, tileAddSent: adds.length, authoritativeEcho: Boolean(echo), sent: sent ? { text: sent.text, x: sent.x, y: sent.y } : null, echoed: echo ? { text: echo.text, x: echo.x, y: echo.y } : null, fullyInsidePaper: echo ? echo.x >= 24 && echo.y >= 184 && echo.x + 84 <= 1576 && echo.y + 112 <= 976 : null };
  });
}

async function releaseGeometryCases(session) {
  await releaseCase(session, 'Direct vertical crossing from the alphabet into paper', { x: 24 + 11.5 * 1552 / 26, y: 300 }, true);
  await releaseCase(session, 'Release just inside the left paper edge', { x: 25, y: 400 }, true);
  await releaseCase(session, 'Release just inside the top paper edge', { x: 800, y: 185 }, true);
  await releaseCase(session, 'Release just inside the right paper edge', { x: 1575, y: 500 }, true);
  await releaseCase(session, 'Release just inside the bottom paper edge', { x: 900, y: 975 }, true);
  await releaseCase(session, 'Gap between alphabet and paper rejects the drop', { x: 800, y: 170 }, false);
  await releaseCase(session, 'Grey margin beside the paper rejects the drop', { x: 20, y: 400 }, false);

  await session.tutor.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await pause(80);
  await releaseCase(session, 'Release transforms correctly after zooming in', { x: 800, y: 450 }, true);
  const board = await session.tutor.locator('[data-board-surface]').boundingBox();
  await session.tutor.mouse.move(board.x + board.width / 2, board.y + board.height / 2);
  await session.tutor.mouse.wheel(35, -35); await pause(100);
  await releaseCase(session, 'Release transforms correctly after panning', { x: 1000, y: 500 }, true);
  await session.tutor.getByRole('button', { name: 'Fit the whole board', exact: true }).click();
  await pause(80);
  await releaseCase(session, 'Release transforms correctly after Fit', { x: 1100, y: 600 }, true);

  await recordCase(session, 'Alphabet drop snaps into a sound box and synchronizes', async () => {
    const { tutor, student } = session;
    await tutor.getByRole('tab', { name: 'Letters', exact: true }).click();
    await tutor.getByRole('group', { name: 'Sound boxes', exact: true }).getByRole('button', { name: '3', exact: true }).click();
    const box = tutor.locator('[data-sound-box="1"]'); await box.waitFor({ state: 'visible' });
    const rect = await box.boundingBox(), end = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const start = await sourcePoint(session, 'C'), sentBefore = await tutor.evaluate(() => window.dragSent.length);
    await press(session, start); await pickup(session, 'C', start); await move(session, start, end);
    assert.equal(await box.getAttribute('data-drop-target'), 'true');
    await release(session); await cleared(session);
    await tutor.waitForFunction(n => window.dragSent.slice(n).some(message => message.t === 'tile:add-at'), sentBefore);
    const sent = await tutor.evaluate(n => window.dragSent.slice(n).find(message => message.t === 'tile:add-at').tile, sentBefore);
    const tile = tutor.locator(`[data-letter-tile="${sent.id}"]`); await tile.waitFor();
    await student.locator(`[data-letter-tile="${sent.id}"]`).waitFor();
    await confirmedStatus(session, 'C');
    const placed = await tile.boundingBox();
    assert(Math.abs(placed.x + placed.width / 2 - end.x) < 2 && Math.abs(placed.y + placed.height / 2 - end.y) < 2);
    const echo = await tutor.evaluate(id => window.dragReceived.filter(message => message.t === 'tile:add').flatMap(message => message.tiles).find(value => value.id === id), sent.id);
    assert(echo && Math.abs(echo.x - sent.x) < 0.11 && Math.abs(echo.y - sent.y) < 0.11);
    await tutor.getByRole('group', { name: 'Sound boxes', exact: true }).getByRole('button', { name: 'Off', exact: true }).click();
    return { targetHighlight: true, snappedToBox: true, authoritativeEcho: true, tutorStudentSameTile: true };
  });
}

async function cancelCase(session, kind) {
  await recordCase(session, kind, async () => {
    const count = await session.tutor.locator('[data-letter-tile]').count();
    const start = await sourcePoint(session), end = await dropPoint(session);
    await press(session, start); await pickup(session, 'L', start);
    if (kind !== 'click without movement') await move(session, start, end);
    if (kind === 'Escape cancellation') { await session.tutor.bringToFront(); await session.tutor.keyboard.press('Escape'); }
    if (kind === 'window blur cancellation') await session.tutor.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (kind === 'lost pointer capture cancellation') {
      await session.tutor.evaluate(mobile => {
        const target = mobile ? document.querySelector('[role="group"][aria-label="Alphabet"]') : document.querySelector('[data-board-surface] > svg[role="img"]');
        if (!target?.hasPointerCapture(window.dragPointerId)) throw new Error('Expected native pointer capture before cancellation');
        target.releasePointerCapture(window.dragPointerId);
      }, session.mobile);
    }
    if (kind === 'pointer cancellation' && !session.touch) {
      await session.tutor.evaluate(({ at, mobile }) => (mobile ? document.querySelector('[role="group"][aria-label="Alphabet"]') : document.querySelector('[data-board-surface] > svg[role="img"]')).dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: window.dragPointerId, pointerType: 'mouse', isPrimary: true, clientX: at.x, clientY: at.y })), { at: end, mobile: session.mobile });
    }
    await release(session, kind === 'pointer cancellation');
    await cleared(session); await pause(150);
    const actual = await session.tutor.locator('[data-letter-tile]').count();
    assert.equal(actual, count, `Aborted/non-drag gesture must not create a tile; key events: ${JSON.stringify(await session.tutor.evaluate(() => window.dragKeys.slice(-3)))}`);
    assert.equal(await session.student.locator('[data-letter-tile]').count(), count, 'Student must not receive a tile for an aborted gesture');
    return { noTileCreated: true, pickupAndPreviewCleared: true, syntheticCancellationEvent: kind === 'window blur cancellation' || (kind === 'pointer cancellation' && !session.touch) };
  });
}

try {
  mkdirSync(out, { recursive: true }); report.pageErrors = [];
  await startServer();
  browser = await (browserName === 'webkit' ? webkit : chromium).launch({ ...(browserName === 'chrome' ? { channel: 'chrome' } : {}), headless: true });
  report.browserVersion = browser.version();
  for (const spec of [
    { viewport: { width: 1440, height: 900 }, mobile: false },
    { viewport: { width: 1024, height: 768 }, mobile: false },
    { viewport: { width: 393, height: 852 }, mobile: true },
  ]) {
    const session = await setup(spec.viewport, spec.mobile);
    try {
      await success(session);
      await cancelCase(session, 'click without movement');
      await cancelCase(session, 'pointer cancellation');
      await cancelCase(session, 'lost pointer capture cancellation');
      if (!session.mobile) {
        await cancelCase(session, 'Escape cancellation');
        await cancelCase(session, 'window blur cancellation');
        await palmCase(session);
        await studentCase(session);
      } else {
        await cancelCase(session, 'window blur cancellation');
        if (session.touch) await multiTouchCase(session);
        await success(session);
      }
      await edgeCase(session);
      if (session.viewport.width === 1440) {
        await releaseGeometryCases(session);
        await pendingConfirmationCase(session);
        await disconnectedCase(session);
        await fullBoardCase(session);
      }
      for (const page of [session.tutor, session.student]) assert.deepEqual(await page.evaluate(() => window.dragCSP), []);
    } finally {
      await session.tutorContext.close(); await session.studentContext.close();
    }
  }
  assert.deepEqual(report.pageErrors, []);
  assert.equal(report.cases.filter(result => !result.passed).length, 0, 'All browser regression cases must pass');
  report.passed = true;
  console.log(JSON.stringify({ passed: true, cases: report.cases.length, browser: report.browserVersion, output: out }));
} catch (error) {
  report.failure = error.stack;
  console.error(error.stack); process.exitCode = 1;
} finally {
  try { writeFileSync(`${out}/${dev ? 'dev-' : ''}${browserName}-report.json`, JSON.stringify(report, null, 2)); }
  finally { try { await browser?.close(); } finally { await stopServer(); } }
}
