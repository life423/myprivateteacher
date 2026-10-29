import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createApp } from '../server/index.js';
import { attachRealtime } from '../server/realtime.js';

// Actual tutor/student UI and room sockets against ephemeral fixture services.
// Does not connect to a running user app, OAuth, storage, or media devices.
let dev = false, headerOnly = false, browserName = 'chrome', output;
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === '--dev') dev = true;
  else if (arg === '--header-only') headerOnly = true;
  else if (arg === '--browser') browserName = process.argv[++index];
  else if (arg === '--output') output = process.argv[++index];
  else if (arg === '--help') {
    console.log('Usage: node scripts/check-lesson-controls.mjs [--dev] [--header-only] [--browser chrome|chromium|webkit] [--output DIRECTORY]');
    process.exit(0);
  } else throw new Error(`Unknown option: ${arg}`);
}
assert(['chrome', 'chromium', 'webkit'].includes(browserName));
const root = fileURLToPath(new URL('../', import.meta.url));
assert(dev || existsSync(join(root, 'dist/index.html')), 'Build first, or pass --dev.');
const out = output ? resolve(output) : mkdtempSync(join(tmpdir(), 'mpt-lesson-controls-'));
mkdirSync(out, { recursive: true });
const report = { browser: browserName, frontend: dev ? 'isolated Vite' : 'production build',
  fixtureServices: true, realWebSockets: true, actualUserSession: false, cloudServices: false,
  limitations: ['Tests use mouse and keyboard input at phone-sized viewports, not physical-device touch.', 'No live camera, microphone, Google sign-in, billing, or cloud storage.'], cases: [], pageErrors: [] };
