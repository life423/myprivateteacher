import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createInvoiceRepository } from './invoices.js';
import { invoiceRoutes } from './invoiceRoutes.js';
import { memoryLessonCollection } from './lessonFixtures.js';
import { createSchedulingRepository } from './scheduling.js';

let server, base, invoices;
const draft = () => ({ id: 'invoice-api', senderName: 'Teacher', recipientName: 'Parent', currency: 'USD', issueDate: '2026-11-24', dueDate: '2026-12-01', lines: [{ description: 'Tutoring', quantity: 1, unitCents: 5000 }] });
const request = async (path = '', { owner = 'owner-a', origin, method = 'GET', body } = {}) => {
  const response = await fetch(`${base}/api/invoices${path}`, { method, headers: { ...(owner ? { 'x-test-owner': owner } : {}), ...(origin ? { origin } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json().catch(() => null), cache: response.headers.get('cache-control') };
};
beforeEach(async () => {
  const scheduling = createSchedulingRepository({ collection: memoryLessonCollection() });
  await scheduling.create('owner-a', { id: 'series', studentName: 'Fixture Student', localDate: '2026-11-24', localTime: '15:00', timeZone: 'America/Chicago', durationMinutes: 45, repeat: 'none', lessonId: null });
  invoices = createInvoiceRepository({ collection: memoryLessonCollection(), scheduling, now: () => new Date('2026-11-24T18:00:00Z') });
  const app = express();
  app.use('/api/invoices', invoiceRoutes({ invoices, currentTutor: async req => req.get('x-test-owner') ? { id: req.get('x-test-owner') } : null, sameSite: req => !req.get('origin') || req.get('origin') === base }));
  server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); });

describe('teacher invoice HTTP boundary', () => {
  it('requires a signed-in owner before serving records or payment setup', async () => {
    for (const path of ['', '/payment-settings', '/invoice-api']) expect((await request(path, { owner: null })).status).toBe(401);
  });
  it('blocks cross-site changes and keeps invoice responses out of caches', async () => {
    expect((await request('', { origin: 'https://unrelated.example', method: 'POST', body: draft() })).status).toBe(403);
    const response = await request('', { method: 'POST', body: draft() });
    expect(response.status).toBe(201); expect(response.cache).toBe('no-store');
  });
  it('ignores forged ownership and financial state in an editable draft', async () => {
    const response = await request('', { method: 'POST', body: { ...draft(), ownerId: 'owner-b', state: 'paid', payments: [{ amountCents: 5000 }], totalCents: 1, providerPaidCents: 5000 } });
    expect(response.data.invoice).toMatchObject({ totalCents: 5000, state: 'draft', paidCents: 0 });
    expect((await request('/invoice-api', { owner: 'owner-b' })).status).toBe(404);
    expect((await request('/invoice-api', { method: 'PUT', owner: 'owner-b', body: { ...draft(), revision: 1 } })).status).toBe(404);
    expect((await request('/invoice-api/payments', { owner: 'owner-b', method: 'POST', body: { id: 'p', amountCents: 5000, date: '2026-11-24', method: 'cash', revision: 1 } })).status).toBe(404);
  });
  it('does not expose provider settlement writes through a client route', async () => {
    await request('', { method: 'POST', body: draft() });
    expect((await request('/invoice-api/provider-snapshot', { method: 'POST', body: { amountPaidCents: 5000 } })).status).toBe(404);
    expect((await request('/invoice-api')).data.invoice.paidCents).toBe(0);
  });
  it('rejects alias schedule references instead of creating a second invoice for the same occurrence', async () => {
    const reference = 'series~2026-11-24';
    expect((await request('', { method: 'POST', body: { ...draft(), schedulingOccurrenceId: reference } })).status).toBe(201);
    for (const alias of [`${reference}~`, `${reference}~~alias`]) {
      expect((await request(`/from-appointment/${encodeURIComponent(alias)}`)).status).toBe(404);
      expect((await request('', { method: 'POST', body: { ...draft(), id: 'duplicate', schedulingOccurrenceId: alias } })).status).toBe(400);
      expect((await request('/invoice-api', { method: 'PUT', body: { ...draft(), revision: 1, schedulingOccurrenceId: alias } })).status).toBe(400);
    }
    expect((await request('', { method: 'POST', body: { ...draft(), id: 'duplicate', schedulingOccurrenceId: reference } })).status).toBe(409);
    expect((await request(`/from-appointment/${reference}`, { owner: 'owner-b' })).status).toBe(404);
    expect((await request('')).data.invoices.map(invoice => invoice.id)).toEqual(['invoice-api']);
  });
  it('does not reveal internal provider errors to the browser', async () => {
    invoices.paymentSettings = async () => { throw new Error('Internal provider implementation detail'); };
    const result = await request('/payment-settings');
    expect(result.status).toBe(503); expect(result.data.error).not.toMatch(/implementation detail/);
  });
});
