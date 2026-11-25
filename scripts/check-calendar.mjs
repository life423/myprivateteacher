import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { chromium } from '@playwright/test';
import { createSchedulingRepository } from '../server/scheduling.js';
import { schedulingRoutes } from '../server/schedulingRoutes.js';
import { memoryLessonCollection, memoryLessons } from '../server/lessonFixtures.js';
import { lessonRoutes } from '../server/lessonRoutes.js';

// Actual CalendarPage, isolated synthetic account/storage. Vite serves this
// focused fixture without rebuilding dist while other feature work is underway.
const root = fileURLToPath(new URL('../', import.meta.url));
const production = process.argv.includes('--production');
const output = resolve(process.argv.slice(2).find(argument => !argument.startsWith('--')) || join(root, '.calendar-check'));
mkdirSync(output, { recursive: true });
const report = { frontend: production ? 'production App and createApp routes' : 'actual CalendarPage in a Vite development fixture', syntheticAccount: true, cloudServices: false, cases: [], errors: [], limitations: ['Headless Chrome desktop, emulated tablet and phone; no physical device or screen reader.', 'Calendar services use isolated memory storage; no production database, OAuth, Stripe or real communications.', 'Start/invoice links are checked here; cross-feature workflows are validated separately.'] };
const collection = memoryLessonCollection(), { lessons } = memoryLessons();
const scheduling = createSchedulingRepository({ collection, lessons });
let app = express(); const owner = 'calendar-browser-owner';
const tutor = { id: owner, name: 'Fixture Teacher', email: 'teacher@example.test', access: { ok: true, kind: 'owner' }, roles: ['owner'] };
let origin, vite, server, browser;
const check = async (viewport, name, action) => {
  const result = { viewport, name }; report.cases.push(result);
  try { await action(); result.passed = true; }
  catch (error) { result.passed = false; result.error = error.stack; throw error; }
  finally { writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(result)); }
};
try {
  const prep = await lessons.create(owner, { id: 'calendar-browser-prep', title: 'Short a practice', activities: [] });
  if (production) {
    assert(existsSync(join(root, 'dist/index.html')), 'Build the production app first.');
    const { createApp } = await import('../server/index.js');
    app = createApp({ accounts: { clientId: null, tutorFor: async token => token === 'calendar-browser-cookie' ? tutor : null }, lessons, scheduling });
  } else {
    app.get('/api/me', (_req, res) => res.json({ tutor, signIn: { google: null }, lesson: { ok: true } }));
    const currentTutor = async () => tutor, sameSite = req => !req.get('origin') || req.get('origin') === origin;
    app.use('/api/schedule', schedulingRoutes({ scheduling, currentTutor, sameSite }));
    app.use('/api/lessons', lessonRoutes({ lessons, currentTutor, sameSite }));
    vite = await createViteServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
    app.get('/calendar', async (req, res) => res.type('html').send(await vite.transformIndexHtml(req.originalUrl, `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import CalendarPage from '/src/scheduling/CalendarPage.jsx';import '/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(CalendarPage));</script></body></html>`)));
    app.use(vite.middlewares);
  }
  server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'chrome' });
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'phone', width: 393, height: 852 }]) {
    collection.records.clear();
    const base = { studentName: 'Casey', localDate: '2026-11-24', localTime: '15:00', timeZone: 'America/Chicago', durationMinutes: 45, repeat: 'weekly', untilDate: null, lessonId: prep.id };
    await scheduling.create(owner, { ...base, id: `weekly-${viewport.name}` });
    await scheduling.create(owner, { ...base, id: `one-${viewport.name}`, studentName: 'Jordan', localDate: '2026-11-26', localTime: '09:30', repeat: 'none' });
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.name !== 'desktop', hasTouch: viewport.name !== 'desktop', timezoneId: 'America/Chicago' });
    await context.addCookies([{ name: 'mpt_session', value: 'calendar-browser-cookie', url: origin }]);
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => report.errors.push({ viewport: viewport.name, message: error.message }));
    await page.clock.install({ time: new Date('2026-11-24T18:00:00Z') });
    await check(viewport.name, 'week/agenda, navigation and touch targets', async () => {
      await page.goto(`${origin}/calendar`); await page.getByRole('button', { name: 'Lesson details: Casey, 3:00 PM', exact: true }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'Calendar', exact: true }).getAttribute('aria-current'), 'page');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(await page.locator('.cal-week').evaluate(element => getComputedStyle(element).display), viewport.name === 'desktop' ? 'grid' : 'flex');
      const undersized = await page.locator('.teacher-calendar button:visible, .teacher-calendar input:visible, .teacher-calendar select:visible').evaluateAll(elements => elements.filter(element => { const box = element.getBoundingClientRect(); return box.height < 43.5 || box.width < 43.5; }).map(element => element.outerHTML));
      assert.deepEqual(undersized, []);
      await page.screenshot({ path: join(output, `calendar-${viewport.name}.png`), fullPage: true });
    });
    await check(viewport.name, 'one-off lesson with saved preparation', async () => {
      await page.getByRole('button', { name: 'Schedule lesson', exact: true }).click();
      const dialog = page.getByRole('dialog'); await dialog.getByLabel('Student name', { exact: true }).fill('Morgan');
      await dialog.getByLabel('Date', { exact: true }).fill('2026-11-25'); await dialog.getByLabel('Start time', { exact: true }).fill('10:15');
      await dialog.getByLabel('Lesson preparation (optional)', { exact: true }).selectOption(prep.id);
      await page.screenshot({ path: join(output, `calendar-form-${viewport.name}.png`), fullPage: true });
      await dialog.getByRole('button', { name: 'Schedule lesson', exact: true }).click();
      await page.getByRole('button', { name: 'Lesson details: Morgan, 10:15 AM', exact: true }).waitFor();
      const created = (await scheduling.list(owner, { from: '2026-11-23', to: '2026-11-29', timeZone: 'America/Chicago' })).occurrences.find(item => item.studentName === 'Morgan');
      assert(created); assert.equal(created.repeat, 'none'); assert.equal(created.lessonId, prep.id);
    });
    await check(viewport.name, 'details, start and invoice links, keyboard focus return', async () => {
      const opener = page.getByRole('button', { name: 'Lesson details: Casey, 3:00 PM', exact: true }); await opener.click();
      const dialog = page.getByRole('dialog');
      const startLink = await dialog.getByRole('link', { name: 'Start lesson', exact: true }).getAttribute('href');
      const startUrl = new URL(startLink, origin); assert.equal(startUrl.pathname, '/whiteboard/teach');
      assert.equal(startUrl.searchParams.get('appointment'), `weekly-${viewport.name}~2026-11-24`); assert.equal(startUrl.searchParams.get('lesson'), 'calendar-browser-prep');
      assert.match(startUrl.searchParams.get('start'), /^[a-f0-9-]{36}$/);
      assert.equal(await dialog.getByRole('link', { name: 'Start lesson', exact: true }).getAttribute('href'), startLink);
      assert.equal(await dialog.getByRole('link', { name: 'Create invoice', exact: true }).getAttribute('href'), `/invoices/new?appointment=weekly-${viewport.name}~2026-11-24`);
      await page.screenshot({ path: join(output, `calendar-details-${viewport.name}.png`), fullPage: true });
      await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' }); assert(await opener.evaluate(element => element === document.activeElement));
    });
    await check(viewport.name, 'reschedule only one weekly lesson', async () => {
      await page.getByRole('button', { name: 'Lesson details: Casey, 3:00 PM', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Edit details', exact: true }).click();
      const dialog = page.getByRole('dialog'); assert(await dialog.getByRole('radio', { name: 'Only this lesson', exact: true }).isChecked());
      await dialog.getByLabel('Date', { exact: true }).fill('2026-11-27'); await dialog.getByLabel('Start time', { exact: true }).fill('16:00');
      await dialog.getByRole('button', { name: 'Save changes', exact: true }).click(); await page.getByRole('button', { name: 'Lesson details: Casey, 4:00 PM', exact: true }).waitFor();
      const thisOne = await scheduling.occurrence(owner, `weekly-${viewport.name}~2026-11-24`), nextOne = await scheduling.occurrence(owner, `weekly-${viewport.name}~2026-12-01`);
      assert.equal(thisOne.localDate, '2026-11-27'); assert.equal(nextOne.localTime, '15:00');
    });
    await check(viewport.name, 'edit entire series and navigate weeks', async () => {
      await page.getByRole('button', { name: 'Lesson details: Casey, 4:00 PM', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Edit details', exact: true }).click();
      const dialog = page.getByRole('dialog'); await dialog.getByRole('radio', { name: 'The whole series', exact: true }).check();
      await dialog.getByLabel('Student name', { exact: true }).fill('Casey updated'); await dialog.getByLabel('Start time', { exact: true }).fill('16:30');
      await dialog.getByRole('button', { name: 'Save changes', exact: true }).click(); await page.getByRole('button', { name: 'Lesson details: Casey updated, 4:00 PM', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Next week', exact: true }).click(); await page.getByRole('button', { name: 'Lesson details: Casey updated, 4:30 PM', exact: true }).waitFor();
    });
    await check(viewport.name, 'cancel one lesson then the series', async () => {
      await page.getByRole('button', { name: 'Lesson details: Casey updated, 4:30 PM', exact: true }).click();
      let dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Cancel lesson', exact: true }).click(); await dialog.getByRole('button', { name: 'Cancel lesson', exact: true }).click();
      await page.getByRole('heading', { name: 'No lessons this week', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Next week', exact: true }).click(); await page.getByRole('button', { name: 'Lesson details: Casey updated, 4:30 PM', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Lesson details: Casey updated, 4:30 PM', exact: true }).click(); dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Cancel lesson', exact: true }).click(); await dialog.getByRole('radio', { name: 'The whole series', exact: true }).check(); await dialog.getByRole('button', { name: 'Cancel lesson', exact: true }).click();
      await page.getByRole('heading', { name: 'No lessons this week', exact: true }).waitFor();
      assert.equal((await scheduling.get(owner, `weekly-${viewport.name}`)).cancelled, true);
    });
    await check(viewport.name, 'connection failure retains edits and can be retried', async () => {
      await page.getByRole('button', { name: 'Today', exact: true }).click(); await page.getByRole('button', { name: 'Lesson details: Jordan, 9:30 AM', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Schedule lesson', exact: true }).click(); const dialog = page.getByRole('dialog'); await dialog.getByLabel('Student name', { exact: true }).fill('Retry student');
      await page.route('**/api/schedule', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
      await dialog.getByRole('button', { name: 'Schedule lesson', exact: true }).click(); await dialog.getByRole('alert').waitFor();
      assert.equal(await dialog.getByLabel('Student name', { exact: true }).inputValue(), 'Retry student');
      await page.unroute('**/api/schedule'); await dialog.getByRole('button', { name: 'Schedule lesson', exact: true }).click(); await page.getByRole('button', { name: 'Lesson details: Retry student, 3:00 PM', exact: true }).waitFor();
    });
    await check(viewport.name, 'same-date occurrence edit follows its new display week across time zones', async () => {
      const id = `date-line-${viewport.name}`, reference = `${id}~2026-11-23`;
      await scheduling.create(owner, { ...base, id, studentName: 'Date-line fixture', localDate: '2026-11-23', localTime: '00:30', untilDate: '2026-12-07' });
      await page.reload();
      await page.locator('.cal-zone-settings > summary').click();
      await page.locator('#calendar-zone').fill('Pacific/Honolulu');
      await page.screenshot({ path: join(output, `calendar-time-zone-${viewport.name}.png`), fullPage: true });
      const zonePanel = await page.locator('.cal-zone-edit').boundingBox();
      assert(zonePanel && zonePanel.x >= 0 && zonePanel.x + zonePanel.width <= viewport.width, 'Time zone controls stay inside the viewport');
      await page.locator('#calendar-zone').press('Tab');
      const applyZone = page.getByRole('button', { name: 'Apply', exact: true });
      if (viewport.name === 'desktop') await applyZone.press('Enter');
      else await applyZone.tap();
      assert.equal(await page.locator('.cal-zone-settings').getAttribute('open'), null);
      assert(await page.locator('.cal-zone-settings > summary').evaluate(element => element === document.activeElement));
      await page.getByRole('button', { name: 'Previous week', exact: true }).click();
      await page.getByRole('button', { name: 'Lesson details: Date-line fixture, 8:30 PM', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Edit details', exact: true }).click();
      const dialog = page.getByRole('dialog');
      assert(await dialog.getByRole('radio', { name: 'Only this lesson', exact: true }).isChecked());
      assert.equal(await dialog.getByLabel('Date', { exact: true }).inputValue(), '2026-11-23');
      await dialog.getByLabel('Start time', { exact: true }).fill('04:30');
      await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
      const moved = page.getByRole('button', { name: 'Lesson details: Date-line fixture, 12:30 AM', exact: true });
      await moved.waitFor();
      assert.equal(await page.locator('[aria-labelledby="calendar-day-2026-11-23"]').getByRole('button', { name: 'Lesson details: Date-line fixture, 12:30 AM', exact: true }).count(), 1);
      const occurrence = await scheduling.occurrence(owner, reference, 'Pacific/Honolulu');
      assert.equal(occurrence.id, reference); assert.equal(occurrence.localTime, '04:30');
      assert.equal(occurrence.displayDate, '2026-11-23'); assert.equal(occurrence.displayTime, '00:30');
      assert.equal((await scheduling.occurrence(owner, `${id}~2026-11-30`)).localTime, '00:30');
      await page.screenshot({ path: join(output, `calendar-date-line-${viewport.name}.png`), fullPage: true });
    });
    await check(viewport.name, 'text enlargement and no horizontal overflow', async () => {
      await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(output, `calendar-enlarged-${viewport.name}.png`), fullPage: true });
    });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await browser?.close(); await vite?.close(); if (server) { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
}
