import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import express from 'express';
import { schedulingRoutes } from './schedulingRoutes.js';
import { createSchedulingRepository } from './scheduling.js';
import { memoryLessonCollection } from './lessonFixtures.js';

let server, origin, collection;
const appointment = { id: 'appointment-a', studentName: 'Casey', localDate: '2026-11-24', localTime: '15:00', timeZone: 'America/Chicago', durationMinutes: 45, repeat: 'weekly', untilDate: null, lessonId: null };
const range = '?from=2026-11-23&to=2026-11-29&timeZone=America%2FChicago';
const request = (path = '', { method = 'GET', owner = 'owner-a', body, headers = {} } = {}) => fetch(`${origin}/api/schedule${path}`, { method, headers: { ...(owner ? { 'x-fixture-owner': owner } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
beforeEach(async () => {
  collection = memoryLessonCollection(); const scheduling = createSchedulingRepository({ collection });
  const app = express(); app.use('/api/schedule', schedulingRoutes({ scheduling, currentTutor: async req => req.get('x-fixture-owner') ? { id: req.get('x-fixture-owner') } : null, sameSite: req => !req.get('origin') || req.get('origin') === origin }));
  server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); });

describe('teacher calendar HTTP boundary', () => {
  it('authenticates reads and protects every mutation from another origin', async () => {
    expect((await request(range, { owner: null })).status).toBe(401);
    expect((await request('', { method: 'POST', body: appointment, headers: { origin: 'https://unrelated.example' } })).status).toBe(403);
    expect(collection.records.size).toBe(0);
    const created = await request('', { method: 'POST', body: appointment, headers: { origin } });
    expect(created.status).toBe(201); expect(created.headers.get('cache-control')).toBe('no-store');
    for (const [method, path] of [['PUT', '/appointment-a'], ['PATCH', '/appointment-a/occurrences/2026-11-24'], ['DELETE', '/appointment-a']]) expect((await request(path, { method, body: { ...appointment, revision: 1 }, headers: { origin: 'https://unrelated.example' } })).status).toBe(403);
  });
  it('returns only owned occurrences and preserves revision errors for recovery', async () => {
    await request('', { method: 'POST', body: appointment });
    const listed = await request(range); expect((await listed.json()).occurrences).toHaveLength(1);
    expect((await request(range, { owner: 'other-owner' }).then(reply => reply.json())).occurrences).toEqual([]);
    expect((await request('/occurrences/appointment-a~2026-11-24', { owner: 'other-owner' })).status).toBe(404);
    expect((await request('/appointment-a', { method: 'PUT', body: { ...appointment, revision: 0 } })).status).toBe(409);
    const moved = await request('/appointment-a/occurrences/2026-11-24', { method: 'PATCH', body: { revision: 1, localDate: '2026-11-25', localTime: '16:00', durationMinutes: 60 } });
    expect(moved.status).toBe(200);
    const occurrence = await request('/occurrences/appointment-a~2026-11-24').then(reply => reply.json());
    expect(occurrence.occurrence).toMatchObject({ localDate: '2026-11-25', localTime: '16:00', durationMinutes: 60 });
  });
  it('rejects malformed ranges and invalid display time zones without leaking internals', async () => {
    await request('', { method: 'POST', body: appointment });
    expect((await request('?from=bad&to=2026-11-29&timeZone=UTC')).status).toBe(400);
    expect((await request('/occurrences/appointment-a~2026-11-24?timeZone=bogus')).status).toBe(400);
    expect((await request('/occurrences/appointment-a~2026-02-31')).status).toBe(404);
    for (const suffix of ['~', '~~alias', '~~']) expect((await request(`/occurrences/appointment-a~2026-11-24${suffix}`)).status).toBe(404);
  });
});
