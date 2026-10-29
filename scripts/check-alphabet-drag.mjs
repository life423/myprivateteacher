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
    window.dragReceived = []; window.dragSent = []; window.dragCSP = []; window.dragKeys = []; window.dragPointerMoves = 0;
    window.addEventListener('keydown', event => window.dragKeys.push({ key: event.key, focused: document.hasFocus() }), true);
    document.addEventListener('securitypolicyviolation', event => window.dragCSP.push(`${event.effectiveDirective}:${event.blockedURI}`));
    document.addEventListener('pointerdown', event => { window.dragPointerId = event.pointerId; window.dragLastDown = { x: event.clientX, y: event.clientY }; }, true);
    document.addEventListener('pointerup', event => { window.dragLastUp = { x: event.clientX, y: event.clientY }; }, true);
    document.addEventListener('pointermove', () => { window.dragPointerMoves += 1; }, true);
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        if (new URL(args[0], window.location.href).pathname === '/ws') window.dragSocket = this;
        this.addEventListener('message', event => {
          try {
            const message = JSON.parse(event.data);
            if (window.dragDelayInbound && !event.dragReplayed) {
              const delay = window.dragDelayInbound;
              event.stopImmediatePropagation();
              setTimeout(() => { const replay = new MessageEvent('message', { data: event.data }); replay.dragReplayed = true; this.dispatchEvent(replay); }, delay);
              return;
            }
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
  const session = { tutorContext, studentContext, tutor, student, mobile, touch: mobile && browserName !== 'webkit', viewport, cdp: browserName !== 'webkit' ? await tutorContext.newCDPSession(tutor) : null };
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

async function pickup(session, letter, point, withHand = true) {
  const portal = session.tutor.locator('[data-alphabet-pickup]');
  await portal.waitFor({ state: 'visible', timeout: 2000 });
  assert.equal(await portal.locator('[data-hand-pose="grab"]').count(), withHand ? 1 : 0, withHand ? 'Immediate pickup must show the borrowed fist' : 'Fallback must show the letter without inventing a glove');
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
    const borrowed = messages.filter(message => message.t === 'hand' && message.a === 'grab');
    assert.equal(borrowed.length, 1, 'Letter carry should borrow exactly one existing shared glove');
    assert.equal(new Set(borrowed.map(message => message.side)).size, 1);
    const at = await releasedCoordinates(tutor);
    await handsAt(tutor, { [borrowed[0].side]: { on: true, by: null, x: at.x / 1600, y: at.y / 1000 } });
    const tile = adds[0].tile;
    for (const page of [tutor, student]) {
      const actual = await page.evaluate(id => window.dragReceived.filter(message => message.t === 'tile:add').flatMap(message => message.tiles).find(value => value.id === id), tile.id);
      assert(actual && actual.text === 'L' && Number.isFinite(actual.x) && Number.isFinite(actual.y));
      await page.locator(`[data-letter-tile="${tile.id}"]`).waitFor();
    }
    return { immediateFistAndLetter: true, followedPointer: true, tileMessages: adds.length, tutorStudentSameTile: true, existingSharedGloveBorrowed: true, sharedGloveEndsAtDrop: true };
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



async function boardCoordinates(page, point) {
  return page.evaluate(point => {
    const svg = document.querySelector('[data-board-surface] > svg[role="img"]');
    const p = new DOMPoint(point.x, point.y).matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  }, point);
}

async function releasedCoordinates(page) {
  const delivered = await page.evaluate(() => window.dragLastUp);
  assert(delivered, 'Expected a delivered pointerup event');
  return boardCoordinates(page, delivered);
}

async function handsState(page) {
  return page.evaluate(() => {
    let hands = {};
    for (const message of window.dragReceived) {
      if ((message.t === 'board' || message.t === 'hands') && message.hands) hands = { ...message.hands };
      if (message.t === 'hand') hands[message.side] = { on: message.on, x: message.x, y: message.y, by: message.by, letter: message.letter };
    }
    return hands;
  });
}

async function handsAt(page, expected) {
  await page.waitForFunction(expected => {
    let hands = {};
    for (const message of window.dragReceived) {
      if ((message.t === 'board' || message.t === 'hands') && message.hands) hands = { ...message.hands };
      if (message.t === 'hand') hands[message.side] = message;
    }
    return Object.entries(expected).every(([side, hand]) => {
      const actual = hands[side];
      return actual && actual.on === hand.on && actual.by === hand.by && Math.abs(actual.x - hand.x) < 0.001 && Math.abs(actual.y - hand.y) < 0.001;
    });
  }, expected, { timeout: 3000 });
}

async function noFreeGloveCase(session) {
  await recordCase(session, 'Letter carry works without enabling a shared glove when both are off', async () => {
    await resetGlove(session, false);
    const sentBefore = await session.tutor.evaluate(() => window.dragSent.length);
    const start = await sourcePoint(session, 'D'), end = await dropPoint(session);
    await press(session, start); await pickup(session, 'D', start, false); await move(session, start, end); await release(session);
    await confirmedStatus(session, 'D');
    const events = await session.tutor.evaluate(n => window.dragSent.slice(n), sentBefore);
    assert(!events.some(message => message.t === 'hand' && message.a === 'grab'));
    const hands = await handsState(session.tutor); assert(!hands.r.on && !hands.l.on);
    await resetGlove(session);
    return { localLetterCarryStillWorks: true, noInventedGlove: true, noSharedHandEnabled: true };
  });
}

async function pointerUpAt(session, point) {
  // Chromium can deliver a trusted release at a new coordinate without a preceding
  // move. Other engines use the same pointerup contract through a synthetic event.
  if (session.cdp && !session.touch) {
    await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
  } else {
    await session.tutor.evaluate(({ point, mobile, touch }) => {
      const target = mobile ? document.querySelector('[role="group"][aria-label="Alphabet"]') : document.querySelector('[data-board-surface] > svg[role="img"]');
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: window.dragPointerId, pointerType: touch ? 'touch' : 'mouse', isPrimary: true, button: 0, buttons: 0, clientX: point.x, clientY: point.y }));
    }, { point, mobile: session.mobile, touch: session.touch });
  }
  const delivered = await session.tutor.evaluate(() => window.dragLastUp);
  // Clear Playwright/CDP's input bookkeeping after the independently delivered up.
  await release(session);
  return delivered;
}

async function noIntermediateMoveCase(session) {
  await recordCase(session, 'Distant pointerup creates a letter even if no pointermove was delivered', async () => {
    await resetGlove(session);
    const { tutor, student } = session;
    const count = await tutor.locator('[data-letter-tile]').count(), sentBefore = await tutor.evaluate(() => window.dragSent.length);
    const start = await sourcePoint(session, 'L'), end = await dropPoint(session);
    await press(session, start); await pickup(session, 'L', start);
    const movesBeforeUp = await tutor.evaluate(() => window.dragPointerMoves);
    await pointerUpAt(session, end);
    assert.equal(await tutor.evaluate(() => window.dragPointerMoves), movesBeforeUp, 'The missing-move test must not deliver a pointermove'); await cleared(session); await confirmedStatus(session, 'L');
    for (const page of [tutor, student]) await page.waitForFunction(count => document.querySelectorAll('[data-letter-tile]').length === count + 1, count);
    const adds = await tutor.evaluate(n => window.dragSent.slice(n).filter(message => message.t === 'tile:add-at'), sentBefore);
    assert.equal(adds.length, 1);
    return { noPointermoveDelivered: true, releaseCreatedExactlyOneTile: true, tutorStudentSynchronized: true, syntheticPointerup: !session.cdp || session.touch };
  });
}

async function differentLetterHandCase(session) {
  await recordCase(session, 'Picking another letter borrows the glove without showing a cloned hand', async () => {
    await resetGlove(session);
    const { tutor } = session, start = await sourcePoint(session, 'D'), end = await dropPoint(session);
    await press(session, start); await pickup(session, 'D', start);
    const originals = tutor.locator('[data-board-surface] [data-hand], [data-bar-hand] [data-hand]');
    assert.equal(await originals.filter({ visible: true }).count(), 0, 'The original shared glove must be hidden locally while the carry fist is visible');
    await move(session, start, end);
    assert.equal(await originals.filter({ visible: true }).count(), 0, 'Moving another letter must not reveal a second local hand');
    await tutor.screenshot({ path: `${out}/different-letter-carry-${session.viewport.width}.png` });
    await release(session); await cleared(session); await confirmedStatus(session, 'D');
    const at = await releasedCoordinates(tutor);
    await handsAt(tutor, { r: { on: true, by: null, x: at.x / 1600, y: at.y / 1000 } });
    await tutor.screenshot({ path: `${out}/different-letter-after-drop-${session.viewport.width}.png` });
    return { sameOriginalSideAtDrop: true, differentLetter: 'D', sharedPointerStartedOn: 'L', oneVisibleCarryHand: true };
  });
}

async function fastRepeatCase(session) {
  await recordCase(session, 'Repeated fast and hover releases keep the accepted tiles at their drop points', async () => {
    const { tutor, student } = session;
    const traces = [];
    for (const [n, letter] of ['D', 'L', 'A', 'P'].entries()) {
      await resetGlove(session);
      const count = await tutor.locator('[data-letter-tile]').count(), sentBefore = await tutor.evaluate(() => window.dragSent.length);
      const start = await sourcePoint(session, letter), end = await dropPoint(session);
      await press(session, start);
      if (session.touch) await session.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...end, id: 1 }] });
      else await tutor.mouse.move(end.x, end.y, { steps: 1 });
      const dwell = [0, 0, 80, 250][n]; if (dwell) await pause(dwell);
      await release(session); await confirmedStatus(session, letter);
      const up = await releasedCoordinates(tutor);
      const expected = { x: Math.max(24, Math.min(1492, up.x - 42)), y: Math.max(184, Math.min(864, up.y - 56)) };
      const adds = await tutor.evaluate(n => window.dragSent.slice(n).filter(message => message.t === 'tile:add-at'), sentBefore);
      assert.equal(adds.length, 1);
      const tile = adds[0].tile;
      await student.locator(`[data-letter-tile="${tile.id}"]`).waitFor();
      assert.equal(await tutor.locator('[data-letter-tile]').count(), count + 1);
      const echoes = await tutor.evaluate(id => window.dragReceived.filter(message => message.t === 'tile:add').flatMap(message => message.tiles).filter(tile => tile.id === id), tile.id);
      assert.equal(echoes.length, 1);
      assert(Math.abs(echoes[0].x - expected.x) < 0.2 && Math.abs(echoes[0].y - expected.y) < 0.2, 'Accepted tile must settle at its release coordinate');
      await pause(100);
      const rendered = await tutor.locator(`[data-letter-tile="${tile.id}"]`).boundingBox();
      const expectedScreen = await stagePoint(tutor, expected);
      assert(rendered && Math.abs(rendered.x - expectedScreen.x) < 3 && Math.abs(rendered.y - expectedScreen.y) < 3, 'Rendered accepted tile jumped away from its echoed position');
      traces.push({ letter, dwell, x: echoes[0].x, y: echoes[0].y, renderMatchesEcho: true });
    }
    return { successfulReleases: traces.length, noAcceptedTileSnappedBack: true, traces };
  });
}

