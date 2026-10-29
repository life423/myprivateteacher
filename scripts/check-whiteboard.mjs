import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createApp } from '../server/index.js';
import { attachRealtime } from '../server/realtime.js';

// Isolated smoke coverage: real browser, HTTP upload, tutor/student sockets, and
// empty fixture services. Never connects to a user's running app or cloud account.
let dev = false, browserName = 'chrome', output;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--dev') dev = true;
  else if (args[index] === '--browser') browserName = args[++index];
  else if (args[index] === '--output') output = args[++index];
  else if (args[index] === '--help') {
    console.log('Usage: node scripts/check-whiteboard.mjs [--dev] [--browser chrome|chromium|webkit] [--output DIRECTORY]');
    process.exit(0);
  } else throw new Error(`Unknown option: ${args[index]}`);
}
assert(['chrome', 'chromium', 'webkit'].includes(browserName), 'Unsupported browser');
const root = fileURLToPath(new URL('../', import.meta.url));
assert(dev || existsSync(join(root, 'dist/index.html')), 'Run npm run build first, or pass --dev.');
const out = output ? resolve(output) : mkdtempSync(join(tmpdir(), 'mpt-whiteboard-'));
mkdirSync(out, { recursive: true });
const report = { browser: browserName, frontend: dev ? 'isolated Vite' : 'production build', fixtureServices: true,
  realWebSockets: true, cloudServices: false, actualUserSession: false, cases: [], pageErrors: [],
  limitations: ['Video, Google sign-in, billing, and cloud storage are not exercised.', 'WebKit phone checks use mouse input; Chrome phone checks use trusted touch.'] };
let server, vite, realtime, browser, devTransport;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function start() {
  const allowedOrigins = new Set();
  const pictures = Object.fromEntries(['beginWrite', 'add', 'get', 'isTutor'].map(method => [method, (...args) => realtime.pictures[method](...args)]));
  const app = createApp({ pictures, library: { list: async () => [] }, words: { bank: async () => ({ levels: [], words: {} }) } });
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
async function check(session, name, action) {
  const item = { viewport: session.mobile ? 'phone' : 'desktop', name };
  report.cases.push(item);
  try { Object.assign(item, await action()); item.passed = true; }
  catch (error) { item.passed = false; item.error = error.message; await session.tutor.screenshot({ path: join(out, `failure-${report.cases.length}.png`) }).catch(() => {}); }
}
async function countOnBoth(session, selector, count) {
  for (const page of [session.tutor, session.student]) await page.waitForFunction(({ selector, count }) => document.querySelectorAll(selector).length === count, { selector, count });
}
async function materials(page, tab) {
  if (!await page.getByRole('tab', { name: tab, exact: true }).isVisible()) await page.getByRole('tab', { name: 'Materials', exact: true }).click();
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