let server, vite, transport, realtime, browser;
const dialog = page => page.getByRole('dialog', { name: 'Lesson controls', exact: true });
const trigger = page => page.getByRole('button', { name: 'Lesson controls', exact: true });
const close = page => page.getByRole('button', { name: 'Close lesson controls', exact: true });
async function settle(element) {
  await element.evaluate(async node => {
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    await Promise.all(node.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
}
async function open(page) {
  if (await trigger(page).getAttribute('aria-expanded') !== 'true') await trigger(page).click();
  await dialog(page).waitFor({ state: 'visible' });
  await settle(dialog(page));
}
async function check(viewport, name, action, page) {
  const item = { viewport: `${viewport.width}x${viewport.height}`, name };
  report.cases.push(item);
  try { Object.assign(item, await action()); item.passed = true; }
  catch (error) {
    item.passed = false; item.error = error.message;
    await page.screenshot({ path: join(out, `failure-${report.cases.length}.png`) }).catch(() => {});
  }
}
async function instruments(page) {
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.controlMessages = [];
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => { try { window.controlMessages.push(JSON.parse(event.data)); } catch {} });
      }
    };
  });
}
async function start() {
  const allowedOrigins = new Set();
  const pictures = Object.fromEntries(['beginWrite', 'add', 'get', 'isTutor'].map(method => [method, (...args) => realtime.pictures[method](...args)]));
  const app = createApp({ pictures, library: { list: async () => [], image: async () => null },
    words: { bank: async () => ({ levels: [], words: {} }) } });
  if (dev) {
    const { createServer } = await import('vite');
    const { default: config } = await import('../vite.config.js');
    transport = http.createServer();
    await new Promise((done, fail) => { transport.once('error', fail); transport.listen(0, '127.0.0.1', done); });
    vite = await createServer({ ...config, root, configFile: false, cacheDir: join(out, 'vite-cache'),
      server: { ...config.server, middlewareMode: true, hmr: false, ws: { server: transport, host: '127.0.0.1', clientPort: transport.address().port }, proxy: undefined }, appType: 'spa' });
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
async function headerGeometry(page, viewport) {
  const headerActions = await page.locator('[data-whiteboard-topbar]').evaluate(header => [...header.querySelectorAll('button')].filter(node => !node.closest('[data-lesson-controls]') && node.getBoundingClientRect().width > 0).map(node => { const r = node.getBoundingClientRect(); return { label: node.getAttribute('aria-label') || node.textContent.trim(), x: r.x, y: r.y, width: r.width, height: r.height, hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) }; }));
  for (const action of headerActions) { assert(action.x >= 0 && action.x + action.width <= viewport.width + 1, `${action.label} must fit in the header (${action.x}+${action.width})`); assert(action.hit, `${action.label} must receive header pointer input`); }
  return { headerActions };
}
async function runViewport(base, viewport) {
  const context = await browser.newContext({ viewport });
  context.setDefaultTimeout(10_000);
  const tutor = await context.newPage(), student = await context.newPage();
  await instruments(tutor); await instruments(student);
  await tutor.goto(`${base}/whiteboard/teach`);
  await tutor.waitForFunction(() => window.controlMessages.some(message => message.t === 'room'));
  const code = await tutor.evaluate(() => window.controlMessages.find(message => message.t === 'room').code);
  await student.goto(`${base}/whiteboard/${code}`);
  await tutor.waitForFunction(() => window.controlMessages.some(message => message.t === 'presence' && message.student));
  await tutor.bringToFront();
  if (headerOnly) {
    await check(viewport, 'Compact header buttons stay within viewport and receive input', () => headerGeometry(tutor, viewport), tutor);
    await tutor.screenshot({ path: join(out, `header-${viewport.width}x${viewport.height}.png`) });
    await context.close(); return;
  }

  await check(viewport, 'Labeled trigger, bounded grouped panel, readable controls and minimum targets', async () => {
    const text = await trigger(tutor).innerText();
    assert(/controls/i.test(text), 'The dropdown needs a visible Controls label');
    const { headerActions } = await headerGeometry(tutor, viewport);
    const t = await trigger(tutor).boundingBox();
    assert(t.width >= 44 && t.height >= 44, 'Controls trigger must be at least 44px');
    await open(tutor);
    assert(await dialog(tutor).getByText('Student tools', { exact: true }).isVisible());
    assert(await dialog(tutor).getByText('Alphabet strip', { exact: true }).isVisible());
    const bounds = await dialog(tutor).boundingBox();
    assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, 'Panel must stay inside viewport');
    const targets = [];
    for (const element of await dialog(tutor).locator('button, input, select, [role="switch"]').all()) {
      if (!await element.isVisible()) continue;
      await element.scrollIntoViewIfNeeded();
      const geometry = await element.evaluate(node => {
        const r = node.getBoundingClientRect();
        return { label: node.getAttribute('aria-label') || node.textContent.trim(), width: r.width, height: r.height,
          enabled: !node.disabled, hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
      });
      assert(geometry.width >= 44 && geometry.height >= 44, `${geometry.label} must be at least 44px`);
      if (geometry.enabled) assert(geometry.hit, `${geometry.label} must receive pointer input`);
      targets.push(geometry);
    }
    await dialog(tutor).evaluate(node => { for (const element of [node, ...node.querySelectorAll('*')]) if (element.scrollHeight > element.clientHeight) element.scrollTop = 0; });
    await tutor.screenshot({ path: join(out, `controls-${viewport.width}x${viewport.height}.png`) });
    return { trigger: t, panel: bounds, targets, headerActions };
  }, tutor);

  await check(viewport, 'Close and Escape restore focus; ArrowDown opens and focuses controls', async () => {
    await open(tutor); await close(tutor).click();
    await tutor.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Lesson controls');
    assert.equal(await trigger(tutor).getAttribute('aria-expanded'), 'false');
    await trigger(tutor).press('ArrowDown');
    await dialog(tutor).waitFor({ state: 'visible' });
    assert(await dialog(tutor).evaluate(node => node.contains(document.activeElement)), 'Opening should move focus into controls');
    await tutor.keyboard.press('Escape');
    await tutor.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Lesson controls');
    assert.equal(await trigger(tutor).getAttribute('aria-expanded'), 'false');
    return {};
  }, tutor);

  await check(viewport, 'Outside dismissal preserves the browser’s native pointer-focus behavior', async () => {
    if (await trigger(tutor).getAttribute('aria-expanded') === 'true') await close(tutor).click();
    await tutor.waitForFunction(() => !document.querySelector('[data-lesson-controls]'));
    await tutor.evaluate(() => {
      const target = document.createElement('button'); target.textContent = 'Outside fixture target'; target.id = 'outside-controls-target';
      target.style.cssText = 'position:fixed;bottom:1px;left:1px;z-index:100;width:150px;height:44px'; document.body.append(target);
      document.activeElement?.blur();
    });
    // Safari does not focus a button on pointer click by default. Compare with
    // that browser's own baseline, instead of requiring Chrome's focus policy.
    const focused = () => tutor.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id || '', label: document.activeElement?.getAttribute('aria-label') || '' }));
    await tutor.locator('#outside-controls-target').click();
    const nativeFocus = await focused();
    await open(tutor);
    await tutor.locator('#outside-controls-target').click();
    assert.equal(await trigger(tutor).getAttribute('aria-expanded'), 'false');
    const dismissedFocus = await focused();
    assert.deepEqual(dismissedFocus, nativeFocus);
    assert.notEqual(dismissedFocus.label, 'Lesson controls', 'Outside dismissal must not restore focus to the trigger');
    await tutor.locator('#outside-controls-target').evaluate(node => node.remove());
    return { nativeFocus, dismissedFocus };
  }, tutor);

  await check(viewport, 'Inline writing-line choices remain usable and update both screens', async () => {
    await open(tutor);
    const off = dialog(tutor).getByRole('button', { name: 'Off writing lines', exact: true });
    await off.click();
    for (const page of [tutor, student]) await page.waitForFunction(() => window.controlMessages.some(message => message.t === 'lines:set' && message.size === 'off'));
    assert.equal(await off.getAttribute('aria-pressed'), 'true');
    assert.equal(await trigger(tutor).getAttribute('aria-expanded'), 'true', 'Choosing a line size should retain Lesson controls');
    const medium = dialog(tutor).getByRole('button', { name: 'Medium writing lines', exact: true });
    await medium.click();
    for (const page of [tutor, student]) await page.waitForFunction(() => window.controlMessages.some(message => message.t === 'lines:set' && message.size === 'medium'));
    assert.equal(await medium.getAttribute('aria-pressed'), 'true');
    assert.equal(await off.getAttribute('aria-pressed'), 'false');
    await close(tutor).click();
    return {};
  }, tutor);

  await check(viewport, 'Student controls never expose tutor permissions, including after tools are enabled', async () => {
    await student.bringToFront(); await open(student);
    assert.equal(await dialog(student).getByRole('switch', { name: 'Student tools' }).count(), 0);
    assert.equal(await dialog(student).getByRole('switch', { name: 'Alphabet strip' }).count(), 0);
    assert.equal(await dialog(student).getByRole('button', { name: /writing lines$/i }).count(), 0);
    assert.equal(await dialog(student).getByRole('button', { name: 'Left hand', exact: true }).count(), 0);
    await close(student).click();
    await tutor.bringToFront(); await open(tutor);
    const control = dialog(tutor).getByRole('switch', { name: 'Student tools', exact: true });
    if (await control.getAttribute('aria-checked') !== 'true') await control.click();
    await student.waitForFunction(() => window.controlMessages.some(message => message.t === 'tools' && message.on));
    await student.bringToFront(); await open(student);
    assert(await dialog(student).getByRole('button', { name: 'Left hand', exact: true }).isVisible());
    const studentHands = [];
    for (const name of ['Left hand', 'Right hand']) {
      const hand = dialog(student).getByRole('button', { name, exact: true });
      await hand.scrollIntoViewIfNeeded();
      const bounds = await hand.boundingBox();
      assert(bounds.width >= 44 && bounds.height >= 44, `Student ${name} must be at least44px`);
      studentHands.push({ name, ...bounds });
    }
    assert.equal(await dialog(student).getByRole('switch', { name: 'Student tools' }).count(), 0);
    assert.equal(await dialog(student).getByRole('button', { name: /writing lines$/i }).count(), 0);
    await close(student).click(); await tutor.bringToFront();
    return { studentHands };
  }, student);

  await check(viewport, 'Reduced motion removes panel/chevron animation and header has no overflow', async () => {
    await open(tutor); await close(tutor).click();
    await tutor.emulateMedia({ reducedMotion: 'reduce' });
    await open(tutor);
    const measurements = await tutor.evaluate(() => {
      const panel = document.querySelector('[role="dialog"][aria-label="Lesson controls"]');
      const button = document.querySelector('button[aria-label="Lesson controls"]');
      const motion = [panel, button.querySelector('svg')].filter(Boolean).map(node => { const style = getComputedStyle(node); return { animationName: style.animationName, animationDuration: style.animationDuration, transitionDuration: style.transitionDuration }; });
      return { motion, animations: [...panel.getAnimations({ subtree: true }), ...button.getAnimations({ subtree: true })].filter(animation => animation.playState === 'running').length,
        overflow: document.documentElement.scrollWidth > innerWidth, header: document.querySelector('[data-whiteboard-topbar]').getBoundingClientRect().height };
    });
    assert.equal(measurements.animations, 0); assert.equal(measurements.overflow, false);
    for (const motion of measurements.motion) {
      assert(motion.animationName === 'none' || motion.animationDuration.split(',').every(value => parseFloat(value) <= 0.001), 'Panel animation must honor reduced motion');
      assert(motion.transitionDuration.split(',').every(value => parseFloat(value) <= 0.001), 'Chevron transition must honor reduced motion');
    }
    return measurements;
  }, tutor);
  await context.close();
}
try {
  const base = await start();
  const viewports = headerOnly ? [320, 640, 768].map(width => ({ width, height: 852 })) : [{ width: 393, height: 852 }, { width: 740, height: 390 }, { width: 1440, height: 900 }];
  for (const viewport of viewports) await runViewport(base, viewport);
} catch (error) { report.fatal = error.stack; }
finally {
  await browser?.close(); realtime?.close();
  await vite?.close();
  if (server?.listening) await new Promise(done => server.close(done));
  if (transport?.listening) await new Promise(done => transport.close(done));
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  const failed = report.cases.filter(item => !item.passed);
  console.log(JSON.stringify({ output: out, passed: report.cases.length - failed.length, total: report.cases.length, pageErrors: report.pageErrors, fatal: report.fatal, failures: failed.map(({ viewport, name, error }) => ({ viewport, name, error })) }, null, 2));
  if (failed.length || report.pageErrors.length || report.fatal) process.exitCode = 1;
}