async function makeExistingTile(session, point) {
  const sentBefore = await session.tutor.evaluate(() => window.dragSent.length);
  const start = await sourcePoint(session, 'L'), end = await stagePoint(session.tutor, point);
  await press(session, start); await move(session, start, end); await release(session); await confirmedStatus(session, 'L');
  return session.tutor.evaluate(n => window.dragSent.slice(n).find(message => message.t === 'tile:add-at').tile, sentBefore);
}

async function upperTilePriorityCase(session) {
  await recordCase(session, 'An existing tile upper edge wins over the old glove hit area', async () => {
    const { tutor, student } = session;
    const tile = await makeExistingTile(session, { x: 24 + 11.5 * 1552 / 26, y: 185 });
    await resetGlove(session);
    const element = tutor.locator(`[data-letter-tile="${tile.id}"]`), rect = await element.boundingBox();
    const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.22 }, end = await stagePoint(tutor, { x: 1050, y: 550 });
    const sentBefore = await tutor.evaluate(() => window.dragSent.length);
    await press(session, start); await tutor.mouse.move(end.x, end.y, { steps: 1 }); await release(session);
    await tutor.waitForFunction(({ n, id }) => window.dragReceived.slice(n).some(message => message.t === 'tile:drop' && message.tile.id === id), { n: 0, id: tile.id });
    const events = await tutor.evaluate(n => window.dragSent.slice(n).filter(message => message.t.startsWith('tile:') || message.t === 'hand'), sentBefore);
    assert(events.some(message => message.t === 'tile:grab' && message.id === tile.id));
    assert(!events.some(message => message.t === 'hand' && message.a === 'grab'), 'Pressing the tile must not move the shared glove instead');
    await student.waitForFunction(id => window.dragReceived.some(message => message.t === 'tile:drop' && message.tile.id === id), tile.id);
    const echoed = await student.evaluate(id => window.dragReceived.filter(message => message.t === 'tile:drop' && message.tile.id === id).at(-1)?.tile, tile.id);
    assert(echoed && echoed.x > 900 && echoed.y > 400);
    return { tileGrabbed: true, sharedGloveNotGrabbed: true, movedOnStudent: true };
  });
}

