import Stripe from 'stripe';

// Subscriptions with Stripe. Checkout starts the 14-day free trial (no card needed to start;
// if the trial ends without one, the subscription simply ends and nobody is charged).
// Stripe's billing page handles cards, invoices and cancelling. Stripe's notifications
// (webhooks) keep each tutor's status current. Off unless STRIPE_SECRET_KEY is set.
export const PRICE_LOOKUP_KEY = 'tutor_monthly';
export const TRIAL_DAYS = 14;
export const PLAN_PRICE_CENTS = 1900; // the Tutor plan, per month (scripts create the Stripe price at this amount)

// A payment as the admin panel shows it.
const paymentOf = (c) => ({
  id: c.id,
  created: c.created * 1000,
  amount: c.amount,
  refunded: c.amount_refunded || 0,
  currency: c.currency,
  status: c.status, // succeeded, pending or failed
  receipt: c.receipt_url || null,
  description: c.description || '',
});

// The plan's status as the app sees it, from a Stripe subscription.
export function subscriptionSummary(sub) {
  if (!sub) return null;
  const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  return {
    id: sub.id,
    status: sub.status,
    trialEnd: sub.trial_end ? sub.trial_end * 1000 : null,
    periodEnd: periodEnd ? periodEnd * 1000 : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end || sub.cancel_at),
  };
}

// The subscription that matters most: a current one, else the newest.
const RANK = { active: 0, trialing: 1, past_due: 2, unpaid: 3, paused: 4, incomplete: 5, canceled: 6, incomplete_expired: 7 };
export const bestSubscription = (subs) =>
  [...subs].sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || b.created - a.created)[0] || null;

