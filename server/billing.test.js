import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bestSubscription, subscriptionSummary } from './billing.js';
import { createApp, lessonGate } from './index.js';

// A signed-in tutor (cookie mpt_session=tok), and stand-ins for Stripe.
const tutor = { id: 't1', email: 'tutor@example.com', name: 'Ada', picture: '', stripeCustomerId: 'cus_123', subscription: { id: 'sub_1', status: 'trialing', trialEnd: 1, periodEnd: 2, cancelAtPeriodEnd: false } };
const accounts = { clientId: 'client-123', tutorFor: async (token) => (token === 'tok' ? tutor : null), signOut: async () => {} };
const handled = [];
const billing = {
  checkout: async (who, origin) => `https://checkout.stripe.test/${who.id}?back=${origin}`,
  portal: async () => 'https://billing.stripe.test/p',
  completeCheckout: async (id) => (id === 'cs_test_1234567890' ? { id: 'sub_1', status: 'trialing', trialEnd: 1, periodEnd: 2, cancelAtPeriodEnd: false } : null),
  event: (raw, signature) => {
    if (signature !== 'good') throw new Error('bad signature');
    return JSON.parse(raw.toString());
  },
  handle: async (event) => handled.push(event),
};

let server;
let port;
beforeAll(async () => {
  server = http.createServer(createApp({ accounts, billing }));
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});
afterAll(() => server.close());

function call(method, path, { body, cookie, origin, headers: extra = {} } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: `localhost:${port}`, ...extra };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
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
    req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}

describe('billing with Stripe', () => {
  it('tells the tutor their plan, never their Stripe ids', async () => {
    const me = await call('GET', '/api/me', { cookie: 'mpt_session=tok' });
    expect(me.json.tutor.plan).toEqual({ status: 'trialing', trialEnd: 1, periodEnd: 2, cancelAtPeriodEnd: false });
    expect(me.json.billing).toEqual({ trialDays: 14 });
    expect(me.json.lesson).toEqual({ ok: true }); // trialing: may start a lesson
    expect(JSON.stringify(me.json)).not.toMatch(/cus_|sub_/);
  });

  it('opens Checkout and the billing page only for a signed-in tutor on this site', async () => {
    expect((await call('POST', '/api/billing/checkout')).status).toBe(401);
    expect((await call('POST', '/api/billing/checkout', { cookie: 'mpt_session=tok', origin: 'https://evil.example' })).status).toBe(403);
    const checkout = await call('POST', '/api/billing/checkout', { cookie: 'mpt_session=tok' });
    expect(checkout.json.url).toBe(`https://checkout.stripe.test/t1?back=http://localhost:${port}`);
    expect((await call('POST', '/api/billing/portal', { cookie: 'mpt_session=tok' })).json.url).toBe('https://billing.stripe.test/p');
  });

  it('confirms a finished checkout', async () => {
    expect((await call('GET', '/api/billing/done?session_id=nope', { cookie: 'mpt_session=tok' })).status).toBe(400);
    const done = await call('GET', '/api/billing/done?session_id=cs_test_1234567890', { cookie: 'mpt_session=tok' });
    expect(done.json.plan.status).toBe('trialing');
    expect(JSON.stringify(done.json)).not.toMatch(/sub_/);
  });

  it('accepts Stripe notifications only with a valid signature', async () => {
    const body = JSON.stringify({ type: 'customer.subscription.updated', data: { object: { customer: 'cus_123' } } });
    expect((await call('POST', '/api/stripe/webhook', { body, headers: { 'stripe-signature': 'forged' } })).status).toBe(400);
    expect(handled).toHaveLength(0);
    expect((await call('POST', '/api/stripe/webhook', { body, headers: { 'stripe-signature': 'good' } })).status).toBe(200);
    expect(handled[0].type).toBe('customer.subscription.updated');
  });
});

describe('reading a subscription', () => {
  it('finds the renewal date on the subscription or its items, in milliseconds', () => {
    expect(subscriptionSummary({ id: 's', status: 'trialing', trial_end: 100, items: { data: [{ current_period_end: 200 }] } })).toMatchObject({
      trialEnd: 100000,
      periodEnd: 200000,
      cancelAtPeriodEnd: false,
    });
    expect(subscriptionSummary({ id: 's', status: 'active', current_period_end: 300 }).periodEnd).toBe(300000);
  });

  it('prefers a current subscription over an ended one', () => {
    const best = bestSubscription([
      { id: 'old', status: 'canceled', created: 50 },
      { id: 'now', status: 'active', created: 10 },
    ]);
    expect(best.id).toBe('now');
  });
});

describe('one Stripe customer per tutor', () => {
  it('makes a single customer when several checkouts start at once', async () => {
    const { connectBilling } = await import('./billing.js');
    let made = 0;
    const keys = new Set();
    const stripe = {
      customers: {
        create: async (params, options) => {
          made += 1;
          keys.add(options?.idempotencyKey);
          await new Promise((resolve) => setTimeout(resolve, 30)); // Stripe takes a moment
          return { id: 'cus_once' };
        },
      },
      prices: { list: async () => ({ data: [{ id: 'price_1' }] }) },
      checkout: { sessions: { create: async ({ customer }) => ({ url: `https://checkout.stripe.test/${customer}` }) } },
    };
    const saved = [];
    const accounts = { setBilling: async (id, fields) => saved.push(fields) };
    const billing = connectBilling({ stripe, accounts });
    const newTutor = { id: 't9', email: 'new@example.com', name: 'New', stripeCustomerId: null, subscription: null };
    const urls = await Promise.all([1, 2, 3].map(() => billing.checkout(newTutor, 'http://localhost')));
    expect(made).toBe(1);
    expect([...keys]).toEqual(['tutor-customer-t9']);
    expect(saved).toEqual([{ stripeCustomerId: 'cus_once' }]);
    expect(new Set(urls)).toEqual(new Set(['https://checkout.stripe.test/cus_once']));
  });
});

describe('who can start a lesson', () => {
  it('needs sign-in and access once billing is on: the owner, free access, or a current plan', async () => {
    const day = 86400000;
    const tutors = {
      owner: { email: 'o@example.com', roles: ['owner'] },
      comp: { email: 'c@example.com', comp: { until: null } },
      soon: { email: 's@example.com', comp: { until: Date.now() + day } },
      expired: { email: 'e@example.com', comp: { until: Date.now() - day } },
      trial: { email: 't@example.com', subscription: { status: 'trialing' } },
      due: { email: 'd@example.com', subscription: { status: 'past_due' } },
      ended: { email: 'n@example.com', subscription: { status: 'canceled' } },
    };
    const accounts = { tutorFor: async (token) => tutors[token] || null };
    const gate = lessonGate({ accounts, billing: {} });
    expect(await gate('')).toEqual({ ok: false, reason: 'sign-in' });
    for (const yes of ['owner', 'comp', 'soon', 'trial', 'due']) expect(await gate(`x=1; mpt_session=${yes}`)).toEqual({ ok: true });
    for (const no of ['expired', 'ended']) expect(await gate(`mpt_session=${no}`)).toEqual({ ok: false, reason: 'plan' });
    expect(await lessonGate({ accounts, billing: null })('')).toEqual({ ok: true }); // no billing: as before
  });
});