async function finalTileReleaseCase(session) {
  await recordCase(session, 'Existing tile uses pointerup on paper instead of its last move in the alphabet', async () => {
    const { tutor, student } = session;
    const tile = await makeExistingTile(session, { x: 1000, y: 500 }); await resetGlove(session);
    const element = tutor.locator(`[data-letter-tile="${tile.id}"]`), rect = await element.boundingBox();
    const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const lastMove = await stagePoint(tutor, { x: 800, y: 90 }), end = await stagePoint(tutor, { x: 1100, y: 650 });
    const sentBefore = await tutor.evaluate(() => window.dragSent.length);
    await press(session, start);
    const down = await boardCoordinates(tutor, await tutor.evaluate(() => window.dragLastDown));
    await tutor.mouse.move(lastMove.x, lastMove.y, { steps: 1 });
    const movesBeforeUp = await tutor.evaluate(() => window.dragPointerMoves);
    const up = await boardCoordinates(tutor, await pointerUpAt(session, end));
    const expected = { x: Math.max(24, Math.min(1492, up.x + tile.x - down.x)), y: Math.max(184, Math.min(864, up.y + tile.y - down.y)) };
    assert.equal(await tutor.evaluate(() => window.dragPointerMoves), movesBeforeUp, 'The final-up test must not deliver another pointermove');
    await tutor.waitForFunction(({ n, id }) => window.dragSent.slice(n).some(message => message.t === 'tile:drop' && message.id === id), { n: sentBefore, id: tile.id });
    const drop = await tutor.evaluate(({ n, id }) => window.dragSent.slice(n).find(message => message.t === 'tile:drop' && message.id === id), { n: sentBefore, id: tile.id });
    assert(Math.abs(drop.x - expected.x) < 0.2 && Math.abs(drop.y - expected.y) < 0.2, `Tile used stale move coordinates: ${JSON.stringify({ x: drop.x, y: drop.y })}`);
    await student.waitForFunction(id => window.dragReceived.some(message => message.t === 'tile:drop' && message.tile.id === id), tile.id);
    const actual = await student.evaluate(id => window.dragReceived.filter(message => message.t === 'tile:drop' && message.tile.id === id).at(-1).tile, tile.id);
    assert(Math.abs(actual.x - expected.x) < 0.2 && Math.abs(actual.y - expected.y) < 0.2);
    return { lastMoveWasInAlphabet: true, finalPointerupSampled: true, finalPosition: { x: actual.x, y: actual.y }, syntheticPointerup: !session.cdp };
  });
  await recordCase(session, 'An existing tile cannot finish above the writing paper', async () => {
    const { tutor } = session;
    const tile = await makeExistingTile(session, { x: 1000, y: 500 }); await resetGlove(session);
    const element = tutor.locator(`[data-letter-tile="${tile.id}"]`), rect = await element.boundingBox();
    const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, end = await stagePoint(tutor, { x: 800, y: 90 });
    const sentBefore = await tutor.evaluate(() => window.dragSent.length);
    await press(session, start); await tutor.mouse.move(end.x, end.y, { steps: 1 }); await release(session);
    const drop = await tutor.evaluate(({ n, id }) => window.dragSent.slice(n).find(message => message.t === 'tile:drop' && message.id === id), { n: sentBefore, id: tile.id });
    assert(drop && drop.y >= 184, 'Existing tile escaped above paper while the alphabet strip was visible');
    return { stayedInsidePaper: true, top: drop.y };
  });
}


