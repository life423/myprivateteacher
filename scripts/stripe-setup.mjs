// Creates the Tutor plan in Stripe ($19/month, lookup key tutor_monthly), once.
// Safe to rerun: it finds the existing plan instead of making another.
// Run: npm run stripe-setup (uses STRIPE_SECRET_KEY from .env; test or live).
import Stripe from 'stripe';
import { PRICE_LOOKUP_KEY } from '../server/billing.js';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('STRIPE_SECRET_KEY is not set in .env');
  process.exit(1);
}
const stripe = new Stripe(key);
const mode = key.startsWith('sk_live') || key.startsWith('rk_live') ? 'LIVE' : 'test';
const existing = await stripe.prices.list({ lookup_keys: [PRICE_LOOKUP_KEY], expand: ['data.product'], limit: 1 });
if (existing.data[0]) {
  const p = existing.data[0];
  console.log(`[${mode}] Already set up: ${p.product.name}, ${p.unit_amount / 100} ${p.currency.toUpperCase()}/${p.recurring.interval} (${p.id})`);
} else {
  const product = await stripe.products.create({
    name: 'My Private Teacher: Tutor plan',
    description: 'Live lesson workspace for structured literacy tutors.',
  });
  const price = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: 1900,
    recurring: { interval: 'month' },
    lookup_key: PRICE_LOOKUP_KEY,
    nickname: 'Tutor monthly',
  });
  console.log(`[${mode}] Created ${product.name}: $19.00/month (${price.id})`);
}
