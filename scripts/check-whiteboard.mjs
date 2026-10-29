import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createApp } from '../server/index.js';
import { attachRealtime } from '../server/realtime.js';
import { WORD_BANK, WORD_LEVELS } from '../server/wordBank.js';

// Isolated smoke coverage: real browser, HTTP upload, tutor/student sockets, and
// in-memory fixture services. Never connects to a user's running app or cloud account.
let dev = false, browserName = 'chrome', output, caseFilter = '';
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--dev') dev = true;
  else if (args[index] === '--browser') browserName = args[++index];
  else if (args[index] === '--output') output = args[++index];
  else if (args[index] === '--filter') caseFilter = args[++index];
  else if (args[index] === '--help') {
    console.log('Usage: node scripts/check-whiteboard.mjs [--dev] [--browser chrome|chromium|webkit] [--output DIRECTORY] [--filter CASE-NAME-SUBSTRING]');
    process.exit(0);
  } else throw new Error(`Unknown option: ${args[index]}`);
}
assert(['chrome', 'chromium', 'webkit'].includes(browserName), 'Unsupported browser');
const root = fileURLToPath(new URL('../', import.meta.url));
assert(dev || existsSync(join(root, 'dist/index.html')), 'Run npm run build first, or pass --dev.');
const out = output ? resolve(output) : mkdtempSync(join(tmpdir(), 'mpt-whiteboard-'));
mkdirSync(out, { recursive: true });
const report = { browser: browserName, frontend: dev ? 'isolated Vite' : 'production build', fixtureServices: true,
  caseFilter: caseFilter || null, realWebSockets: true, cloudServices: false, actualUserSession: false, cases: [], pageErrors: [],
  limitations: ['Idle video controls are checked; live camera, microphone, Google sign-in, billing, and cloud storage are not exercised.', 'WebKit phone checks use mouse input; Chrome phone checks use trusted touch.'] };
let server, vite, realtime, browser, devTransport;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function start() {
  const allowedOrigins = new Set();
  const pictures = Object.fromEntries(['beginWrite', 'add', 'get', 'isTutor'].map(method => [method, (...args) => realtime.pictures[method](...args)]));
  // Populate the real Materials components without a database or external images.
  // Every card is explicitly a smoke fixture, using the existing small test photo.
  const bytes = readFileSync(join(root, 'src/whiteboard/fixtures/lip-biter-240.jpg'));
  const cards = Array.from({ length: 28 }, (_, index) => ({ id: `smoke-card-${index + 1}`,
    title: `Smoke card ${String(index + 1).padStart(2, '0')}`, collection: 'Smoke fixtures', w: 240, h: 240,
    regions: [{ name: 'Photo', kind: 'photo', x: 0, y: 0, w: 240, h: 240 }] }));
  const words = Object.fromEntries(WORD_LEVELS.map(({ level }) => [level,
    WORD_BANK.filter(item => item.level === level).map(({ word, phonemes, display }) => ({ word, phonemes, display }))]));
  const bank = { levels: WORD_LEVELS.map(item => ({ ...item, count: words[item.level].length })), words };
  const app = createApp({ pictures,
    library: { list: async () => cards, image: async id => { const card = cards.find(item => item.id === id); return card ? { ...card, bytes } : null; } },
    words: { bank: async () => bank } });
  if (dev) {
    const { createServer } = await import('vite');
    const { default: config } = await import('../vite.config.js');
    // Vite's module client still opens a transport with HMR disabled. Give it its
    // own ephemeral socket rather than sharing the app's authenticated /ws route.
    devTransport = http.createServer();
    await new Promise((done, fail) => { devTransport.once('error', fail); devTransport.listen(0, '127.0.0.1', done); });
    vite = await createServer({ ...config, root, configFile: false, cacheDir: join(out, 'vite-cache'),
      server: { ...config.server, middlewareMode: true, hmr: false, ws: { server: devTransport, host: '127.0.0.1', clientPort: devTransport.address().port }, proxy: undefined }, appType: 'spa' });
  }
  server = http.createServer(dev ? (request, response) => {
    if (/^\/(?:api|auth)(?:\/|$)|^\/healthz(?:\?|$)/.test(request.url || '')) app(request, response);
    else vite.middlewares(request, response, () => { response.statusCode = 404; response.end('Not found'); });
  } : app);
  realtime = attachRealtime(server, { allowedOrigins, canStartLesson: async () => ({ ok: true }) });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const base = `http://127.0.0.1:${server.address().port}`;
  allowedOrigins.add(base);
  browser = await (browserName === 'webkit' ? webkit : chromium).launch(browserName === 'chrome' ? { channel: 'chrome' } : {});
  return base;
}