async function delayedConsecutiveCarryCase(session) {
  await recordCase(session, 'Consecutive carries survive delayed acknowledgments without cloning the hand', async () => {
    const { tutor, student } = session;
    await resetGlove(session);
    const count = await tutor.locator('[data-letter-tile]').count(), sentBefore = await tutor.evaluate(() => window.dragSent.length);
    const endA = await stagePoint(tutor, { x: 700, y: 450 }), endB = await stagePoint(tutor, { x: 1100, y: 650 });
    await tutor.evaluate(() => { window.dragDelayInbound = 400; });
    try {
      const a = await sourcePoint(session, 'L'); await press(session, a); await pickup(session, 'L', a);
      await tutor.mouse.move(endA.x, endA.y, { steps: 1 }); await release(session);
      const b = await sourcePoint(session, 'D'); await press(session, b); await pickup(session, 'D', b);
      await tutor.mouse.move(endB.x, endB.y, { steps: 1 });
      await pause(550); await pickup(session, 'D', endB);
      assert.equal(await tutor.locator('[data-board-surface] [data-hand], [data-bar-hand] [data-hand]').filter({ visible: true }).count(), 0);
      await release(session); await confirmedStatus(session, 'D');
      for (const page of [tutor, student]) await page.waitForFunction(count => document.querySelectorAll('[data-letter-tile]').length === count + 2, count);
      const adds = await tutor.evaluate(n => window.dragSent.slice(n).filter(message => message.t === 'tile:add-at'), sentBefore);
      assert.equal(adds.length, 2); assert.deepEqual(adds.map(message => message.tile.text), ['L', 'D']);
      const at = await releasedCoordinates(tutor);
      await handsAt(tutor, { r: { on: true, by: null, x: at.x / 1600, y: at.y / 1000 } });
      await pause(450);
      return { orderedInboundDelayMs: 400, consecutiveAcceptedTiles: 2, noCloneDuringOldAcknowledgments: true, handEndsAtSecondDrop: true };
    } finally { await tutor.evaluate(() => { window.dragDelayInbound = 0; }); }
  });
}

