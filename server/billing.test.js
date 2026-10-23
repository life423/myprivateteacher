import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bestSubscription, subscriptionSummary } from './billing.js';
import { createApp } from './index.js';

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
