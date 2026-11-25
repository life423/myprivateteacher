import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { chromium } from '@playwright/test';

// Actual AdminPage and InvoiceDisputes with isolated read-only API responses.
// No Stripe connection, real account or payment operation is used by this check.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2] || join(root, '.admin-invoice-payments-check')); mkdirSync(output, { recursive: true });
const report = { frontend: 'actual AdminPage in isolated Vite fixture', cloudServices: false, stripeOperations: false, cases: [], pageErrors: [], limitations: ['Headless Chrome with emulated touch viewports; no physical device or screen reader.', 'Synthetic owner and dispute data; real Stripe, webhook and account authorization are validated separately.'] };
const entries = [
  { id: 'dp_fixture_usd', ownerId: 'teacher-one', ownerName: 'Alex Morgan', ownerEmail: 'alex@example.test', amountCents: 12500, currency: 'usd', status: 'needs_response', dueBy: 1796083200, dashboardUrl: 'https://dashboard.stripe.com/test/payments/ch_fixture_usd' },
  { id: 'dp_fixture_gbp', ownerId: 'teacher-two', ownerName: 'Maya Grant', ownerEmail: 'maya@example.test', amountCents: 7500, currency: 'gbp', status: 'under_review', dueBy: null, dashboardUrl: 'https://dashboard.stripe.com/test/payments/ch_fixture_gbp' },
];
let mode = 'test', requests = [], browser, server, vite;
const app = express();
app.get('/api/me', (_req, res) => res.json({ tutor: { id: 'fixture-owner', name: 'Owner', owner: true, roles: ['owner'], access: { ok: true, kind: 'owner' } }, signIn: { google: null } }));
app.get('/api/admin/tutors', (_req, res) => res.json({ tutors: [], grants: [] }));
app.get('/api/admin/overview', (_req, res) => res.json({ tutors: 1, trials: 0, paying: 0, monthly: 0, pastDue: 0, free: 1, lessonsNow: 0 }));
app.use('/api/admin/invoice-payments/disputes', (req, res) => {
  requests.push(req.method);
  if (mode === 'error') return res.status(503).json({ error: 'Lesson payments are temporarily unavailable. Please try again.' });
  res.json({ configured: mode !== 'unconfigured', livemode: mode === 'live', disputes: ['empty', 'unconfigured'].includes(mode) ? [] : entries });
});
const check = async (viewport, name, action) => {
  const result = { viewport, name }; report.cases.push(result);
  try { await action(); result.passed = true; } catch (error) { result.passed = false; result.error = error.stack; throw error; }
  finally { writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(result)); }
};
try {
  vite = await createViteServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  app.get('/admin', async (req, res) => res.type('html').send(await vite.transformIndexHtml(req.originalUrl, `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import AdminPage from '/src/admin/AdminPage.jsx';import '/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(AdminPage));</script></body></html>`)));
  app.use(vite.middlewares); server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`; browser = await chromium.launch({ channel: 'chrome' });
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'phone', width: 393, height: 852 }]) {
    mode = 'test'; requests = [];
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.name !== 'desktop', hasTouch: viewport.name !== 'desktop', timezoneId: 'America/Chicago', reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => report.pageErrors.push({ viewport: viewport.name, message: error.message }));
    const panel = page.getByRole('region', { name: 'Lesson payments', exact: true });
    await check(viewport.name, 'owner tab, currency-separated disputes and review links', async () => {
      await page.goto(`${origin}/admin`); await page.getByRole('button', { name: 'Lesson payments', exact: true }).click();
      await panel.getByText('Test mode', { exact: true }).waitFor();
      assert(await panel.getByRole('heading', { name: 'USD 125.00', exact: true }).isVisible()); assert(await panel.getByRole('heading', { name: 'GBP 75.00', exact: true }).isVisible());
      assert.equal(await panel.getByRole('link', { name: 'Review dispute dp_fixture_usd in Stripe (opens a new tab)', exact: true }).getAttribute('href'), 'https://dashboard.stripe.com/test/payments/ch_fixture_usd');
      assert(await panel.getByText('Needs response', { exact: true }).isVisible()); assert(await panel.getByText('Alex Morgan', { exact: true }).isVisible());
      assert.equal(await panel.locator('time').count(), 1); assert(await panel.getByText('No evidence deadline', { exact: true }).isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const targets = await page.locator('nav[aria-label="Admin sections"] button, section[aria-labelledby="lesson-payments-heading"] :is(button,a)').evaluateAll(elements => elements.map(element => ({ name: element.textContent.trim(), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })).filter(box => box.width < 43.5 || box.height < 43.5)); assert.deepEqual(targets, []);
      await page.screenshot({ path: join(output, `invoice-disputes-${viewport.name}.png`), fullPage: true });
    });
    await check(viewport.name, 'live mode and unconfigured setup state', async () => {
      mode = 'live'; await panel.getByRole('button', { name: 'Refresh', exact: true }).click(); await panel.getByText('Live mode', { exact: true }).waitFor();
      mode = 'unconfigured'; await panel.getByRole('button', { name: 'Refresh', exact: true }).click(); await panel.getByRole('heading', { name: 'Finish Stripe setup', exact: true }).waitFor();
      assert.equal(await panel.getByRole('link').count(), 0); assert(!/\$0|USD\s*0/.test(await panel.innerText()));
      await page.screenshot({ path: join(output, `invoice-disputes-setup-${viewport.name}.png`), fullPage: true });
    });
    await check(viewport.name, 'empty, failure and retry states perform only reads', async () => {
      mode = 'empty'; await panel.getByRole('button', { name: 'Refresh', exact: true }).click(); await panel.getByText('No payment disputes to review.', { exact: true }).waitFor();
      mode = 'error'; await panel.getByRole('button', { name: 'Refresh', exact: true }).click(); await panel.getByRole('alert').waitFor();
      mode = 'test'; await panel.getByRole('button', { name: 'Refresh', exact: true }).click(); await panel.getByRole('heading', { name: 'USD 125.00', exact: true }).waitFor();
      assert.equal(await panel.getByRole('alert').count(), 0); assert(requests.length >= 6); assert(requests.every(method => method === 'GET'));
      await panel.getByRole('link').first().focus(); assert(await panel.getByRole('link').first().evaluate(element => element === document.activeElement));
    });
    await check(viewport.name, '200 percent text size retains layout', async () => {
      await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(output, `invoice-disputes-enlarged-${viewport.name}.png`), fullPage: true });
    });
    await context.close();
  }
  assert.deepEqual(report.pageErrors, []);
} finally {
  await browser?.close(); await vite?.close(); if (server) { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
}
