import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './index.js';
import { tutorAccess } from './accounts.js';

// Stand-ins: an owner, two tutors (one on a Stripe trial), and Stripe's free extension.
const DAY = 86400000;
const people = {
  owner: { id: 'a'.repeat(24), email: 'owner@example.com', name: 'Owner', roles: ['owner'], comp: null, subscription: null },
  ada: { id: 'b'.repeat(24), email: 'ada@example.com', name: 'Ada', roles: [], comp: null, subscription: null },
  tess: {
    id: 'c'.repeat(24),
    email: 'tess@example.com',
    name: 'Tess',
    roles: [],
    comp: null,
    stripeCustomerId: 'cus_t',
    subscription: { id: 'sub_t', status: 'trialing', trialEnd: Date.now() + 5 * DAY },
  },
};
const sessions = { owner: 'owner', ada: 'ada' };
const byId = (id) => Object.values(people).find((t) => t.id === id) || null;
const grants = new Map();
const log = [];
const extended = [];
let signedOut = null;
const accounts = {
  clientId: 'client-123',
  tutorFor: async (token) => people[sessions[token]] || null,
  signOut: async () => {},
  listTutors: async () => Object.values(people),
  tutorById: async (id) => byId(id),
  setComp: async (id, comp) => {
    byId(id).comp = comp ? { until: comp.until ?? null, note: comp.note } : null;
  },
  grantByEmail: async (email, { comp }) => {
    grants.set(email, comp);
    return { applied: false };
  },
  listGrants: async () => [...grants].map(([email, comp]) => ({ email, comp })),
  removeGrant: async (email) => grants.delete(email),
  signOutEverywhere: async (id) => {
    signedOut = id;
    return 2;
  },
  record: async (entry) => log.push(entry),
  listActivity: async () => log,
};
const billing = {
  extend: async (t, days) => {
    extended.push([t.id, days]);
    return { status: 'trialing', trialEnd: t.subscription.trialEnd + days * DAY };
  },
};

let server;
let port;
beforeAll(async () => {
  server = http.createServer(createApp({ accounts, billing }));
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});
afterAll(() => server.close());

function call(method, path, { as, body, origin } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: `localhost:${port}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (as) headers.cookie = `mpt_session=${as}`;
    if (origin) headers.origin = origin;
    const req = http.request({ port, method, path, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

describe('tutor access', () => {
  it('comes from being the owner, free access that hasn’t ended, or a current plan', () => {
    expect(tutorAccess({ roles: ['owner'] }).kind).toBe('owner');
    expect(tutorAccess({ comp: { until: null } })).toMatchObject({ ok: true, kind: 'comp', until: null });
    expect(tutorAccess({ comp: { until: Date.now() - 1 } }).ok).toBe(false);
    expect(tutorAccess({ subscription: { status: 'past_due' } }).kind).toBe('plan');
    expect(tutorAccess({ subscription: { status: 'canceled' } }).ok).toBe(false);
  });
});

describe('the admin panel', () => {
  it('is only for a signed-in owner, and changes only from this site', async () => {
    expect((await call('GET', '/api/admin/tutors')).status).toBe(401);
    expect((await call('GET', '/api/admin/tutors', { as: 'ada' })).status).toBe(403);
    const list = await call('GET', '/api/admin/tutors', { as: 'owner' });
    expect(list.status).toBe(200);
    expect(list.json.tutors.find((t) => t.email === 'tess@example.com').access.kind).toBe('plan');
    expect(list.json.tutors.find((t) => t.email === 'owner@example.com').access.kind).toBe('owner');
    const forged = await call('POST', `/api/admin/tutors/${people.ada.id}/comp`, { as: 'owner', body: { until: null }, origin: 'https://evil.example' });
    expect(forged.status).toBe(403);
  });

  it('gives and removes free access, forever or until a date', async () => {
    const forever = await call('POST', `/api/admin/tutors/${people.ada.id}/comp`, { as: 'owner', body: { until: null, note: 'Mom' } });
    expect(forever.json.tutor.access).toMatchObject({ ok: true, kind: 'comp', until: null });
    expect(log.at(-1)).toMatchObject({ action: 'comp', target: { email: 'ada@example.com' }, detail: { note: 'Mom' } });
    const past = await call('POST', `/api/admin/tutors/${people.ada.id}/comp`, { as: 'owner', body: { until: '2001-01-01' } });
    expect(past.status).toBe(400);
    const removed = await call('DELETE', `/api/admin/tutors/${people.ada.id}/comp`, { as: 'owner' });
    expect(removed.json.tutor.access.ok).toBe(false);
  });

  it('extends for free: a dated comp moves on, a Stripe trial moves its next charge', async () => {
    const soon = Date.now() + 2 * DAY;
    await call('POST', `/api/admin/tutors/${people.ada.id}/comp`, { as: 'owner', body: { until: new Date(soon).toISOString() } });
    const comp = await call('POST', `/api/admin/tutors/${people.ada.id}/extend`, { as: 'owner', body: { days: 30 } });
    expect(comp.json.how).toBe('comp');
    expect(Math.round((comp.json.until - soon) / DAY)).toBe(30);
    const plan = await call('POST', `/api/admin/tutors/${people.tess.id}/extend`, { as: 'owner', body: {} });
    expect(plan.json.how).toBe('plan');
    expect(extended).toEqual([[people.tess.id, 30]]);
    await call('POST', `/api/admin/tutors/${people.ada.id}/comp`, { as: 'owner', body: { until: null } });
    expect((await call('POST', `/api/admin/tutors/${people.ada.id}/extend`, { as: 'owner', body: {} })).status).toBe(409);
    expect((await call('POST', `/api/admin/tutors/${people.owner.id}/extend`, { as: 'owner', body: {} })).status).toBe(409);
  });

  it('gives free access to an email before they sign in, and signs a tutor out everywhere', async () => {
    const bad = await call('POST', '/api/admin/grants', { as: 'owner', body: { email: 'not an email' } });
    expect(bad.status).toBe(400);
    const ok = await call('POST', '/api/admin/grants', { as: 'owner', body: { email: ' Mom@Example.com ', note: 'Mom' } });
    expect(ok.json).toEqual({ applied: false });
    expect(grants.get('mom@example.com')).toMatchObject({ until: null, note: 'Mom' });
    const out = await call('POST', `/api/admin/tutors/${people.ada.id}/sign-out`, { as: 'owner' });
    expect(out.json).toEqual({ signedOut: 2 });
    expect(signedOut).toBe(people.ada.id);
    const activity = await call('GET', '/api/admin/activity', { as: 'owner' });
    expect(activity.json.activity.map((e) => e.action)).toEqual(expect.arrayContaining(['comp', 'uncomp', 'extend', 'grant', 'sign-out']));
  });
});
