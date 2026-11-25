import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import { createApp } from '../server/index.js';
import { attachRealtime } from '../server/realtime.js';
import { memoryLessonCollection, memoryLessons } from '../server/lessonFixtures.js';
import { createSchedulingRepository } from '../server/scheduling.js';
import { createInvoiceRepository } from '../server/invoices.js';
import { scheduleLocalParts } from '../shared/scheduling.js';

const output = resolve(process.argv[2] || '.teacher-workflow-check');
mkdirSync(output, { recursive: true });
const report = { productionBuild: true, realSockets: true, isolatedStorage: true, realStripe: false, cases: [], errors: [] };
const owner = 'workflow-fixture-owner';
const tutor = { id: owner, name: 'Fixture Teacher', email: 'teacher@example.test', roles: ['owner'] };
const accounts = { clientId: null, tutorFor: async token => token === 'workflow-cookie' ? tutor : null };
const { lessons } = memoryLessons();
const scheduling = createSchedulingRepository({ collection: memoryLessonCollection(), lessons });
const invoices = createInvoiceRepository({ collection: memoryLessonCollection(), scheduling });
let realtime, browser;
const pictures = Object.fromEntries(['beginWrite', 'add', 'get', 'isTutor'].map(method => [method, (...args) => realtime.pictures[method](...args)]));
const app = createApp({ accounts, lessons, scheduling, invoices, pictures, library: { list: async () => [], image: async () => null } });
const server = http.createServer(app), origins = new Set();
realtime = attachRealtime(server, { allowedOrigins: origins, maxRoomsPerIp: 100, canStartLesson: async () => ({ ok: true }) });
const check = async (viewport, name, fn) => {
  const result = { viewport, name }; report.cases.push(result);
  try { await fn(); result.passed = true; }
  catch (error) { result.passed = false; result.error = error.stack; throw error; }
  finally { writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(result)); }
};
const roomOf = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('wb-tutor') || '{}'));
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`; origins.add(origin);
  browser = await chromium.launch({ channel: 'chrome' });
  const prep = await lessons.create(owner, { id: 'workflow-preparation', title: 'Fixture saved preparation', activities: [{ id: 'workflow-activity', type: 'review', title: 'Review known sounds', directions: 'PRIVATE_WORKFLOW_DIRECTIONS', targets: 'PRIVATE_WORKFLOW_TARGETS', letters: 'a m s t p', marks: ['breve'] }] });
  const today = scheduleLocalParts(new Date(), 'America/Chicago').date;
  await scheduling.create(owner, { id: 'workflow-scheduled', studentName: 'Fixture Casey', localDate: today, localTime: '15:00', timeZone: 'America/Chicago', durationMinutes: 45, repeat: 'none', lessonId: prep.id });
  const occurrenceId = `workflow-scheduled~${today}`;
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'phone', width: 393, height: 852 }]) {
    const context = await browser.newContext({ viewport, timezoneId: 'America/Chicago', hasTouch: viewport.name !== 'desktop', isMobile: viewport.name !== 'desktop' });
    await context.addCookies([{ name: 'mpt_session', value: 'workflow-cookie', url: origin }]);
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.errors.push({ viewport: viewport.name, message: error.message }));
    let previousRoom, scheduledRoom;
    await check(viewport.name, 'Calendar Start creates a different classroom and opens owned preparation', async () => {
      await page.goto(`${origin}/whiteboard/teach`);
      await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('wb-tutor') || '{}').code);
      previousRoom = await roomOf(page);
      await page.goto(`${origin}/calendar`);
      await page.getByRole('button', { name: 'Lesson details: Fixture Casey, 3:00 PM', exact: true }).click();
      await page.getByRole('dialog').getByRole('link', { name: 'Start lesson', exact: true }).click();
      await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('wb-tutor') || '{}').startToken);
      scheduledRoom = await roomOf(page);
      assert.notEqual(scheduledRoom.code, previousRoom.code);
      await page.getByText('Fixture saved preparation', { exact: true }).first().waitFor();
      assert.equal(new URL(page.url()).searchParams.get('lesson'), prep.id);
      await page.screenshot({ path: join(output, `scheduled-classroom-${viewport.name}.png`), fullPage: true });
    });
    await check(viewport.name, 'Reload reconnects to the scheduled room; student receives no private planning data', async () => {
      await page.reload();
      await page.getByText('Fixture saved preparation', { exact: true }).first().waitFor();
      assert.deepEqual(await roomOf(page), scheduledRoom);
      const studentContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
      const student = await studentContext.newPage();
      await student.addInitScript(() => {
        window.workflowMessages = [];
        const Native = window.WebSocket;
        window.WebSocket = class extends Native { constructor(...args) { super(...args); this.addEventListener('message', event => { try { window.workflowMessages.push(JSON.parse(event.data)); } catch {} }); } };
      });
      await student.goto(`${origin}/whiteboard/${scheduledRoom.code}`);
      await student.locator('svg[role="img"]').waitFor();
      const received = await student.evaluate(() => JSON.stringify({ messages: window.workflowMessages, text: document.body.textContent, storage: { ...sessionStorage } }));
      for (const secret of ['PRIVATE_WORKFLOW_DIRECTIONS', 'PRIVATE_WORKFLOW_TARGETS', 'Fixture Casey', occurrenceId, 'teacher@example.test']) assert(!received.includes(secret), `Student must not receive ${secret}`);
      await studentContext.close();
    });
    await check(viewport.name, 'Scheduled invoice prefill and shared teacher navigation', async () => {
      await page.goto(`${origin}/invoices/new?appointment=${encodeURIComponent(occurrenceId)}`);
      await page.getByRole('heading', { name: 'New invoice', exact: true }).waitFor();
      await page.getByLabel('Bill to', { exact: true }).waitFor();
      const draft = await invoices.fromAppointment(owner, occurrenceId);
      assert.equal(draft.appointment.studentName, 'Fixture Casey');
      assert.equal(await page.getByLabel('Bill to', { exact: true }).inputValue(), 'Fixture Casey');
      assert.equal(await page.getByRole('navigation', { name: 'Teacher workspace' }).getByRole('link', { name: 'Invoices', exact: true }).getAttribute('aria-current'), 'page');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(output, `scheduled-invoice-${viewport.name}.png`), fullPage: true });
    });
    await check(viewport.name, 'Changed or unauthorized appointment cannot start a classroom', async () => {
      await page.goto(`${origin}/whiteboard/teach?appointment=missing~${today}&start=another-start-token-${viewport.name}`);
      await page.getByRole('heading', { name: 'This scheduled lesson could not be opened', exact: true }).waitFor();
      assert.deepEqual(await roomOf(page), scheduledRoom);
    });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  realtime.close();
  for (const room of realtime.rooms.values()) clearTimeout(room.closeTimer);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