export function connectBilling({ secretKey = process.env.STRIPE_SECRET_KEY, webhookSecret = process.env.STRIPE_WEBHOOK_SECRET, accounts, stripe: client } = {}) {
  if ((!secretKey && !client) || !accounts) return null;
  const stripe = client || new Stripe(secretKey);
  const creating = new Map(); // tutor id -> the Stripe customer being created for them
  let price = null;

  async function priceId() {
    if (price) return price;
    const found = await stripe.prices.list({ lookup_keys: [PRICE_LOOKUP_KEY], active: true, limit: 1 });
    price = found.data[0]?.id || null;
    if (!price) throw new Error(`No Stripe price with lookup key ${PRICE_LOOKUP_KEY} (run npm run stripe-setup)`);
    return price;
  }

  // Each tutor gets exactly one Stripe customer, made the first time they need one. Requests
  // that arrive together share the one being made, and the idempotency key makes Stripe
  // return that same customer to any repeat, so extra clicks can never make duplicates.
  function customerFor(tutor) {
    if (tutor.stripeCustomerId) return Promise.resolve(tutor.stripeCustomerId);
    if (!creating.has(tutor.id)) {
      const job = (async () => {
        const customer = await stripe.customers.create(
          { email: tutor.email, name: tutor.name || undefined, metadata: { tutorId: tutor.id } },
          { idempotencyKey: `tutor-customer-${tutor.id}` },
        );
        await accounts.setBilling(tutor.id, { stripeCustomerId: customer.id });
        return customer.id;
      })();
      creating.set(tutor.id, job);
      job.then(
        () => creating.delete(tutor.id),
        () => creating.delete(tutor.id),
      );
    }
    return creating.get(tutor.id);
  }

  // Reads the customer's subscriptions from Stripe (the source of truth) and saves the one that
  // matters, so notifications arriving late or out of order can't leave a wrong status.
  async function syncCustomer(customerId) {
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
    const summary = subscriptionSummary(bestSubscription(subs.data));
    await accounts.setBillingByCustomer(customerId, { subscription: summary });
    return summary;
  }

  return {
    // A Checkout page for the tutor plan: the free trial the first time, a paid plan after that.
    async checkout(tutor, origin) {
      const customer = await customerFor(tutor);
      const firstTime = !tutor.subscription;
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer,
        client_reference_id: tutor.id,
        line_items: [{ price: await priceId(), quantity: 1 }],
        ...(firstTime
          ? {
              payment_method_collection: 'if_required',
              subscription_data: { trial_period_days: TRIAL_DAYS, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } },
            }
          : {}),
        allow_promotion_codes: true,
        success_url: `${origin}/billing/done?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/#pricing`,
      });
      return session.url;
    },
    // The admin panel: a tutor's payments (Stripe charges), newest first.
    async payments(tutor) {
      if (!tutor.stripeCustomerId) return [];
      const charges = await stripe.charges.list({ customer: tutor.stripeCustomerId, limit: 24 });
      return charges.data.map(paymentOf);
    },
    // Refunds a payment, all of what's left or part of it (in cents). Only the tutor's own
    // payments; the same refund asked twice within a minute (a double click) happens once.
    async refund(tutor, chargeId, amount) {
      const charge = await stripe.charges.retrieve(chargeId);
      if (!charge || charge.customer !== tutor.stripeCustomerId) throw Object.assign(new Error('not their payment'), { status: 404 });
      const left = charge.amount - (charge.amount_refunded || 0);
      const cents = amount == null ? left : amount;
      if (!(Number.isInteger(cents) && cents > 0 && cents <= left)) throw Object.assign(new Error('amount'), { status: 400, left });
      const minute = Math.floor(Date.now() / 60000);
      await stripe.refunds.create(
        { charge: chargeId, amount: cents, reason: 'requested_by_customer' },
        { idempotencyKey: `refund-${chargeId}-${cents}-${minute}` },
      );
      return paymentOf(await stripe.charges.retrieve(chargeId));
    },
    // Cancels their plan, now or at the end of the period they've paid for; or undoes the latter.
    async cancel(tutor, when) {
      const sub = tutor.subscription;
      if (!sub?.id) throw Object.assign(new Error('no plan'), { status: 409 });
      if (when === 'now') await stripe.subscriptions.cancel(sub.id);
      else await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
      return syncCustomer(tutor.stripeCustomerId);
    },
    async resume(tutor) {
      const sub = tutor.subscription;
      if (!sub?.id) throw Object.assign(new Error('no plan'), { status: 409 });
      await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false });
      return syncCustomer(tutor.stripeCustomerId);
    },
    // A free extension from the admin panel: the next charge moves back by that many days, as
    // extra trial time, which Stripe never bills for. Returns the new status.
    async extend(tutor, days) {
      const sub = tutor.subscription;
      if (!sub?.id || !tutor.stripeCustomerId) throw new Error('no subscription to extend');
      const now = Math.floor(Date.now() / 1000);
      const from = Math.max(now, Math.floor((sub.trialEnd || 0) / 1000), Math.floor((sub.periodEnd || 0) / 1000));
      await stripe.subscriptions.update(sub.id, { trial_end: from + days * 86400, proration_behavior: 'none' });
      return syncCustomer(tutor.stripeCustomerId);
    },
    // Stripe's own billing page: card, invoices, cancel.
    async portal(tutor, origin) {
      const session = await stripe.billingPortal.sessions.create({ customer: await customerFor(tutor), return_url: `${origin}/account` });
      return session.url;
    },
    // Back from Checkout: confirm with Stripe right away rather than waiting for the notification.
    async completeCheckout(sessionId, tutor) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (!session.customer || session.customer !== tutor.stripeCustomerId) return null;
      return syncCustomer(session.customer);
    },
    // A Stripe notification, checked against the webhook signing secret.
    event(rawBody, signature) {
      if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
      return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    },
    async handle(event) {
      const object = event.data?.object || {};
      const customer = typeof object.customer === 'string' ? object.customer : object.customer?.id;
      const relevant = event.type.startsWith('customer.subscription.') || event.type.startsWith('checkout.session.') || event.type.startsWith('invoice.');
      if (customer && relevant) await syncCustomer(customer);
    },
  };
}
