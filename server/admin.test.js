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
  deleteTutor: async (id) => {
    const key = Object.keys(people).find((k) => people[k].id === id);
    delete people[key];
    return true;
  },
  record: async (entry) => log.push(entry),
  listActivity: async () => log,
};
const charges = { ch_1: { id: 'ch_1', customer: 'cus_t', amount: 1900, refunded: 0 } };
const cancels = [];
const resumed = [];
const paymentOf = (c) => ({ id: c.id, amount: c.amount, refunded: c.refunded, currency: 'usd', status: 'succeeded' });
const billing = {
  extend: async (t, days) => {
    extended.push([t.id, days]);
    return { status: 'trialing', trialEnd: t.subscription.trialEnd + days * DAY };
  },
  payments: async (t) => Object.values(charges).filter((c) => c.customer === t.stripeCustomerId).map(paymentOf),
  refund: async (t, id, amount) => {
    const c = charges[id];
    if (!c || c.customer !== t.stripeCustomerId) throw Object.assign(new Error('not theirs'), { status: 404 });
    const left = c.amount - c.refunded;
    const cents = amount ?? left;
    if (!(Number.isInteger(cents) && cents > 0 && cents <= left)) throw Object.assign(new Error('amount'), { status: 400, left });
    c.refunded += cents;
    return paymentOf(c);
  },
  cancel: async (t, when) => {
    cancels.push([t.id, when]);
    t.subscription = when === 'now' ? { ...t.subscription, status: 'canceled' } : { ...t.subscription, cancelAtPeriodEnd: true };
  },
  resume: async (t) => {
    resumed.push(t.id);
    t.subscription = { ...t.subscription, cancelAtPeriodEnd: false };
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
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload); // as browsers send it, DELETE included
    }
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
    req.end(payload);
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

describe('the admin panel, part 2', () => {
  it('shows the numbers at the top', async () => {
    const overview = await call('GET', '/api/admin/overview', { as: 'owner' });
    expect(overview.json).toMatchObject({ tutors: 3, trials: 1, trialsEndingSoon: 1, paying: 0, monthly: 0, free: 2, lessonsNow: 0 });
  });

  it('lists payments, and refunds only what is left of the tutor’s own', async () => {
    const list = await call('GET', `/api/admin/tutors/${people.tess.id}/payments`, { as: 'owner' });
    expect(list.json.payments).toEqual([expect.objectContaining({ id: 'ch_1', amount: 1900, refunded: 0 })]);
    const refund = (body) => call('POST', `/api/admin/tutors/${people.tess.id}/refund`, { as: 'owner', body });
    expect((await refund({ charge: 'nope' })).status).toBe(400);
    expect((await refund({ charge: 'ch_other' })).status).toBe(404);
    expect((await refund({ charge: 'ch_1', amount: 5000 })).status).toBe(400);
    expect((await refund({ charge: 'ch_1', amount: 900 })).json.payment.refunded).toBe(900);
    expect((await refund({ charge: 'ch_1' })).json.payment.refunded).toBe(1900); // the rest
    expect((await refund({ charge: 'ch_1' })).status).toBe(400); // nothing left
    expect(log.filter((e) => e.action === 'refund')).toHaveLength(2);
  });

  it('cancels at the end of the period or now, and can keep the plan', async () => {
    const at = (path, body) => call('POST', `/api/admin/tutors/${people.tess.id}/${path}`, { as: 'owner', body });
    expect((await at('cancel', {})).json.tutor.plan.cancelAtPeriodEnd).toBe(true);
    expect((await at('resume')).json.tutor.plan.cancelAtPeriodEnd).toBe(false);
    expect((await at('cancel', { when: 'now' })).json.tutor.plan.status).toBe('canceled');
    expect((await at('cancel', {})).status).toBe(409); // nothing left to cancel
    expect(cancels).toEqual([
      [people.tess.id, 'period_end'],
      [people.tess.id, 'now'],
    ]);
  });

  it('deletes an account only with their email typed, never an owner, and cancels a live plan first', async () => {
    people.ada.stripeCustomerId = 'cus_a';
    people.ada.subscription = { id: 'sub_a', status: 'active' };
    const remove = (who, confirm) => call('DELETE', `/api/admin/tutors/${who.id}`, { as: 'owner', body: { confirm } });
    expect((await remove(people.owner, 'owner@example.com')).status).toBe(409);
    expect((await remove(people.ada, 'someone@else.com')).status).toBe(400);
    const adaId = people.ada.id;
    expect((await remove(people.ada, ' ADA@example.com ')).json).toEqual({ deleted: true });
    expect(cancels.at(-1)).toEqual([adaId, 'now']);
    expect(people.ada).toBeUndefined();
    expect(log.at(-1)).toMatchObject({ action: 'delete', target: { email: 'ada@example.com' } });
  });
});