async function snapshotDuringCarryCases(session) {
  for (const reason of ['clear', 'restore']) await recordCase(session, `${reason} snapshot arriving during the next carry preserves one glove and the new drop`, async () => {
    const { tutor, student } = session;
    await resetGlove(session);
    const count = await tutor.locator('[data-letter-tile]').count();
    const end = await dropPoint(session);
    const a = await sourcePoint(session, 'A');
    await press(session, a); await move(session, a, end); await release(session); await confirmedStatus(session, 'A');
    const code = await tutor.evaluate(() => window.dragReceived.find(message => message.t === 'room').code);
    const room = realtime.rooms.get(code);
    const before = await tutor.evaluate(() => window.dragReceived.length);
    await tutor.evaluate(() => { window.dragDelayInbound = 400; });
    try {
      // A real server-produced snapshot from before B's grab is delivered during B's carry.
      // Restore completion is exercised on this isolated room in its restoring phase.
      if (reason === 'restore') room.restoring = true;
      await tutor.evaluate(reason => window.dragSocket.send(JSON.stringify(reason === 'clear' ? { t: 'clear' } : { t: 'restored', strip: true, tools: false })), reason);
      const b = await sourcePoint(session, 'B');
      await press(session, b); await pickup(session, 'B', b); await move(session, b, end);
      await tutor.waitForFunction(({ before, reason }) => window.dragReceived.slice(before).some(message => message.t === 'board' && message.reason === reason), { before, reason });
      await pickup(session, 'B', end);
      assert.equal(await tutor.locator('[data-board-surface] [data-hand], [data-bar-hand] [data-hand]').filter({ visible: true }).count(), 0, 'Snapshot exposed the borrowed original during the carry');
      await release(session); await cleared(session); await confirmedStatus(session, 'B');
      for (const page of [tutor, student]) await page.waitForFunction(count => document.querySelectorAll('[data-letter-tile]').length === count + 2, count);
      const at = await releasedCoordinates(tutor);
      for (const page of [tutor, student]) await handsAt(page, { r: { on: true, by: null, x: at.x / 1600, y: at.y / 1000 } });
      return { serverSnapshotReason: reason, delayMs: 400, singleCarryGlove: true, bothClientsAtFinalRelease: true };
    } finally { room.restoring = false; await tutor.evaluate(() => { window.dragDelayInbound = 0; }); }
  });
}

