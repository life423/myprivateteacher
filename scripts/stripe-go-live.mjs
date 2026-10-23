// Turns on real billing for myprivateteacher.com, once your Stripe account is activated.
// Uses STRIPE_LIVE_SECRET_KEY from .env (never printed) and the Azure CLI. It:
//   1. checks Stripe says the account can take payments,
//   2. creates the Tutor plan ($19/month) in live mode, once,
//   3. sets up the billing page (customer portal),
//   4. creates the webhook for https://myprivateteacher.com/api/stripe/webhook, once,
//   5. stores the live key and the webhook signing secret as Azure secrets, which restarts
//      the live site with billing on.
// Run: npm run stripe-go-live              (add -- --dry-run to only check, changing nothing)
// Safe to rerun: it finds what already exists instead of making another.
import { execFileSync } from 'node:child_process';
import Stripe from 'stripe';
import { PRICE_LOOKUP_KEY } from '../server/billing.js';

const APP = 'phoneme-pop';
const GROUP = 'portfolio-apps';
const SITE = 'https://myprivateteacher.com';
const WEBHOOK_URL = `${SITE}/api/stripe/webhook`;
const EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',
  'invoice.paid',
  'invoice.payment_failed',
];
const dryRun = process.argv.includes('--dry-run');
const allowTest = process.argv.includes('--allow-test'); // only for checking this script in a sandbox
const say = (line) => console.log(line);
const fail = (line) => {
  console.error(`\n✗ ${line}`);
  process.exit(1);
};

const key = process.env.STRIPE_LIVE_SECRET_KEY || (allowTest ? process.env.STRIPE_SECRET_KEY : '');
if (!key) fail('Add STRIPE_LIVE_SECRET_KEY=sk_live_... to .env first (Stripe Dashboard in live mode: Developers > API keys > Secret key).');
const live = /^(sk|rk)_live_/.test(key);
if (!live && !allowTest) fail('STRIPE_LIVE_SECRET_KEY is not a live key: it should start with sk_live_.');
const stripe = new Stripe(key);
say(`${dryRun ? 'Checking' : 'Setting up'} ${live ? 'LIVE' : 'sandbox (test)'} billing for ${SITE}${dryRun ? ' (dry run: nothing changes)' : ''}\n`);

// 1. The account.
const account = await stripe.accounts.retrieve();
const name = account.settings?.dashboard?.display_name || account.business_profile?.name || account.id;
say(`1. Stripe account: ${name}`);
say(`   Can take payments: ${account.charges_enabled ? 'yes' : 'NO'} · Payouts: ${account.payouts_enabled ? 'yes' : 'not yet'}`);
if (live && !account.charges_enabled) fail('Stripe says this account cannot take payments yet. Finish activation in the Stripe Dashboard, then run this again.');
const publicName = account.business_profile?.name || account.settings?.dashboard?.display_name;
if (publicName !== 'My Private Teacher') say(`   Tip: tutors see “${publicName}” on checkout. Set the public business name to My Private Teacher in Stripe Settings > Business > Public details.`);

// 2. The Tutor plan.
const found = await stripe.prices.list({ lookup_keys: [PRICE_LOOKUP_KEY], expand: ['data.product'], limit: 1 });
if (found.data[0]) {
  const p = found.data[0];
  say(`2. Tutor plan: already there, ${p.unit_amount / 100} ${p.currency.toUpperCase()}/${p.recurring.interval}`);
} else if (dryRun) {
  say('2. Tutor plan: would create My Private Teacher: Tutor plan, $19.00/month');
} else {
  const product = await stripe.products.create({ name: 'My Private Teacher: Tutor plan', description: 'Live lesson workspace for structured literacy tutors.' });
  await stripe.prices.create({ product: product.id, currency: 'usd', unit_amount: 1900, recurring: { interval: 'month' }, lookup_key: PRICE_LOOKUP_KEY, nickname: 'Tutor monthly' });
  say('2. Tutor plan: created, $19.00/month');
}

// 3. The billing page (customer portal): update card, see invoices, cancel at the end of the period.
const portalSettings = {
  business_profile: { headline: 'My Private Teacher: manage your Tutor plan' },
  default_return_url: `${SITE}/account`,
  features: {
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
    customer_update: { enabled: true, allowed_updates: ['email', 'address'] },
    subscription_cancel: { enabled: true, mode: 'at_period_end' },
  },
};
const portals = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
if (dryRun) {
  say(`3. Billing page: ${portals.data[0] ? 'would update the existing settings' : 'would create it'}`);
} else if (portals.data[0]) {
  await stripe.billingPortal.configurations.update(portals.data[0].id, portalSettings);
  say('3. Billing page: updated (update card, invoices, cancel at period end)');
} else {
  const made = await stripe.billingPortal.configurations.create(portalSettings);
  say(`3. Billing page: created${made.is_default ? '' : ' (if Manage billing fails, open Settings > Billing > Customer portal in Stripe and save once)'}`);
}

// 4. The webhook. Stripe shows a webhook signing secret only when the webhook is created.
const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
let hook = hooks.data.find((h) => h.url === WEBHOOK_URL);
let signingSecret = process.env.STRIPE_LIVE_WEBHOOK_SECRET || '';
if (hook) {
  if (!dryRun) await stripe.webhookEndpoints.update(hook.id, { enabled_events: EVENTS, disabled: false });
  say(`4. Webhook: already there for ${WEBHOOK_URL}${dryRun ? '' : ' (events refreshed)'}`);
  if (!signingSecret && !dryRun) {
    fail('This webhook already existed, so Stripe will not show its signing secret again. In Stripe: Developers > Webhooks > this endpoint > Reveal signing secret, add it to .env as STRIPE_LIVE_WEBHOOK_SECRET=whsec_..., then run this again.');
  }
} else if (dryRun) {
  say(`4. Webhook: would create ${WEBHOOK_URL} (${EVENTS.length} events)`);
} else {
  hook = await stripe.webhookEndpoints.create({ url: WEBHOOK_URL, enabled_events: EVENTS, description: 'My Private Teacher: tutor plans' });
  signingSecret = hook.secret;
  say(`4. Webhook: created for ${WEBHOOK_URL}`);
}

// 5. Azure: the two secrets, then the live site restarts with billing on.
if (dryRun) {
  say(`5. Azure: would store stripe-secret-key and stripe-webhook-secret on ${APP} and restart it with billing on`);
  say('\nDry run done. Nothing was changed.');
  process.exit(0);
}
if (!live) fail('Stopping before Azure: this was a sandbox key, and the live site only gets a live key.');
const az = (...args) => execFileSync('az', args, { stdio: ['ignore', 'ignore', 'pipe'] });
try {
  az('containerapp', 'secret', 'set', '-n', APP, '-g', GROUP, '--secrets', `stripe-secret-key=${key}`, `stripe-webhook-secret=${signingSecret}`);
  az('containerapp', 'update', '-n', APP, '-g', GROUP, '--set-env-vars', 'STRIPE_SECRET_KEY=secretref:stripe-secret-key', 'STRIPE_WEBHOOK_SECRET=secretref:stripe-webhook-secret');
} catch (error) {
  fail(`Azure did not accept the secrets: ${String(error.stderr || error.message).split('\n')[0]} (are you signed in? run: az login)`);
}
say('5. Azure: secrets stored; the live site is restarting with billing on (about a minute)');
say(`\nDone. Check ${SITE}/account in a minute: it should offer Start 14-day free trial.`);
