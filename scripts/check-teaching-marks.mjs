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
import { memoryLessons } from '../server/lessonFixtures.js';
import { TEACHING_MARKS } from '../shared/teachingMarks.js';

// Real preparation/whiteboard components and sockets, isolated synthetic accounts
// and memory storage. Never connects to the user's running app or cloud services.
let browserName = 'chrome', output, selectedViewport = 'all';
for (let n = 2; n < process.argv.length; n++) {
  const option = process.argv[n];
  if (option === '--browser') browserName = process.argv[++n];
  else if (option === '--output') output = process.argv[++n];
  else if (option === '--viewport') selectedViewport = process.argv[++n];
  else if (option === '--help') { console.log('Usage: node scripts/check-teaching-marks.mjs [--browser chrome|chromium|webkit] [--viewport all|desktop|tablet|phone] [--output DIRECTORY]'); process.exit(0); }
  else throw new Error(`Unknown option: ${option}`);
}
assert(['chrome', 'chromium', 'webkit'].includes(browserName));
assert(['all', 'desktop', 'tablet', 'phone'].includes(selectedViewport));
const root = fileURLToPath(new URL('../', import.meta.url));
assert(existsSync(join(root, 'dist/index.html')), 'Run the production build first.');
const out = output ? resolve(output) : mkdtempSync(join(tmpdir(), 'mpt-teaching-marks-'));
mkdirSync(out, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fingerprint() {
  const html = readFileSync(join(root, 'dist/index.html'));
  return { indexSha256: hash(html), scripts: [...html.toString().matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => ({ url: match[1], sha256: hash(readFileSync(join(root, 'dist', match[1].replace(/^\//, '')))) })) };
}
const report = { browser: browserName, frontend: 'production build', fixtureServices: true, realWebSockets: true, actualUserSession: false, cloudServices: false,
  build: fingerprint(), cases: [], pageErrors: [],
  limitations: ['Synthetic account cookies and in-memory lesson storage; no real OAuth, cloud persistence or billing.', 'Chrome phone/tablet additions use trusted touch; sizing also uses the keyboard alternative. No physical touch device or screen reader.', 'Restart is a controlled fixture realtime-server restart, not an Azure deployment. No live camera or microphone.'] };
const owners = new Set(['fixture-marks-owner', 'fixture-marks-other']);
const fixture = memoryLessons({ ownerExists: async owner => owners.has(owner) });
const accounts = { clientId: null, tutorFor: async token => token === 'fixture-marks-cookie' ? { id: 'fixture-marks-owner', name: 'Fixture tutor', email: 'marks@example.test', roles: ['owner'], picture: '', subscription: null } : null };
let server, realtime, browser, app;
const origins = new Set(), connections = new WeakMap();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, description, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await test()) return; await pause(25); }
  assert.fail(description);
}
async function listen(port = 0) {
  server = http.createServer(app); const sockets = new Set(); connections.set(server, sockets);
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  realtime = attachRealtime(server, { allowedOrigins: origins, maxRoomsPerIp: 100, canStartLesson: async () => ({ ok: true }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`; origins.add(base); return base;
}
async function start() {
  const pictures = Object.fromEntries(['beginWrite', 'add', 'get', 'isTutor'].map(method => [method, (...args) => realtime.pictures[method](...args)]));
  app = createApp({ accounts, lessons: fixture.lessons, pictures, library: { list: async () => [], image: async () => null } });
  const base = await listen();
  browser = await (browserName === 'webkit' ? webkit : chromium).launch(browserName === 'chrome' ? { channel: 'chrome' } : {});
  return base;
}
async function restart() {
  const port = server.address().port, previousServer = server, previous = realtime;
  previous.close(); previousServer.closeIdleConnections();
  await new Promise(resolve => previousServer.close(resolve));
  await until(() => connections.get(previousServer).size === 0, 'Retired fixture connections must close');
  for (const room of previous.rooms.values()) clearTimeout(room.closeTimer);
  await listen(port);
}
async function instrument(page) {
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.marksSent = []; window.marksReceived = []; window.marksSockets = [];
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) { super(...args); if (String(args[0]).endsWith('/ws')) window.marksSockets.push(this); this.addEventListener('message', event => { try { window.marksReceived.push(JSON.parse(event.data)); } catch {} }); }
      send(data) { try { window.marksSent.push(JSON.parse(data)); } catch {} super.send(data); }
    };
  });
}
async function check(room, name, action) {
  const item = { viewport: room.name, name }; report.cases.push(item);
  try { Object.assign(item, await action()); item.passed = true; return true; }
  catch (error) {
    item.passed = false; item.error = error.stack;
    await room.tutor.screenshot({ path: join(out, `failure-${report.cases.length}.png`), animations: 'disabled' }).catch(() => {});
    await room.tutor.locator('body').innerText().then(text => writeFileSync(join(out, `failure-${report.cases.length}.txt`), text)).catch(() => {});
    return false;
  } finally { writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ viewport: room.name, name, passed: item.passed })); }
}
const panel = page => page.getByRole('region', { name: 'Prepared lesson', exact: true });
const live = room => { const result = realtime.rooms.get(room.code); assert(result, 'Fixture classroom must exist'); return result; };
const contents = room => [...live(room).board.pieces.values()].map(({ content, x, y, w, h }) => ({ content, x, y, w, h })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const stage = page => page.locator('[data-board-surface] > svg[role="img"]');
const viewBox = page => stage(page).getAttribute('viewBox');
async function activate(room, locator) { if (room.touch && browserName !== 'webkit') await locator.tap(); else await locator.click(); }
async function settle(locator) { await locator.evaluate(node => Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})))); }
async function bothCount(room, count) {
  for (const page of [room.tutor, room.student]) await page.waitForFunction(count => document.querySelectorAll('[data-board-surface] [data-native-content="mark"]').length === count, count);
}
async function documentFor(room) { const response = await room.context.request.get(`${room.base}/api/lessons/${room.id}`); assert.equal(response.status(), 200); return (await response.json()).lesson; }
async function openGuide(room) {
  if (!await panel(room.tutor).isVisible()) await activate(room, room.tutor.locator('[data-whiteboard-topbar]').getByRole('button', { name: 'Tutor guide', exact: true }));
  await panel(room.tutor).waitFor({ state: 'visible' });
}
async function closeGuide(room) {
  const close = room.tutor.getByRole('button', { name: 'Close tutor guide', exact: true });
  if (await close.isVisible()) await activate(room, close);
}
async function materials(room, name = 'Letters') {
  await closeGuide(room);
  const toggle = room.tutor.locator('[data-panel-sheet] h2 button[aria-expanded]');
  if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') {
    await activate(room, toggle); await room.tutor.waitForFunction(() => document.querySelector('[data-panel-sheet] h2 button[aria-expanded]')?.getAttribute('aria-expanded') === 'true');
    await settle(room.tutor.locator('[data-panel-sheet-slot]'));
  }
  await activate(room, room.tutor.getByRole('tab', { name, exact: true }));
}
async function closeMaterials(room) {
  const close = room.tutor.getByRole('button', { name: 'Close Materials', exact: true });
  if (await close.isVisible()) {
    await activate(room, close);
    await room.tutor.waitForFunction(() => { const button = document.querySelector('[data-panel-sheet] h2 button[aria-expanded]'); return button?.getAttribute('aria-expanded') === 'false' && document.activeElement === button; });
    await settle(room.tutor.locator('[data-panel-sheet-slot]'));
  }
}
async function selectPiece(room, page, id) {
  await activate(room, page.locator('[data-picture-layers-control] > button'));
  await activate(room, page.locator(`[data-picture-layer="${id}"]`));
}
async function pageMenu(room) {
  await closeGuide(room); await closeMaterials(room);
  await activate(room, room.tutor.getByRole('button', { name: /^Board pages, page / }));
  const chooser = room.tutor.getByRole('dialog', { name: 'Board pages', exact: true }); await settle(chooser); return chooser;
}
async function waitBoard(room, id) {
  for (const page of [room.tutor, room.student]) await page.waitForFunction(id => window.marksReceived.filter(message => message.t === 'board').at(-1)?.pageId === id, id);
}
async function privacy(room) {
  const data = await room.student.evaluate(() => JSON.stringify({ messages: window.marksReceived, text: document.body.textContent, storage: { ...sessionStorage } }));
  for (const marker of [room.privateTitle, room.privateDirections]) assert(!data.includes(marker), 'Private preparation must not appear in the student payload/UI');
  assert(!await room.student.getByRole('group', { name: 'Prepared teaching marks', exact: true }).count());
  return { privatePlanLeaked: false };
}
async function geometry(group) {
  return group.evaluate(node => {
    const panel = node.getBoundingClientRect();
    return { panel: panel.toJSON(), overflow: node.scrollWidth > node.clientWidth,
      buttons: [...node.querySelectorAll('button')].map(button => {
        const r = button.getBoundingClientRect(), label = button.querySelector('span.flex-1');
        const textRange = label && document.createRange(); if (label) textRange.selectNodeContents(label);
        return { label: button.getAttribute('aria-label'), text: label?.textContent, labelLines: textRange?.getClientRects().length,
          width: r.width, height: r.height, left: r.left, right: r.right };
      }),
      horizontalPageOverflow: document.documentElement.scrollWidth > innerWidth };
  });
}
async function boardGeometry(page) {
  return page.locator('[data-board-surface]').evaluate(surface => {
    const viewport = surface.getBoundingClientRect();
    return { viewport: viewport.toJSON(), viewBox: surface.querySelector('svg[role="img"]').getAttribute('viewBox'),
      marks: [...surface.querySelectorAll('[data-native-content="mark"]')].map(mark => {
        const box = mark.getBoundingClientRect();
        return { box: box.toJSON(), visible: box.left >= viewport.left - 1 && box.top >= viewport.top - 1 && box.right <= viewport.right + 1 && box.bottom <= viewport.bottom + 1 };
      }) };
  });
}
function assertGeometry(result) {
  assert(!result.overflow && !result.horizontalPageOverflow, 'Teaching marks must not create horizontal overflow');
  for (const button of result.buttons) {
    assert(button.width >= 44 && button.height >= 44, `${button.label} needs a 44px target`);
    assert(button.left >= result.panel.left - 1 && button.right <= result.panel.right + 1, `${button.label} must remain inside its palette`);
    if (/^[A-Za-z]+$/.test(button.text || '')) assert(button.labelLines <= 1, `${button.text} must not split a single word across lines`);
  }
}
async function run(base, config) {
  const context = await browser.newContext({ viewport: { width: config.width, height: config.height }, hasTouch: config.touch, isMobile: config.name === 'phone' });
  const studentContext = await browser.newContext({ viewport: { width: config.width, height: config.height }, hasTouch: config.touch, isMobile: config.name === 'phone' });
  for (const session of [context, studentContext]) session.setDefaultTimeout(15000);
  await context.addCookies([{ name: 'mpt_session', value: 'fixture-marks-cookie', url: base, httpOnly: true, sameSite: 'Lax' }]);
  const tutor = await context.newPage(), student = await studentContext.newPage(); await instrument(tutor); await instrument(student);
  const room = { ...config, context, studentContext, tutor, student, base, privateTitle: `PRIVATE_MARK_PLAN_${config.name}`, privateDirections: `PRIVATE_MARK_DIRECTIONS_${config.name}` };
  try {
    if (!await check(room, 'Preparation saves all named marks privately and restores selection after reload', async () => {
      await tutor.goto(`${base}/lessons`); await tutor.getByRole('textbox', { name: 'Lesson name', exact: true }).fill(room.privateTitle);
      await activate(room, tutor.getByRole('button', { name: 'Prepare lesson', exact: true }));
      await tutor.waitForURL(/\/lessons\/[A-Za-z0-9_-]+$/); room.id = new URL(tutor.url()).pathname.split('/').at(-1);
      await activate(room, tutor.getByRole('group', { name: 'Add activity', exact: true }).getByRole('button', { name: 'Build words', exact: true }));
      const editor = tutor.getByRole('region', { name: 'Activity editor', exact: true });
      await editor.getByRole('textbox', { name: /^Starting letter tiles/ }).fill('a m');
      await editor.getByRole('textbox', { name: /^Directions for you/ }).fill(room.privateDirections);
      await activate(room, editor.locator('summary').filter({ hasText: /^Teaching marks/ }));
      const palette = editor.getByRole('group', { name: 'Teaching marks', exact: true });
      for (const mark of TEACHING_MARKS) await activate(room, palette.getByRole('button', { name: mark.label, exact: true }));
      await activate(room, tutor.getByRole('button', { name: 'Save lesson', exact: true }));
      await tutor.getByRole('status').filter({ hasText: /^Lesson saved\.$/ }).waitFor();
      const saved = await documentFor(room); assert.deepEqual(saved.activities[0].marks, TEACHING_MARKS.map(mark => mark.id));
      await tutor.reload(); await editor.getByRole('textbox', { name: /^Starting letter tiles/ }).waitFor();
      await activate(room, editor.locator('summary').filter({ hasText: /^Teaching marks/ })); await palette.waitFor();
      for (const mark of TEACHING_MARKS) assert.equal(await palette.getByRole('button', { name: mark.label, exact: true }).getAttribute('aria-pressed'), 'true');
      const measured = await geometry(palette); assertGeometry(measured);
      await palette.screenshot({ path: join(out, `preparation-marks-${config.name}.png`), animations: 'disabled' });
      return { savedMarkIds: saved.activities[0].marks, geometry: measured };
    })) return;
    if (!await check(room, 'Opening the prepared activity shares no marks until the tutor explicitly adds them', async () => {
      await activate(room, tutor.getByRole('button', { name: 'Teach this lesson →', exact: true }));
      await panel(tutor).getByRole('button', { name: 'Activity page is open', exact: true }).waitFor();
      const created = await tutor.evaluate(() => window.marksReceived.filter(message => message.t === 'room').at(-1)); room.code = created.code;
      await student.goto(`${base}/whiteboard/${room.code}`); await student.getByText('Connected to your tutor', { exact: false }).waitFor();
      await bothCount(room, 0); assert.equal(live(room).board.tiles.size, 2); assert.equal(live(room).pictures.size, 0);
      assert.equal(live(room).board.pieces.size, 0);
      const measured = await geometry(panel(tutor).getByRole('group', { name: 'Prepared teaching marks', exact: true })); assertGeometry(measured);
      return { noAutomaticMarks: true, noBackingPicture: true, geometry: measured, ...await privacy(room) };
    })) return;
    if (!await check(room, 'All eleven glyphs add as clean shared board objects without changing the camera', async () => {
      let earlierZoom = null;
      if (config.name === 'desktop') {
        await closeGuide(room);
        await activate(room, tutor.getByRole('button', { name: 'Zoom to 100%', exact: true }));
        for (let n = 0; n < 3; n++) await activate(room, tutor.getByRole('button', { name: 'Zoom in', exact: true }));
        const box = await stage(tutor).boundingBox();
        await tutor.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await tutor.mouse.wheel(-3000, 0);
        await until(async () => { const [x, , width] = (await viewBox(tutor)).split(' ').map(Number); return x + width < 800; }, 'Earlier teaching view must exclude the board center');
        earlierZoom = await viewBox(tutor);
        await openGuide(room);
        await until(async () => Number((await viewBox(tutor)).split(' ')[2]) >= 1599, 'Docked guide should temporarily fit the full board');
      }
      const before = await viewBox(tutor);
      for (const [index, mark] of TEACHING_MARKS.entries()) {
        await openGuide(room);
        await activate(room, panel(tutor).getByRole('group', { name: 'Prepared teaching marks', exact: true }).getByRole('button', { name: `Add ${mark.label}`, exact: true }));
        await until(() => live(room).board.pieces.size === index + 1, `${mark.label} must reach the shared board`);
      }
      await bothCount(room, 11); assert.equal(await viewBox(tutor), before);
      assert.equal(live(room).pictures.size, 0); assert.deepEqual([...live(room).pictureIds], []);
      for (const piece of live(room).board.pieces.values()) { assert.equal(piece.pic, null); assert.equal(piece.content.kind, 'mark'); }
      for (const page of [tutor, student]) assert.equal(await page.locator('[data-board-surface] [data-native-content="mark"] image').count(), 0);
      const beforeClosing = await boardGeometry(tutor);
      await closeGuide(room); await closeMaterials(room);
      const afterClosing = await boardGeometry(tutor);
      assert.equal(afterClosing.marks.length, 11);
      assert(afterClosing.marks.every(mark => mark.visible), 'Closing the guide and Materials must keep all added marks visible');
      await tutor.screenshot({ path: join(out, `native-marks-${config.name}.png`), animations: 'disabled' });
      return { marks: 11, sourceImages: 0, cameraUnchanged: true, earlierZoom, beforeClosing, afterClosing, ...await privacy(room) };
    })) return;
    if (!await check(room, 'Live Materials uses the same palette and marks use Size, Duplicate and Delete consistently', async () => {
      await materials(room);
      await activate(room, tutor.locator('summary').filter({ hasText: /^Teaching marks$/ }));
      const palette = tutor.getByRole('group', { name: 'Teaching marks', exact: true }); const measured = await geometry(palette); assertGeometry(measured);
      await activate(room, palette.getByRole('button', { name: 'Add Schwa', exact: true }));
      await bothCount(room, 12); await closeMaterials(room);
      room.selectedId = [...live(room).board.pieces.keys()].at(-1);
      await selectPiece(room, tutor, room.selectedId);
      const originalWidth = live(room).board.pieces.get(room.selectedId).w, camera = await viewBox(tutor);
      await activate(room, tutor.getByRole('button', { name: 'Schwa size', exact: true }));
      const slider = tutor.getByRole('slider', { name: 'Schwa size', exact: true }); await slider.press('ArrowRight');
      await until(() => live(room).board.pieces.get(room.selectedId).w > originalWidth, 'Size keyboard control must resize the mark');
      await slider.press('Escape'); assert.equal(await viewBox(tutor), camera);
      await activate(room, tutor.getByRole('button', { name: 'Duplicate mark', exact: true })); await bothCount(room, 13);
      await activate(room, tutor.getByRole('button', { name: 'Delete mark', exact: true })); await bothCount(room, 12);
      assert.equal(await viewBox(tutor), camera, 'Duplicating and deleting a mark must preserve the current camera');
      await tutor.screenshot({ path: join(out, `mark-controls-${config.name}.png`), animations: 'disabled' });
      return { sharedPalette: true, continuousKeyboardSize: true, duplicateDelete: true, geometry: measured };
    })) return;
    if (!await check(room, 'Students receive the marks but only the tutor instantiates, duplicates or deletes them', async () => {
      assert.equal(await student.getByRole('button', { name: 'Add Breve', exact: true }).count(), 0);
      assert.equal(await student.getByRole('button', { name: 'Duplicate mark', exact: true }).count(), 0);
      assert.equal(await student.getByRole('button', { name: 'Delete mark', exact: true }).count(), 0);
      await selectPiece(room, student, room.selectedId);
      const beforeNudge = { ...live(room).board.pieces.get(room.selectedId) };
      assert.equal(await student.getByRole('button', { name: 'Schwa size', exact: true }).count(), 0);
      await stage(student).press('ArrowRight');
      await until(() => live(room).board.pieces.get(room.selectedId).x === beforeNudge.x + 2, 'Student keyboard movement must match permitted dragging with tools off');
      assert.equal(live(room).board.pieces.get(room.selectedId).w, beforeNudge.w, 'Keyboard movement does not grant resize permission');
      await activate(room, tutor.getByRole('button', { name: 'Lesson controls', exact: true }));
      const controls = tutor.getByRole('dialog', { name: 'Lesson controls', exact: true });
      const toggle = controls.getByRole('switch', { name: 'Student tools', exact: true }); if (await toggle.getAttribute('aria-checked') !== 'true') await activate(room, toggle);
      await tutor.keyboard.press('Escape');
      await selectPiece(room, student, room.selectedId);
      const previous = live(room).board.pieces.get(room.selectedId).w;
      await activate(room, student.getByRole('button', { name: 'Schwa size', exact: true }));
      const slider = student.getByRole('slider', { name: 'Schwa size', exact: true }); await slider.press('ArrowRight');
      await until(() => live(room).board.pieces.get(room.selectedId).w > previous, 'Student tools should allow resizing an existing shared mark'); await slider.press('Escape');
      await tutor.waitForFunction(({ id, width }) => Number(document.querySelector(`[data-picture-piece="${id}"] > svg`).getAttribute('width')) === width, { id: room.selectedId, width: live(room).board.pieces.get(room.selectedId).w });
      return { tutorOnlyCreation: true, keyboardMoveWithToolsOff: true, permittedStudentSizeSynced: true, ...await privacy(room) };
    })) return;
    if (!await check(room, 'Duplicated and switched pages retain their independent marks on both screens', async () => {
      room.originalPage = live(room).pageId; room.originalContents = contents(room);
      let chooser = await pageMenu(room); await activate(room, chooser.getByRole('button', { name: 'Duplicate', exact: true }));
      await until(() => live(room).pages.size === 2, 'Page duplication should complete'); await waitBoard(room, live(room).pageId); await bothCount(room, 12);
      assert.deepEqual(contents(room), room.originalContents);
      chooser = await pageMenu(room); await activate(room, chooser.locator('ol button').nth(0)); await waitBoard(room, room.originalPage); await bothCount(room, 12);
      chooser = await pageMenu(room); await activate(room, chooser.getByRole('button', { name: 'Blank page', exact: true }));
      await until(() => live(room).pages.size === 3, 'Blank page should be added'); await waitBoard(room, live(room).pageId); await bothCount(room, 0);
      chooser = await pageMenu(room); await activate(room, chooser.locator('ol button').nth(0)); await waitBoard(room, room.originalPage); await bothCount(room, 12);
      assert.deepEqual(contents(room), room.originalContents); return { pages: 3, independentContents: true };
    })) return;
    if (!await check(room, 'Tutor/student reload and a realtime restart recover marks without uploading source pictures', async () => {
      const before = contents(room);
      await tutor.reload(); await tutor.locator('[data-board-surface]').waitFor(); await until(() => live(room).board.pieces.size === 12, 'Tutor reload should retain shared marks');
      await student.reload(); await bothCount(room, 12); assert.deepEqual(contents(room), before);
      await restart(); await until(() => realtime.rooms.get(room.code)?.restoring === false && realtime.rooms.get(room.code)?.board.pieces.size === 12, 'Tutor should restore source-free marks after fixture restart', 20000);
      await bothCount(room, 12); assert.deepEqual(contents(room), before); assert.equal(live(room).pages.size, 3); assert.equal(live(room).pictures.size, 0);
      return { reconnect: true, restartedPages: 3, sourceUploads: 0 };
    })) return;
    if (!await check(room, 'Removing session images preserves marks, while Clear board clears current work only', async () => {
      await materials(room, 'Pictures');
      await tutor.locator('input[type="file"][accept="image/*"]').first().setInputFiles({ name: 'marks-cleanup-fixture.jpg', mimeType: 'image/jpeg', buffer: readFileSync(join(root, 'src/whiteboard/fixtures/lip-biter-240.jpg')) });
      await until(() => live(room).pictures.size === 1 && live(room).board.pieces.size === 13, 'Uploaded photo should share the board with twelve marks');
      await materials(room, 'Pictures'); await activate(room, tutor.getByRole('button', { name: 'Picture options', exact: true }));
      await activate(room, tutor.getByRole('button', { name: 'Remove all session images', exact: true }));
      await activate(room, tutor.getByRole('button', { name: 'Remove images', exact: true }));
      await bothCount(room, 12); assert.equal(live(room).pictures.size, 0); assert.equal(live(room).board.pieces.size, 12);
      await closeMaterials(room);
      const clear = tutor.getByRole('button', { name: 'Clear board', exact: true });
      if (!await clear.isVisible()) {
        const show = tutor.getByRole('button', { name: /^(Show drawing tools|Show tools)$/ }); await activate(room, show);
      }
      await activate(room, clear); await activate(room, tutor.getByRole('button', { name: 'Clear now?', exact: true })); await bothCount(room, 0);
      assert.equal(live(room).pages.size, 3); assert.equal((await documentFor(room)).activities[0].marks.length, 11);
      const other = [...live(room).pages.values()].find(page => page.id !== room.originalPage && page.pieces.size); assert.equal(other.pieces.size, 12);
      return { imageCleanupPreservesMarks: true, clearBoardRemovesMarks: true, savedSelections: 11, otherPageMarks: 12 };
    })) return;
  } finally { await context.close(); await studentContext.close(); }
}
try {
  const base = await start();
  const sizes = [{ name: 'desktop', width: 1440, height: 900, touch: false }, { name: 'tablet', width: 768, height: 1024, touch: true }, { name: 'phone', width: 393, height: 852, touch: true }];
  for (const config of sizes) if (selectedViewport === 'all' || selectedViewport === config.name) await run(base, config);
} catch (error) { report.fatal = error.stack; }
finally {
  await browser?.close(); realtime?.close();
  for (const room of realtime?.rooms.values() || []) clearTimeout(room.closeTimer);
  server?.closeIdleConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
  report.buildUnchanged = JSON.stringify(fingerprint()) === JSON.stringify(report.build);
  report.passed = !report.fatal && !report.pageErrors.length && report.buildUnchanged && report.cases.length > 0 && report.cases.every(item => item.passed);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output: out, passed: report.cases.filter(item => item.passed).length, total: report.cases.length, pageErrors: report.pageErrors, fatal: report.fatal, buildUnchanged: report.buildUnchanged, failures: report.cases.filter(item => !item.passed).map(({ viewport, name, error }) => ({ viewport, name, error })) }, null, 2));
  if (!report.passed) process.exitCode = 1;
}