async function forceCaptureLoss(session) {
  await session.tutor.evaluate(() => {
    const svg = document.querySelector('[data-board-surface] > svg[role="img"]');
    if (!svg.hasPointerCapture(window.dragPointerId)) throw new Error('Expected actual pointer capture before forcing loss');
    svg.releasePointerCapture(window.dragPointerId);
  });
  // A subsequent native move makes the browser dispatch its pending capture loss.
  await session.tutor.mouse.move(400, 20, { steps: 1 });
  await session.tutor.mouse.up();
  await pause(120);
}

async function lifecycleCases(session) {
  if (session.touch) return;
  await recordCase(session, 'Losing capture of an existing tile finalizes once and ignores later hover', async () => {
    const { tutor, student } = session;
    const tile = await makeExistingTile(session, { x: 1100, y: 650 }); await resetGlove(session);
    const rect = await tutor.locator(`[data-letter-tile="${tile.id}"]`).boundingBox();
    const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const end = await stagePoint(tutor, { x: 850, y: 700 });
    const before = await tutor.evaluate(() => window.dragSent.length);
    await press(session, start); await tutor.mouse.move(end.x, end.y, { steps: 1 });
    await forceCaptureLoss(session);
    await student.waitForFunction(id => window.dragReceived.some(message => message.t === 'tile:drop' && message.tile.id === id), tile.id);
    const settled = await tutor.evaluate(({ before, id }) => window.dragSent.slice(before).filter(message => message.t === 'tile:drop' && message.id === id), { before, id: tile.id });
    assert.equal(settled.length, 1, 'Capture loss must send exactly one final tile drop');
    const after = await tutor.evaluate(() => window.dragSent.length);
    const hover = await stagePoint(tutor, { x: 1400, y: 800 }); await tutor.mouse.move(hover.x, hover.y, { steps: 3 }); await pause(100);
    const ghostMoves = await tutor.evaluate(({ after, id }) => window.dragSent.slice(after).filter(message => message.id === id && message.t.startsWith('tile:')), { after, id: tile.id });
    assert.deepEqual(ghostMoves, [], 'A released mouse kept moving the old tile');
    return { finalizedOnce: true, noHoverDrag: true, deliveredToStudent: true };
  });
  for (const tool of ['Draw', 'Erase']) await recordCase(session, `${tool} capture loss closes the stroke and later hover creates no ink`, async () => {
    const { tutor } = session;
    await tutor.getByRole('button', { name: tool, exact: true }).click();
    const start = await stagePoint(tutor, { x: 200, y: 850 }), end = await stagePoint(tutor, { x: 450, y: 850 });
    const before = await tutor.evaluate(() => window.dragSent.length);
    await press(session, start); await tutor.mouse.move(end.x, end.y, { steps: 3 });
    await forceCaptureLoss(session);
    const messages = await tutor.evaluate(before => window.dragSent.slice(before), before);
    assert.equal(messages.filter(message => message.t === 's').length, 1);
    assert.equal(messages.filter(message => message.t === 'e').length, 1, 'Capture loss left the stroke open');
    const after = await tutor.evaluate(() => window.dragSent.length);
    const hover = await stagePoint(tutor, { x: 650, y: 850 }); await tutor.mouse.move(hover.x, hover.y, { steps: 3 }); await pause(100);
    assert.equal(await tutor.evaluate(after => window.dragSent.slice(after).filter(message => ['s', 'm', 'e'].includes(message.t)).length, after), 0, 'Hover kept drawing or erasing after release');
    await tutor.getByRole('button', { name: 'Select', exact: true }).click();
    return { strokeEndedOnce: true, noHoverInk: true };
  });
  await recordCase(session, 'Failed alphabet pointer capture still follows and releases through window listeners', async () => {
    const { tutor, student } = session;
    const count = await tutor.locator('[data-letter-tile]').count();
    await tutor.evaluate(() => { window.savedCapture = Element.prototype.setPointerCapture; Element.prototype.setPointerCapture = () => { throw new Error('capture unavailable'); }; });
    try {
      const start = await sourcePoint(session, 'C'), end = await dropPoint(session);
      await press(session, start); await pickup(session, 'C', start); await move(session, start, end); await release(session); await cleared(session); await confirmedStatus(session, 'C');
      await student.waitForFunction(count => document.querySelectorAll('[data-letter-tile]').length === count + 1, count);
      return { injectedCaptureFailure: true, fallbackPlacedExactlyOneTile: true };
    } finally { await tutor.evaluate(() => { Element.prototype.setPointerCapture = window.savedCapture; delete window.savedCapture; }); }
  });
}

