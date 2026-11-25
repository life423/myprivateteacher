import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { chromium } from '@playwright/test';
import { createInvoiceRepository } from '../server/invoices.js';
import { invoiceRoutes } from '../server/invoiceRoutes.js';
import { memoryLessonCollection } from '../server/lessonFixtures.js';
import { createApp } from '../server/index.js';
import { SESSION_COOKIE } from '../server/accounts.js';

// Actual invoice pages/router, synthetic accounts and isolated in-memory payment
// adapter. No real recipients, credentials, invoices, charges or communications.
const root = fileURLToPath(new URL('../', import.meta.url));
const production = process.argv.includes('--production');
const output = resolve(process.argv.slice(2).find(value => value !== '--production') || join(root, '.invoice-check'));
mkdirSync(output, { recursive: true });
const report = { frontend: production ? 'production build with integrated createApp' : 'actual app/router in a Vite fixture', syntheticAccount: true, cloudServices: false, cases: [], errors: [], limitations: ['Chrome with emulated phone/tablet, not a physical device or screen reader.', 'Invoices/payment provider use isolated memory fixtures; no live Stripe, OAuth, cloud database, bank payout or email.', 'Print is checked with print media and a desktop PDF; browser Save PDF UI is not automated.'] };
const buildFingerprint = () => {
  const html = readFileSync(join(root, 'dist/index.html'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  return { indexSha256: hash(html), scripts: [...html.toString().matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => ({ url: match[1], sha256: hash(readFileSync(join(root, 'dist', match[1].replace(/^\//, '')))) })) };
};
if (production) report.build = buildFingerprint();
const owner = 'invoice-browser-owner', other = 'invoice-browser-other', collection = memoryLessonCollection(), records = new Map();
let ready = true, origin, vite, server, browser, activePage;
const tutorFor = actor => ({ id: actor, name: 'Fixture Teacher', email: 'teacher@example.test', roles: ['owner'], access: { ok: true, kind: 'owner' } });
let app = express();
const payments = {
  livemode: false,
  async settings() { return { available: true, ready, livemode: false, feePercent: 5, offlinePaymentsSupported: 'full-only', reverseOfflineSupported: false, supportedCurrencies: ['USD'], minimumOnlineCents: 50, reason: ready ? null : 'Connect your U.S. payment account to receive payments.' }; },
  async connect() { return { url: 'https://connect.stripe.com/setup/example' }; },
  async issue({ invoice }) { const previous = records.get(invoice.id); if (previous) return structuredClone(previous); const record = { accountId: 'acct_fixture', stripeInvoiceId: `in_${invoice.id}`, hostedInvoiceUrl: `https://invoice.stripe.com/i/fixture-${invoice.id}`, amountPaidCents: 0, currency: invoice.currency, status: 'open', refundableCents: 0, refundedCents: 0, disputed: false }; records.set(invoice.id, record); return structuredClone(record); },
  async sync({ invoice }) { return structuredClone(records.get(invoice.id)); },
  async void({ invoice }) { const record = records.get(invoice.id); record.status = 'void'; return structuredClone(record); },
  async recordOffline({ invoice, payment }) { const record = records.get(invoice.id); record.amountPaidCents = payment.amountCents; record.status = 'paid'; record.refundableCents = 0; return structuredClone(record); },
  async refund({ invoice, amountCents }) { const record = records.get(invoice.id); record.pendingRefundCents = (record.pendingRefundCents || 0) + amountCents; record.refundableCents -= amountCents; return structuredClone(record); },
};
const scheduling = { async occurrence(actor, id) { if (actor !== owner || id !== 'series~2026-11-24') throw Object.assign(new Error('No such lesson.'), { status: 404 }); return { id, studentName: 'Scheduled Student', displayDate: '2026-11-24', durationMinutes: 45 }; } };
const invoices = createInvoiceRepository({ collection, payments, scheduling, now: () => new Date('2026-11-24T18:00:00Z') });
const currentTutor = async req => ['invoice-browser-owner', 'invoice-browser-other'].includes(req.get('x-fixture-owner')) ? tutorFor(req.get('x-fixture-owner')) : null;
const check = async (viewport, name, action) => {
  const result = { viewport, name }; report.cases.push(result);
  try { await action(); result.passed = true; }
  catch (error) { result.passed = false; result.error = error.stack; await activePage?.screenshot({ path: join(output, `failure-${viewport}.png`), fullPage: true }).catch(() => {}); throw error; }
  finally { writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(result)); }
};
async function fillInvoice(page, recipient, price, online = false) {
  await page.getByLabel('Bill to', { exact: true }).fill(recipient);
  await page.getByText('Contact details and student', { exact: false }).click();
  await page.getByLabel('Recipient email (optional)', { exact: true }).fill('parent@example.test');
  await page.getByText('Contact details and student', { exact: false }).click();
  await page.getByLabel('Price (USD)', { exact: true }).fill(price);
  await page.getByLabel('Allow online payment', { exact: true }).setChecked(online);
}
async function issue(page) {
  await page.getByRole('button', { name: 'Issue invoice', exact: true }).click();
  await page.getByRole('heading', { name: 'Issue this invoice?', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Issue invoice', exact: true }).last().click();
  await page.getByRole('article', { name: 'Invoice preview', exact: true }).waitFor();
  await page.waitForURL(/\/invoices\/(?!new)[^/?]+$/);
}
try {
  if (production) {
    app = createApp({ accounts: { clientId: null, tutorFor: async token => [owner, other].includes(token) ? tutorFor(token) : null }, invoices });
  } else {
  app.get('/api/me', async (req, res) => res.json({ tutor: await currentTutor(req), signIn: { google: null }, lesson: { ok: true } }));
  app.use('/api/invoices', invoiceRoutes({ invoices, currentTutor, sameSite: req => !req.get('origin') || req.get('origin') === origin }));
  vite = await createViteServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  app.get(/^\/invoices(?:\/[^/]+)?$/, async (req, res) => res.type('html').send(await vite.transformIndexHtml(req.originalUrl, `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import App from '/src/App.jsx';import '/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(App));</script></body></html>`)));
  app.use(vite.middlewares);
  }
  server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'chrome' });
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'phone', width: 393, height: 852 }]) {
    collection.records.clear(); records.clear(); ready = true;
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.name === 'phone', hasTouch: viewport.name !== 'desktop', timezoneId: 'America/Chicago', extraHTTPHeaders: { 'x-fixture-owner': owner }, permissions: ['clipboard-read', 'clipboard-write'] });
    await context.addCookies([{ name: SESSION_COOKIE, value: owner, url: origin }]);
    const page = await context.newPage(); activePage = page; page.setDefaultTimeout(15000); page.on('pageerror', error => report.errors.push({ viewport: viewport.name, message: error.message }));
    await page.clock.install({ time: new Date('2026-11-24T18:00:00Z') });
    await check(viewport.name, 'workspace navigation and clean empty state', async () => {
      await page.goto(`${origin}/invoices`); await page.getByRole('heading', { name: 'Your first invoice starts here', exact: true }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'Invoices', exact: true }).getAttribute('aria-current'), 'page');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(output, `invoices-empty-${viewport.name}.png`), fullPage: true });
    });
    await check(viewport.name, 'payment setup distinguishes connecting, continuing and paused collection', async () => {
      const state = { available: true, ready: false, connected: false, onboardingComplete: false, livemode: true, supportedCurrencies: ['USD'], reason: 'Connect your payment account to finish setup.' };
      const requests = [];
      const failSetup = async route => { requests.push(route.request().url()); await route.fulfill({ status: 503, json: { error: 'Payment setup is temporarily unavailable. Please try again.' } }); };
      await page.route('**/api/invoices/payment-settings', route => route.fulfill({ json: { settings: state } }));
      await page.route('**/api/invoices/connect', failSetup);
      await page.route('**/api/invoice-payments/dashboard', failSetup);
      try {
        await page.reload();
        await page.getByRole('button', { name: 'Connect payments', exact: true }).click();
        await page.getByRole('alert').waitFor(); assert(requests.at(-1).endsWith('/api/invoices/connect'));

        state.connected = true; state.reason = 'Continue setup to finish connecting your payment account.';
        await page.reload(); await page.getByRole('heading', { name: 'Finish payment setup', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Continue setup', exact: true }).click();
        await page.getByRole('alert').waitFor(); assert(requests.at(-1).endsWith('/api/invoices/connect'));

        state.onboardingComplete = true; state.reason = 'Your payment account is connected. Online invoice payments are not active yet.';
        await page.reload(); await page.getByRole('heading', { name: 'Payment account connected', exact: true }).waitFor();
        const manage = page.getByRole('button', { name: 'Manage payment account', exact: true });
        assert.equal(await page.getByRole('button', { name: 'Connect payments', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Continue setup', exact: true }).count(), 0);
        const target = await manage.boundingBox(); assert(target.width >= 44 && target.height >= 44);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: join(output, `invoices-payment-paused-${viewport.name}.png`), fullPage: true });
        await manage.press('Enter'); await page.getByRole('alert').waitFor();
        assert(requests.at(-1).endsWith('/api/invoice-payments/dashboard'));

        await page.goto(`${origin}/invoices/new`); await page.getByLabel('Bill to', { exact: true }).waitFor();
        assert.equal(await page.getByLabel('Allow online payment', { exact: true }).isDisabled(), true);
        assert(await page.getByText(state.reason, { exact: false }).isVisible());
        state.reason = 'Your payment account needs a fee review before new payments can be accepted.';
        await page.reload(); await page.getByText(state.reason, { exact: false }).waitFor();
        assert.equal(await page.getByLabel('Allow online payment', { exact: true }).isDisabled(), true);
      } finally {
        await page.unroute('**/api/invoices/payment-settings'); await page.unroute('**/api/invoices/connect');
        await page.unroute('**/api/invoice-payments/dashboard');
        await page.goto(`${origin}/invoices`); await page.getByRole('button', { name: 'Manage payment account', exact: true }).waitFor();
      }
    });
    await check(viewport.name, 'an untouched new invoice leaves without a discard prompt', async () => {
      const dialogs = [], handler = async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); };
      page.on('dialog', handler);
      try {
        await page.getByRole('link', { name: 'New invoice', exact: true }).click(); await page.getByLabel('Bill to', { exact: true }).waitFor();
        await page.getByText('Stripe test mode · Online payments are simulated.', { exact: true }).waitFor();
        await page.getByRole('link', { name: 'Invoices', exact: true }).last().click(); await page.waitForURL(/\/invoices$/);
        assert.deepEqual(dialogs, []);
      } finally { page.off('dialog', handler); }
    });
    let offlineId;
    await check(viewport.name, 'draft save/reopen, exact cents and responsive fee form', async () => {
      await page.getByRole('link', { name: 'New invoice', exact: true }).click(); await page.getByLabel('Bill to', { exact: true }).waitFor();
      await fillInvoice(page, 'Parent Example', '35.75'); await page.getByLabel('Quantity', { exact: true }).fill('2');
      assert(await page.getByText('Total $71.50', { exact: false }).isVisible());
      await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await page.waitForURL(/\/invoices\/(?!new)[^/?]+$/); offlineId = page.url().split('/').pop();
      await page.reload(); await page.getByLabel('Bill to', { exact: true }).waitFor(); assert.equal(await page.getByLabel('Bill to', { exact: true }).inputValue(), 'Parent Example'); assert.equal(await page.getByLabel('Price (USD)', { exact: true }).inputValue(), '35.75');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(output, `invoice-draft-${viewport.name}.png`), fullPage: true });
    });
    await check(viewport.name, 'explicit issuing, partial offline payment and correction', async () => {
      await issue(page); assert.equal((await invoices.get(owner, offlineId)).state, 'issued');
      assert.equal(await page.getByLabel('Bill to', { exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Record offline payment', exact: true }).click(); await page.getByLabel('Amount (USD)', { exact: true }).fill('20');
      await page.getByRole('button', { name: 'Record payment', exact: true }).click(); await page.getByText('Payment recorded.', { exact: true }).waitFor();
      assert.equal((await invoices.get(owner, offlineId)).balanceCents, 5150);
      await page.getByRole('button', { name: 'Correct payment', exact: true }).click(); await page.getByRole('button', { name: 'Reverse record', exact: true }).click(); await page.getByText('Payment record corrected.', { exact: true }).waitFor();
      assert.equal((await invoices.get(owner, offlineId)).balanceCents, 7150);
      await page.getByRole('button', { name: 'Record offline payment', exact: true }).click(); await page.getByRole('button', { name: 'Record payment', exact: true }).click(); await page.getByText('Payment recorded.', { exact: true }).waitFor();
      assert.equal((await invoices.get(owner, offlineId)).status, 'paid');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(output, `invoice-paid-${viewport.name}.png`), fullPage: true });
    });
    await check(viewport.name, 'print view isolates the invoice and exports a PDF', async () => {
      await page.emulateMedia({ media: 'print' });
      assert.equal(await page.getByRole('navigation', { name: 'Teacher workspace' }).isVisible(), false);
      assert(await page.getByRole('article', { name: 'Invoice preview' }).isVisible());
      await page.screenshot({ path: join(output, `invoice-print-${viewport.name}.png`), fullPage: true });
      if (viewport.name === 'desktop') await page.pdf({ path: join(output, 'invoice-fixture.pdf'), printBackground: true });
      await page.emulateMedia({ media: 'screen' });
    });
    let onlineId;
    await check(viewport.name, 'online payment link, authoritative payment refresh and full refund', async () => {
      await page.goto(`${origin}/invoices/new`); await page.getByLabel('Bill to', { exact: true }).waitFor(); await fillInvoice(page, 'Online Parent', '50', true);
      assert(await page.getByText(/A 5% platform fee applies/).isVisible());
      await issue(page); await page.waitForURL(/\/invoices\/(?!new)[^/?]+$/); onlineId = page.url().split('/').pop();
      await page.getByRole('button', { name: 'Copy payment link', exact: true }).click(); await page.getByText('Payment link copied.', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), records.get(onlineId).hostedInvoiceUrl);
      const record = records.get(onlineId); record.amountPaidCents = 5000; record.refundableCents = 5000; record.status = 'paid';
      await page.getByRole('button', { name: 'Refresh payment status', exact: true }).click(); await page.getByText('Payment status refreshed.', { exact: true }).waitFor();
      assert.equal((await invoices.get(owner, onlineId)).status, 'paid');
      await page.getByRole('button', { name: 'Refund online payment', exact: true }).click(); await page.getByRole('button', { name: 'Refund payment', exact: true }).click(); await page.getByText('Refund requested. Status updates after Stripe confirms it.', { exact: true }).waitFor();
      assert.equal((await invoices.get(owner, onlineId)).status, 'refund-pending');
      assert.equal(await page.getByRole('button', { name: 'Refund online payment', exact: true }).count(), 0);
      record.pendingRefundCents = 0; record.refundedCents = 5000;
      await page.getByRole('button', { name: 'Refresh payment status', exact: true }).click(); await page.getByText('Payment status refreshed.', { exact: true }).waitFor();
      assert.equal((await invoices.get(owner, onlineId)).status, 'refunded'); assert.equal((await invoices.get(owner, onlineId)).balanceCents, 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(output, `invoice-refunded-${viewport.name}.png`), fullPage: true });
      await page.emulateMedia({ media: 'print' });
      assert(await page.getByRole('article', { name: 'Invoice preview', exact: true }).getByText('Stripe test mode · Online payments are simulated.', { exact: true }).isVisible());
      await page.screenshot({ path: join(output, `invoice-online-print-${viewport.name}.png`), fullPage: true });
      await page.emulateMedia({ media: 'screen' });
    });
    await check(viewport.name, 'online invoices record full offline balance with clear limits', async () => {
      await page.goto(`${origin}/invoices/new`); await page.getByLabel('Bill to', { exact: true }).waitFor(); await fillInvoice(page, 'Cash Parent', '100', true); await issue(page);
      await page.getByRole('button', { name: 'Record offline payment', exact: true }).click();
      assert.equal(await page.getByLabel('Amount (USD)', { exact: true }).getAttribute('readonly'), ''); assert.equal(await page.getByLabel('Amount (USD)', { exact: true }).inputValue(), '100.00');
      await page.getByRole('button', { name: 'Record payment', exact: true }).click(); await page.getByText('Payment recorded.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Correct payment', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Refund online payment', exact: true }).count(), 0);
    });
    await check(viewport.name, 'lost response after payment commit recovers and allows the next payment', async () => {
      await page.goto(`${origin}/invoices/new`); await page.getByLabel('Bill to', { exact: true }).waitFor(); await fillInvoice(page, 'Response Loss Parent', '40'); await issue(page);
      const id = page.url().split('/').pop(), endpoint = `**/api/invoices/${id}/payments`;
      await page.getByRole('button', { name: 'Record offline payment', exact: true }).click(); await page.getByLabel('Amount (USD)', { exact: true }).fill('10');
      await page.route(endpoint, async route => { await route.fetch(); await route.abort('failed'); });
      await page.getByRole('button', { name: 'Record payment', exact: true }).click(); await page.getByText('Payment recorded.', { exact: true }).waitFor();
      assert.equal((await invoices.get(owner, id)).paidCents, 1000); assert.equal(await page.getByRole('button', { name: 'Record payment', exact: true }).count(), 0);
      await page.unroute(endpoint);
      await page.getByRole('button', { name: 'Record offline payment', exact: true }).click(); await page.getByLabel('Amount (USD)', { exact: true }).fill('15'); await page.getByRole('button', { name: 'Record payment', exact: true }).click(); await page.getByText('Payment recorded.', { exact: true }).waitFor();
      const current = await invoices.get(owner, id); assert.equal(current.paidCents, 2500); assert.equal(new Set(current.payments.map(item => item.id)).size, 2);
      const opener = page.getByRole('button', { name: 'Correct payment', exact: true }).first(); await opener.focus(); await opener.press('Enter');
      const confirmation = page.getByRole('region', { name: 'Confirm invoice action', exact: true }); await confirmation.waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Confirm invoice action');
      const bounds = await confirmation.boundingBox(); assert(bounds.y >= 0 && bounds.y < viewport.height);
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).press('Enter'); assert(await opener.evaluate(node => node === document.activeElement));
    });
    await check(viewport.name, 'provider credits settle the balance without claiming cash received', async () => {
      await page.goto(`${origin}/invoices/new`); await page.getByLabel('Bill to', { exact: true }).waitFor(); await fillInvoice(page, 'Credit Parent', '60', true); await issue(page);
      const id = page.url().split('/').pop(), record = records.get(id); record.amountRemainingCents = 0; record.creditCents = 6000; record.status = 'paid';
      await page.getByRole('button', { name: 'Refresh payment status', exact: true }).click(); await page.getByText('Payment status refreshed.', { exact: true }).waitFor();
      const paper = page.getByRole('article', { name: 'Invoice preview', exact: true }); await paper.getByText('Settled', { exact: true }).waitFor();
      assert(await paper.getByText('Credit applied', { exact: true }).isVisible()); assert.equal((await invoices.get(owner, id)).paidCents, 0); assert.equal((await invoices.get(owner, id)).balanceCents, 0);
      assert.equal(await page.getByRole('button', { name: 'Record offline payment', exact: true }).count(), 0);
    });
    await check(viewport.name, 'appointment prefill and existing-invoice reuse', async () => {
      await page.goto(`${origin}/invoices/new?appointment=series~2026-11-24`); await page.getByLabel('Bill to', { exact: true }).waitFor();
      await page.getByText('Contact details and student', { exact: false }).click();
      assert.equal(await page.getByLabel('Student (optional)', { exact: true }).inputValue(), 'Scheduled Student');
      await page.getByLabel('Price (USD)', { exact: true }).fill('45'); await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await page.waitForURL(/\/invoices\/(?!new)[^/?]+$/);
      const id = page.url().split('/').pop(); await page.goto(`${origin}/invoices/new?appointment=series~2026-11-24`); await page.waitForURL(new RegExp(`/invoices/${id}$`));
      assert.equal((await invoices.list(owner)).filter(item => item.schedulingOccurrenceId === 'series~2026-11-24').length, 1);
    });
    await check(viewport.name, 'network failure keeps edits, currency eligibility and keyboard targets', async () => {
      await page.goto(`${origin}/invoices/new`); await page.getByLabel('Bill to', { exact: true }).waitFor(); await fillInvoice(page, 'Retry Parent', '25');
      await page.route('**/api/invoices', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
      await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await page.getByRole('alert').waitFor(); assert.equal(await page.getByLabel('Bill to', { exact: true }).inputValue(), 'Retry Parent');
      await page.unroute('**/api/invoices'); await page.getByLabel('Currency', { exact: true }).selectOption('CAD'); assert.equal(await page.getByLabel('Allow online payment').isChecked(), false); assert.equal(await page.getByLabel('Allow online payment').isDisabled(), true);
      await page.getByLabel('Currency', { exact: true }).selectOption('USD');
      const targets = await page.locator('button:visible, select:visible, input:visible:not([type="checkbox"]), textarea:visible').evaluateAll(nodes => nodes.filter(node => { const r = node.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; }).map(node => node.outerHTML)); assert.deepEqual(targets, []);
      await page.getByRole('button', { name: 'Save draft', exact: true }).focus(); assert(await page.getByRole('button', { name: 'Save draft', exact: true }).evaluate(node => node === document.activeElement));
      await page.getByRole('button', { name: 'Save draft', exact: true }).press('Enter'); await page.waitForURL(/\/invoices\/(?!new)[^/?]+$/);
      await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(output, `invoice-enlarged-${viewport.name}.png`), fullPage: true });
    });
    await check(viewport.name, 'private owner boundary and same-site mutation guard', async () => {
      const response = await context.request.get(`${origin}/api/invoices/${offlineId}`, { headers: { 'x-fixture-owner': other, cookie: `${SESSION_COOKIE}=${other}` } }); assert.equal(response.status(), 404);
      const mutation = await context.request.post(`${origin}/api/invoices/${offlineId}/void`, { headers: { origin: 'https://outside.example.test' }, data: { revision: 1 } }); assert.equal(mutation.status(), 403);
      assert.equal((await invoices.get(owner, offlineId)).status, 'paid');
    });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  if (production) assert.deepEqual(buildFingerprint(), report.build);
} finally {
  await browser?.close(); await vite?.close(); if (server) { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
}