async function instrument(page) {
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.smokeSent = []; window.smokeReceived = [];
    document.addEventListener('pointerdown', event => { window.smokePointerId = event.pointerId; }, true);
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) { super(...args); this.addEventListener('message', event => { try { window.smokeReceived.push(JSON.parse(event.data)); } catch {} }); }
      send(data) { try { window.smokeSent.push(JSON.parse(data)); } catch {} super.send(data); }
    };
  });
}
async function session(base, mobile) {
  const context = await browser.newContext({ viewport: mobile ? { width: 393, height: 852 } : { width: 1440, height: 900 }, hasTouch: mobile, isMobile: mobile });
  context.setDefaultTimeout(12_000);
  const tutor = await context.newPage(), student = await context.newPage();
  await instrument(tutor); await instrument(student);
  await tutor.goto(`${base}/whiteboard/teach`);
  await tutor.waitForFunction(() => window.smokeReceived.some(message => message.t === 'room'));
  const code = await tutor.evaluate(() => window.smokeReceived.find(message => message.t === 'room').code);
  await student.goto(`${base}/whiteboard/${code}`);
  await tutor.waitForFunction(() => window.smokeReceived.some(message => message.t === 'presence' && message.student));
  for (const page of [tutor, student]) for (const button of await page.getByRole('button', { name: 'Close this message', exact: true }).all()) if (await button.isVisible()) await button.click();
  await tutor.bringToFront();
  return { context, tutor, student, mobile, cdp: mobile && browserName !== 'webkit' ? await context.newCDPSession(tutor) : null };
}
async function point(page, x, y) {
  return page.evaluate(({ x, y }) => { const svg = document.querySelector('[data-board-surface] > svg[role="img"]'); const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()); return { x: p.x, y: p.y }; }, { x, y });
}
async function drag(session, start, end) {
  if (session.cdp) {
    await session.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
    for (let n = 1; n <= 8; n += 1) await session.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * n / 8, y: start.y + (end.y - start.y) * n / 8, id: 1 }] });
    await session.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await session.tutor.mouse.move(start.x, start.y); await session.tutor.mouse.down();
    await session.tutor.mouse.move(end.x, end.y, { steps: 8 }); await session.tutor.mouse.up();
  }
}
async function check(session, name, action, page = session.tutor) {
  if (caseFilter && !name.includes(caseFilter)) return;
  const item = { viewport: session.mobile ? 'phone' : 'desktop', name };
  report.cases.push(item);
  try { Object.assign(item, await action()); item.passed = true; }
  catch (error) {
    item.passed = false; item.error = error.stack; item.scrollCheckpoint = session.scrollCheckpoint;
    if (session.cdp) item.cdpMetrics = await session.cdp.send('Page.getLayoutMetrics').catch(()=>null);
    item.scrollGeometry = await page.evaluate(() => [...document.querySelectorAll('[data-materials-workspace] section[aria-label=Materials], [data-materials-scroll]')].map(element => ({tag:element.tagName,owner:element.hasAttribute('data-materials-scroll'),clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,scrollTop:element.scrollTop,overflow:getComputedStyle(element).overflowY,bounds:element.getBoundingClientRect().toJSON()}))).catch(()=>null);
    await page.screenshot({ path: join(out, `failure-${report.cases.length}.png`) }).catch(() => {});
    writeFileSync(join(out, `failure-${report.cases.length}.json`), JSON.stringify(item,null,2));
  }
}
async function countOnBoth(session, selector, count) {
  for (const page of [session.tutor, session.student]) await page.waitForFunction(({ selector, count }) => document.querySelectorAll(selector).length === count, { selector, count });
}
async function activate(session, locator) {
  if (session.mobile && browserName !== 'webkit') await locator.tap();
  else await locator.click();
}
async function settleSheet(page) {
  // Read final geometry after the user's height transition, including screenshots.
  await page.locator('[data-panel-sheet]').evaluate(async element => {
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
}
async function sidebarGeometry(page) {
  return page.evaluate(() => {
    const sheet = document.querySelector('[data-panel-sheet]');
    const bounds = sheet.getBoundingClientRect();
    const content = sheet.querySelector('[data-materials-scroll]');
    const contentBounds = content.getBoundingClientRect();
    const board = document.querySelector('[data-board-surface]').getBoundingClientRect();
    const surface = document.querySelector('[data-board-surface]');
    const paper = surface.querySelector('svg rect.fill-white[rx="20"]')?.getBoundingClientRect() || board;
    let clearBoardTarget = null;
    // Locate an actual unobscured 44px square on the visible paper, not a fixed
    // point which may legitimately be occupied by the repositioned video controls.
    for (let y = Math.max(board.top, paper.top) + 22; y <= Math.min(board.bottom, paper.bottom) - 22 && !clearBoardTarget; y += 22) {
      for (let x = Math.max(board.left, paper.left) + 22; x <= Math.min(board.right, paper.right, bounds.left) - 22; x += 22) {
        if ([-21, 0, 21].every(dx => [-21, 0, 21].every(dy => document.elementFromPoint(x + dx, y + dy)?.closest('[data-board-surface]') === surface))) {
          clearBoardTarget = { x, y, width: 44, height: 44 };
          break;
        }
      }
    }
    const ownsPoint = (element, x, y) => Boolean(element.contains(document.elementFromPoint(x, y)));
    const action = element => {
      const r = element.getBoundingClientRect();
      return { label: element.getAttribute('aria-label') || element.textContent.trim(), x: r.x, y: r.y, width: r.width, height: r.height,
        reachable: ownsPoint(element, r.x + r.width / 2, r.y + r.height / 2) };
    };
    const video = document.querySelector('aside[aria-label="Video call"]');
    const tools = document.querySelector('button[aria-label="Show drawing tools"]');
    return { sheet: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      contentHeight: content.clientHeight,
      contentBottomReachable: ownsPoint(content, contentBounds.x + contentBounds.width / 2, contentBounds.bottom - 6),
      board: { x: board.x, y: board.y, width: board.width, height: board.height },
      boardHitAvailable: Boolean(clearBoardTarget), clearBoardTarget,
      videoActions: [...video.querySelectorAll('button')].filter(button => button.getBoundingClientRect().height > 0).map(action),
      tools: tools && tools.getBoundingClientRect().height > 0 ? action(tools) : null,
      viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
}
function assertNoSidebarOverlap(geometry) {
  assert(geometry.contentBottomReachable, 'The board footer must not cover the Materials scroller');
  for (const control of [...geometry.videoActions, ...(geometry.tools ? [geometry.tools] : [])]) {
    assert(control.reachable, `${control.label} must receive a click at its visible center`);
    assert(control.x >= -1 && control.y >= -1 && control.x + control.width <= geometry.viewportWidth + 1 && control.y + control.height <= geometry.viewportHeight + 1, `${control.label} must fit in the viewport`);
  }
}
async function materials(page, tab) {
  const back = page.locator('[data-materials-workspace]').getByRole('button', { name: 'Return to materials', exact: true });
  if (await back.isVisible()) await back.click();
  if (!await page.getByRole('tab', { name: tab, exact: true }).isVisible()) await page.getByRole('button', { name: 'Materials', exact: true }).click();
  await page.getByRole('tab', { name: tab, exact: true }).click();
}

try {
  const base = await start();
  for (const mobile of [false, true]) {
    const room = await session(base, mobile), { tutor, student } = room;
    await check(room, 'Alphabet remains a reference strip and creates no tiles', async () => {
      let start;
      if (mobile) { const rect = await tutor.getByRole('group', { name: 'Alphabet', exact: true }).locator('[data-letter="A"]').boundingBox(); start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; }
      else start = await point(tutor, 24 + 0.5 * 1552 / 26, 90);
      await drag(room, start, await point(tutor, mobile ? 250 : 500, 500)); await pause(150);
      await countOnBoth(room, '[data-letter-tile]', 0);
      assert.equal(await tutor.evaluate(() => window.smokeSent.filter(message => message.t.startsWith('tile:')).length), 0);
      return { input: room.cdp ? 'trusted touch' : 'mouse', noTileCreation: true };
    });
    await check(room, 'Existing pointing glove moves and releases on both screens', async () => {
      let start;
      if (mobile) { const rect = await tutor.locator('[data-bar-hand="r"]').boundingBox(); assert(rect); start = { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.5 }; }
      else start = await point(tutor, 960, 215);
      const before = await student.evaluate(() => window.smokeReceived.length);
      await drag(room, start, await point(tutor, mobile ? 250 : 1200, 350));
      await student.waitForFunction(n => window.smokeReceived.slice(n).some(message => message.t === 'hand' && message.side === 'r' && message.by === null), before);
      const final = await student.evaluate(n => window.smokeReceived.slice(n).filter(message => message.t === 'hand' && message.side === 'r').at(-1), before);
      assert(final.y > 0.2); assert.equal(final.by, null);
      return { final: { x: final.x, y: final.y }, sharedRelease: true };
    });
    if (!mobile) {
      await check(room, 'Materials adds c a t and an existing tile can be moved', async () => {
        await materials(tutor, 'Letters');
        await tutor.getByRole('textbox', { name: 'Add tiles', exact: true }).fill('c a t');
        await tutor.getByRole('button', { name: 'Add', exact: true }).click();
        await countOnBoth(room, '[data-letter-tile]', 3);
        const tile = tutor.locator('[data-letter-tile]').filter({ hasText: /^t$/ });
        const rect = await tile.boundingBox(); assert(rect);
        await drag(room, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, await point(tutor, 500, 400));
        const id = await tile.getAttribute('data-letter-tile');
        await student.waitForFunction(id => window.smokeReceived.some(message => message.t === 'tile:drop' && message.tile.id === id && message.tile.y < 500), id);
        return { tiles: 3, existingTileMoveSynced: true };
      });
      await check(room, 'Sound-box counters synchronize', async () => {
        await tutor.getByRole('group', { name: 'Sound boxes', exact: true }).getByRole('button', { name: '3', exact: true }).click();
        const counter = tutor.getByRole('button', { name: 'Sound box 2 counter', exact: true });
        await counter.waitFor(); await counter.focus(); await tutor.keyboard.press('Enter');
        await student.locator('[data-sound-box="1"][data-sound-pressed="true"]').waitFor();
        return { counterSynced: true };
      });
      await check(room, 'Draw ends on capture loss and ordinary hover adds no ink', async () => {
        await tutor.getByRole('button', { name: 'Draw', exact: true }).click();
        const a = await point(tutor, 500, 700), b = await point(tutor, 700, 700);
        await tutor.mouse.move(a.x, a.y); await tutor.mouse.down(); await tutor.mouse.move(b.x, b.y);
        await tutor.evaluate(() => document.querySelector('[data-board-surface] > svg[role="img"]').releasePointerCapture(window.smokePointerId));
        await tutor.mouse.move(5, 5); await tutor.mouse.up();
        await tutor.waitForFunction(() => window.smokeSent.some(message => message.t === 'e'));
        const count = await tutor.evaluate(() => window.smokeSent.filter(message => ['s', 'm', 'e'].includes(message.t)).length);
        const hover = await point(tutor, 1000, 750); await tutor.mouse.move(hover.x, hover.y); await pause(100);
        assert.equal(await tutor.evaluate(() => window.smokeSent.filter(message => ['s', 'm', 'e'].includes(message.t)).length), count);
        return { strokeEnded: true, hoverAddsNoInk: true };
      });
      await check(room, 'Picture upload and Magic Select remain available', async () => {
        await tutor.getByRole('button', { name: 'Select', exact: true }).click();
        await materials(tutor, 'Pictures');
        await tutor.locator('input[type="file"][accept="image/*"]').first().setInputFiles({ name: 'smoke-photo.jpg', mimeType: 'image/jpeg', buffer: readFileSync(join(root, 'src/whiteboard/fixtures/lip-biter-240.jpg')) });
        await countOnBoth(room, '[data-picture-piece]', 1);
        await tutor.getByRole('button', { name: /^Choose a part of / }).first().click();
        const dialog = tutor.getByRole('dialog', { name: 'Picture library', exact: true });
        const magic = dialog.getByRole('button', { name: 'Magic select', exact: true });
        await magic.waitFor(); await magic.click();
        await dialog.getByText('Tap a photo, heading, diagram or text to select it. Draw a box for any other area.', { exact: true }).waitFor();
        const image = dialog.getByRole('img', { name: 'Picture. Tap a part to select it, then drag it onto the board.', exact: true });
        await image.waitFor(); await image.click();
        const add = dialog.getByRole('button', { name: 'Add selected part to board', exact: true });
        await add.waitFor(); await add.click(); await countOnBoth(room, '[data-picture-piece]', 2);
        return { uploadSynced: true, magicSelectionAdded: true };
      });
    }
    await check(room, 'Idle video offers a compact start control', async () => {
      // Finding Start video must not request camera or microphone permission.
      const video = tutor.getByRole('complementary', { name: 'Video call', exact: true });
      const start = tutor.getByRole('button', { name: 'Start video', exact: true });
      await start.waitFor();
      const bounds = await video.boundingBox();
      assert(bounds, 'Video controls must be visible');
      assert(bounds.height <= 180, `Idle video consumes ${bounds.height}px before camera starts`);
      const viewport = tutor.viewportSize();
      assert(bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1, 'Video controls fit the viewport');
      const disclosure = video.getByRole('button', { name: 'Show video details', exact: true });
      const controls = [];
      for (const button of [start, disclosure]) {
        const control = await button.boundingBox();
        assert(control && control.x >= bounds.x - 1 && control.y >= bounds.y - 1 && control.x + control.width <= bounds.x + bounds.width + 1 && control.y + control.height <= bounds.y + bounds.height + 1, `Video action ${await button.getAttribute('aria-label') || await button.textContent()} must fit its panel`);
        assert(control.height >= 44 && control.width >= 44, 'Video actions need complete 44px touch targets');
        controls.push({ width: control.width, height: control.height });
      }
      return { idleWidth: bounds.width, idleHeight: bounds.height, startVisible: true, controlsInsidePanel: true, targets: controls, mediaNotStarted: true };
    });
    await check(room, 'Materials remembers each search and picture scroll position', async () => {
      await materials(tutor, 'Letters');
      await tutor.getByRole('searchbox', { name: 'Search letters', exact: true }).fill('sh');
      await materials(tutor, 'Pictures');
      await tutor.getByRole('searchbox', { name: 'Search pictures', exact: true }).fill('Smoke card');
      await tutor.getByRole('list', { name: 'Library cards', exact: true }).locator('> li').first().waitFor();
      assert.equal(await tutor.getByRole('list', { name: 'Library cards', exact: true }).locator('> li').count(), 28);
      if (mobile) await settleSheet(tutor);
      const scroll = tutor.locator('[data-materials-scroll]');
      if (room.cdp) {
        const bounds = await scroll.boundingBox();
        assert(bounds && bounds.height >= 80, 'Material results need a usable touch-scroll area');
        // Use Chromium's compositor gesture for native scrolling. The raw touch
        // helper above tests app pointer handlers and has no paced native-pan clock.
        await room.cdp.send('Input.synthesizeScrollGesture', {
          x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2),
          yDistance: -Math.min(100, (bounds.height - 32) / 2), gestureSourceType: 'touch', speed: 250, preventFling: true,
        });
        await tutor.waitForFunction(() => document.querySelector('[data-materials-scroll]').scrollTop > 0);
        room.materialTouchScroll = await scroll.evaluate(async element => {
          let last = element.scrollTop, stable = 0;
          for (let frame = 0; frame < 180; frame++) {
            await new Promise(done => requestAnimationFrame(done));
            const next = element.scrollTop; stable = Math.abs(next - last) < 0.5 ? stable + 1 : 0; last = next;
            if (stable >= 8) return next;
          }
          throw new Error('Touch-scroll momentum did not settle');
        });
      }
      await scroll.evaluate(element => { element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true })); element.scrollTop = 420; });
      room.scrollCheckpoint = 'initial 420px scroll';
      await tutor.waitForFunction(() => document.querySelector('[data-materials-scroll]').scrollTop >= 400);
      room.initialScrollGeometry = await scroll.evaluate(element => ({tag:element.tagName,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,scrollTop:element.scrollTop}));
      room.pictureScroll = await scroll.evaluate(element => element.scrollTop);
      room.scrollCheckpoint = 'switching away from scrolled Pictures';
      await materials(tutor, 'Worksheets');
      await tutor.getByRole('searchbox', { name: 'Search worksheets', exact: true }).fill('short a');
      await materials(tutor, 'Letters');
      assert.equal(await tutor.getByRole('searchbox', { name: 'Search letters', exact: true }).inputValue(), 'sh');
      await materials(tutor, 'Worksheets');
      assert.equal(await tutor.getByRole('searchbox', { name: 'Search worksheets', exact: true }).inputValue(), 'short a');
      await materials(tutor, 'Pictures');
      assert.equal(await tutor.getByRole('searchbox', { name: 'Search pictures', exact: true }).inputValue(), 'Smoke card');
      room.scrollCheckpoint = 'restoring after tab changes';
      await tutor.waitForFunction(expected => Math.abs(document.querySelector('[data-materials-scroll]').scrollTop - expected) <= 1, room.pictureScroll);
      await tutor.screenshot({ path: join(out, `${mobile ? 'phone' : 'desktop'}-materials.png`) });
      return { trustedTouchScroll:room.materialTouchScroll, initialScrollGeometry:room.initialScrollGeometry, independentSearches: true, pictureScrollRestored: room.pictureScroll, localCatalogCards: 28 };
    });
    await check(room, 'Games stays inline, exposes level controls, and restores Materials', async () => {
      const sentBefore = await student.evaluate(() => window.smokeReceived.length);
      await activate(room, tutor.getByRole('button', { name: 'Games', exact: true }));
      const games = tutor.locator('[data-materials-workspace]').getByRole('region', { name: 'Games', exact: true });
      await games.waitFor();
      assert.equal(await tutor.getByRole('dialog').count(), 0, 'Opening Games must not open a modal');
      assert.equal(await tutor.locator('[data-board-surface]').evaluate(element => Boolean(element.closest('[inert]'))), false, 'Board must stay available while game controls are open');
      await activate(room, games.getByRole('button', { name: 'Start Phoneme Pop', exact: true }));
      await student.waitForFunction(n => window.smokeReceived.slice(n).some(message => message.t === 'game' && message.game?.kind === 'phoneme'), sentBefore);
      const level = games.getByRole('button', { name: 'Level 2', exact: true });
      await level.waitFor();
      const bounds = await level.boundingBox(), panel = await games.boundingBox();
      assert(bounds && panel && bounds.y >= panel.y - 1 && bounds.y + bounds.height <= panel.y + panel.height + 1, 'Current game level control must fit in the visible game panel');
      await activate(room, level);
      await student.waitForFunction(n => window.smokeReceived.slice(n).some(message => message.t === 'game' && message.game?.kind === 'phoneme' && message.game.level === 2), sentBefore);
      assert.equal(await level.getAttribute('aria-pressed'), 'true');
      await tutor.screenshot({ path: join(out, `${mobile ? 'phone' : 'desktop'}-inline-games.png`) });
      // Returning keeps the active game running and recovers the exact browsing context.
      await activate(room, games.getByRole('button', { name: 'Return to materials', exact: true }));
      assert.equal(await tutor.getByRole('tab', { name: 'Pictures', exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await tutor.getByRole('searchbox', { name: 'Search pictures', exact: true }).inputValue(), 'Smoke card');
      await tutor.waitForFunction(expected => Math.abs(document.querySelector('[data-materials-scroll]').scrollTop - expected) <= 1, room.pictureScroll);
      const reopen = tutor.getByRole('button', { name: 'Game controls', exact: true });
      await reopen.waitFor();
      assert.equal(await reopen.evaluate(element => document.activeElement === element), true, 'Return should restore focus to the game launcher');
      await activate(room, reopen);
      await activate(room, games.getByRole('button', { name: 'Put Phoneme Pop away', exact: true }));
      await activate(room, games.getByRole('button', { name: 'Return to materials', exact: true }));
      return { inlineNotModal: true, levelChangedOnStudent: 2, searchAndScrollRestored: true, gameContinuesWhenReturning: true };
    });
    await check(room, 'Unsent tile text survives opening Games and returning', async () => {
      await materials(tutor, 'Letters');
      const draft = tutor.getByRole('textbox', { name: 'Add tiles', exact: true });
      await draft.fill('sh i p');
      const before = await tutor.evaluate(() => window.smokeSent.filter(message => message.t === 'tile:add').length);
      await activate(room, tutor.getByRole('button', { name: 'Games', exact: true }));
      await activate(room, tutor.locator('[data-materials-workspace]').getByRole('region', { name: 'Games', exact: true }).getByRole('button', { name: 'Return to materials', exact: true }));
      assert.equal(await tutor.getByRole('tab', { name: 'Letters', exact: true }).getAttribute('aria-selected'), 'true');
      assert.equal(await tutor.getByRole('searchbox', { name: 'Search letters', exact: true }).inputValue(), 'sh');
      assert.equal(await draft.inputValue(), 'sh i p', 'Unsubmitted letter entry must survive the activity switch');
      assert.equal(await tutor.evaluate(() => window.smokeSent.filter(message => message.t === 'tile:add').length), before, 'Browsing Games must not submit the tile draft');
      await materials(tutor, 'Pictures');
      await tutor.waitForFunction(expected => Math.abs(document.querySelector('[data-materials-scroll]').scrollTop - expected) <= 1, room.pictureScroll);
      return { draftPreserved: true, previousTabAndQuery: true, noTilesSubmitted: true };
    });
    if (mobile) await check(room, 'Phone Materials closes with one explicit tap', async () => {
      const close = tutor.getByRole('button', { name: 'Close Materials', exact: true });
      await close.waitFor();
      const bounds = await close.boundingBox();
      assert(bounds && bounds.width >= 24 && bounds.height >= 24, 'Close needs an accessible touch target');
      await activate(room, close);
      await tutor.getByRole('tab', { name: 'Pictures', exact: true }).waitFor({ state: 'hidden' });
      await settleSheet(tutor);
      await tutor.screenshot({ path: join(out, 'phone-materials-closed.png') });
      await activate(room, tutor.getByRole('button', { name: 'Materials', exact: true }));
      assert.equal(await tutor.getByRole('searchbox', { name: 'Search pictures', exact: true }).inputValue(), 'Smoke card');
      return { input: browserName === 'webkit' ? 'mouse' : 'trusted touch', explicitClose: true, searchSurvivesReopen: true, touchTarget: { width: bounds.width, height: bounds.height } };
    });
    if (mobile) await check(room, 'Short landscape keeps explicit panel controls and Escape focus return', async () => {
      await tutor.setViewportSize({ width: 740, height: 390 });
      await activate(room, tutor.getByRole('button', { name: 'Close Materials', exact: true }));
      await settleSheet(tutor);
      const closedBoard = await tutor.locator('[data-board-surface]').boundingBox();
      const trigger = tutor.getByRole('button', { name: 'Materials', exact: true });
      await activate(room, trigger);
      const close = tutor.getByRole('button', { name: 'Close Materials', exact: true });
      await close.waitFor();
      await settleSheet(tutor);
      const bounds = await close.boundingBox();
      assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 391 && bounds.x + bounds.width <= 741, 'Close must fit in short landscape');
      const geometry = await sidebarGeometry(tutor);
      assertNoSidebarOverlap(geometry);
      assert(geometry.sheet.x >= -1 && geometry.sheet.y >= -1 && geometry.sheet.x + geometry.sheet.width <= geometry.viewportWidth + 1 && geometry.sheet.y + geometry.sheet.height <= geometry.viewportHeight + 1, 'Expanded Materials must stay inside short landscape');
      assert(geometry.contentHeight >= 24, 'Expanded Materials must retain a usable content scroller');
      assert(geometry.board.height >= 72 && geometry.boardHitAvailable, 'Opening Materials must leave usable, reachable board space');
      assert(closedBoard && Math.abs(geometry.board.height - closedBoard.height) <= 2, 'Short-landscape Materials must not shrink the board when it opens');
      await tutor.screenshot({ path: join(out, 'phone-short-landscape-expanded.png') });
      await activate(room, tutor.getByRole('button', { name: 'Show drawing tools', exact: true }));
      const openTools = tutor.getByRole('region', { name: 'Drawing tools', exact: true });
      await openTools.waitFor();
      for (const label of ['Close drawing tools', 'Draw']) {
        const reachable = await openTools.getByRole('button', { name: label, exact: true }).evaluate(element => {
          const r = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        });
        assert(reachable, `Open tools action ${label} must remain reachable in short landscape`);
      }
      assertNoSidebarOverlap(await sidebarGeometry(tutor));
      await activate(room, openTools.getByRole('button', { name: 'Close drawing tools', exact: true }));
      // In a constrained-height panel the whole Materials section is the scroller,
      // so its header must move with the cards instead of consuming the entire pane.
      const owner = tutor.locator('[data-materials-scroll]');
      await owner.evaluate(element => { element.dispatchEvent(new Event('wheel')); element.scrollTop = 0; });
      const search = tutor.getByRole('searchbox', { name: 'Search pictures', exact: true });
      const headerBefore = await search.evaluate(element => element.getBoundingClientRect().top);
      await owner.evaluate(element => { element.dispatchEvent(new Event('wheel')); element.scrollTop = 80; });
      await tutor.waitForFunction(() => document.querySelector('[data-materials-scroll]').scrollTop >= 60);
      const headerAfter = await search.evaluate(element => element.getBoundingClientRect().top);
      assert(headerBefore - headerAfter >= 40, 'Constrained Materials header and cards must scroll together');
      const landscapeScroll = await owner.evaluate(element => element.scrollTop);
      await activate(room, close);
      await settleSheet(tutor);
      await activate(room, trigger);
      await settleSheet(tutor);
      await tutor.waitForFunction(expected => Math.abs(document.querySelector('[data-materials-scroll]').scrollTop - expected) <= 1, landscapeScroll);
      assert.equal(await search.inputValue(), 'Smoke card');
      assert.equal(await tutor.getByRole('searchbox', { name: 'Search pictures', exact: true }).inputValue(), 'Smoke card');
      await tutor.getByRole('searchbox', { name: 'Search pictures', exact: true }).focus();
      await tutor.keyboard.press('Escape');
      await tutor.waitForFunction(() => { const button = [...document.querySelectorAll('[data-panel-sheet] button')].find(item => item.textContent.trim() === 'Materials'); return button?.getAttribute('aria-expanded') === 'false' && document.activeElement === button; });
      assert.equal(await tutor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'Short landscape must not introduce horizontal page overflow');
      await tutor.screenshot({ path: join(out, 'phone-short-landscape.png') });
      return { dimensions: '740x390', explicitCloseFits: true, expandedPanel: geometry.sheet, contentHeight: geometry.contentHeight, closedBoardHeight: closedBoard.height, boardHeight: geometry.board.height, boardHitAvailable: geometry.boardHitAvailable, clearBoardTarget: geometry.clearBoardTarget, videoActionsReachable: geometry.videoActions, materialsUnobscured: geometry.contentBottomReachable, toolsOpenReachable: true, constrainedHeaderScroll: headerBefore - headerAfter, scrollAfterReopen: landscapeScroll, escapeReturnsFocus: true, noHorizontalOverflow: true };
    });
    if (mobile) await check(room, 'Student short landscape keeps tools, video, and Materials reachable', async () => {
      // Exercise the shared layout with the student's real permission-controlled tool rail.
      await tutor.getByRole('button', { name: 'Lesson controls', exact: true }).click();
      const controls = tutor.getByRole('dialog', { name: 'Lesson controls', exact: true });
      const tools = controls.getByRole('switch', { name: 'Student tools', exact: true });
      if (await tools.getAttribute('aria-checked') !== 'true') await tools.click();
      await tutor.keyboard.press('Escape');
      await student.setViewportSize({ width: 740, height: 390 });
      await student.bringToFront();
      await student.getByRole('button', { name: 'Show drawing tools', exact: true }).waitFor();
      const opener = student.getByRole('button', { name: 'Materials', exact: true });
      await opener.waitFor();
      if (await opener.getAttribute('aria-expanded') === 'true') await student.getByRole('button', { name: 'Close Materials', exact: true }).click();
      await settleSheet(student);
      const closed = await student.locator('[data-board-surface]').boundingBox();
      await activate(room, opener);
      await settleSheet(student);
      const geometry = await sidebarGeometry(student);
      assertNoSidebarOverlap(geometry);
      assert(geometry.tools, 'Enabled student drawing tools must remain available');
      assert(closed && Math.abs(geometry.board.height - closed.height) <= 2 && geometry.board.height >= 72 && geometry.boardHitAvailable, 'Student Materials must preserve usable board space');
      await student.screenshot({ path: join(out, 'student-phone-short-landscape-expanded.png') });
      await activate(room, student.getByRole('button', { name: 'Close Materials', exact: true }));
      return { dimensions: '740x390', boardHeight: geometry.board.height, materialsUnobscured: geometry.contentBottomReachable, toolsAndVideoReachable: true };
    }, student);
    await room.context.close();
  }
} catch (error) { report.fatal = error.stack; }
finally {
  await browser?.close(); realtime?.close(); await vite?.close();
  if (devTransport?.listening) await new Promise(resolve => devTransport.close(resolve));
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  report.passed = !report.fatal && !report.pageErrors.length && report.cases.length > 0 && report.cases.every(item => item.passed);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report: ${join(out, 'report.json')}`);
  if (!report.passed) process.exitCode = 1;
}