async function penPalmCase(session) {
  if (!session.cdp) return;
  await recordCase(session, 'A resting palm does not cancel a pen letter pickup', async () => {
    const { tutor, cdp } = session;
    await resetGlove(session);
    const count = await tutor.locator('[data-letter-tile]').count(), sentBefore = await tutor.evaluate(() => window.dragSent.length);
    const start = await sourcePoint(session, 'P'), end = await stagePoint(tutor, { x: 1100, y: 650 });
    try {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start, pointerType: 'pen', buttons: 0 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, pointerType: 'pen', button: 'left', buttons: 1, clickCount: 1 });
      await pickup(session, 'P', start);
      await tutor.evaluate(point => {
        const target = document.querySelector('[data-board-surface] > svg[role="img"]');
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 987, pointerType: 'touch', isPrimary: false, button: 0, buttons: 1, width: 60, height: 60, clientX: point.x, clientY: point.y }));
      }, end);
      await pickup(session, 'P', start);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, pointerType: 'pen', buttons: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, pointerType: 'pen', button: 'left', buttons: 0, clickCount: 1 });
      await cleared(session); await confirmedStatus(session, 'P');
      assert.equal(await tutor.locator('[data-letter-tile]').count(), count + 1);
      assert.equal(await tutor.evaluate(n => window.dragSent.slice(n).filter(message => message.t === 'tile:add-at').length, sentBefore), 1);
      return { nativePenPickup: true, syntheticRestingPalm: true, pickupPreserved: true, exactlyOneTileCreated: true };
    } finally {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, pointerType: 'pen', button: 'left', buttons: 0, clickCount: 1 });
      await tutor.evaluate(point => document.querySelector('[data-board-surface] > svg[role="img"]').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 987, pointerType: 'touch', isPrimary: false, button: 0, buttons: 0, clientX: point.x, clientY: point.y })), end);
    }
  });
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
    const originalHands = await handsState(session.tutor);
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
    await handsAt(session.tutor, originalHands);
    return { noTileCreated: true, pickupAndPreviewCleared: true, originalGloveRestored: true, syntheticCancellationEvent: kind === 'window blur cancellation' || (kind === 'pointer cancellation' && !session.touch) };
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
      await noIntermediateMoveCase(session);
      await differentLetterHandCase(session);
      await noFreeGloveCase(session);
      await fastRepeatCase(session);
      await snapshotDuringCarryCases(session);
      if (session.viewport.width === 1440) {
        await upperTilePriorityCase(session);
        await finalTileReleaseCase(session);
        await delayedConsecutiveCarryCase(session);
        await penPalmCase(session);
      }
      await edgeCase(session);
      if (session.viewport.width === 1440) {
        await releaseGeometryCases(session);
        await lifecycleCases(session);
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
