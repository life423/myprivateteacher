import Stripe from 'stripe';
import { createHash } from 'node:crypto';
import { mongoClient } from './db.js';
import { DATABASE } from './library.js';
import { stripeMode } from './accounts.js';
import { isInvoiceId } from '../shared/invoices.js';
import { scheduleInstant } from '../shared/scheduling.js';

export const INVOICE_FEE_BPS = 500;
export const invoiceFeeCents = amount => {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100000000) throw new Error('Invalid payment amount.');
  return Math.floor((amount * INVOICE_FEE_BPS + 5000) / 10000);
};
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const idOf = value => typeof value === 'string' ? value : value?.id;
const safeStripeUrl = (url, hosts) => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !hosts.some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) throw new Error('Invalid Stripe link.');
  return url;
};
const invoiceEvents = new Set(['invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed', 'invoice.updated', 'invoice.voided', 'invoice.marked_uncollectible', 'invoice.finalized', 'invoice.overpaid']);
const creditEvents = new Set(['credit_note.created', 'credit_note.updated', 'credit_note.voided']);
const chargeEvents = new Set(['charge.refunded', 'refund.created', 'refund.updated', 'refund.failed', 'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated']);

// A separate key, mode and collection keep family payments apart from the app's
// existing tutor subscription billing. Never derive a teacher account from a request.
export function createInvoicePayments({ stripe, collection, accounts, mode = 'test', webhookSecret, connectWebhookSecret,
  origin = 'http://localhost:3000', liveEnabled = false, pricingVerified = false, platformAccountId = null, pricingMode = null,
  taxMode = 'none', now = () => new Date() }) {
  const base = new URL(origin);
  const localHttp = base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname);
  if (base.protocol !== 'https:' && !localHttp) throw new Error('Invoice return links require HTTPS.');
  const queues = new Map();
  const serial = (owner, fn) => {
    const pending = (queues.get(owner) || Promise.resolve()).catch(() => {}).then(fn);
    queues.set(owner, pending);
    return pending.finally(() => { if (queues.get(owner) === pending) queues.delete(owner); });
  };
  const active = async owner => {
    if (!isInvoiceId(owner) || !accounts || !(await accounts.isActive(owner))) fail(403, 'This teacher account is unavailable.');
  };
  const mappingId = owner => `${mode}:${owner}`;
  const mapping = owner => collection.findOne({ _id: mappingId(owner), mode });
  const operationId = (kind, key) => `operation:${mode}:${kind}:${createHash('sha256').update(key).digest('hex')}`;
  const operation = async (kind, key, input) => {
    const _id = operationId(kind, key), fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    let record = await collection.findOne({ _id });
    if (!record) {
      try { await collection.insertOne({ _id, mode, fingerprint, createdAt: now(), ...input }); }
      catch (error) { if (error.code !== 11000) throw error; }
      record = await collection.findOne({ _id });
    }
    if (record.fingerprint !== fingerprint) fail(409, 'This payment operation changed. Reload before continuing.');
    // Stripe may expire idempotency keys after 24 hours. An unresolved older
    // operation needs reconciliation instead of silently creating a second one.
    if (!record.complete && now().getTime() - new Date(record.createdAt).getTime() > 23 * 3600000) fail(409, 'This payment operation needs a Stripe review before it can be retried.');
    return record;
  };
  const checkpoint = async (record, fields) => { await collection.updateOne({ _id: record._id }, { $set: fields }); return Object.assign(record, fields); };
  // Teachers can complete Stripe's account details before collection is activated.
  // Account setup does not create a customer, invoice, payment or transfer.
  const readyToOnboard = () => Boolean(webhookSecret && connectWebhookSecret && platformAccountId && pricingMode === mode &&
    (mode !== 'live' || base.protocol === 'https:'));
  const readyToCollect = () => Boolean(readyToOnboard() && pricingVerified &&
    (mode !== 'live' || (liveEnabled && taxMode === 'none')));
  let platformPromise;
  const verifyPlatform = async () => {
    if (!platformPromise) platformPromise = stripe.accounts.retrieve().catch(error => { platformPromise = null; throw error; });
    const platform = await platformPromise;
    return platform.id === platformAccountId && platform.country === 'US';
  };
  const requireOnboarding = async () => {
    if (!readyToOnboard()) fail(409, 'Stripe invoice payments need to finish setup first.');
    if (!(await verifyPlatform())) fail(409, 'The Stripe payment account needs a configuration review.');
  };
  const accountFor = async owner => {
    const record = await mapping(owner);
    if (!record?.accountId) fail(409, 'Connect your payment account first.');
    return record;
  };
  const retrieveAccount = async accountId => stripe.v2.core.accounts.retrieve(accountId, { include: ['configuration.recipient', 'requirements', 'defaults'] });
  const accountReady = account => account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === 'active';
  const verifiedInvoice = async (owner, invoice) => {
    const record = await accountFor(owner);
    const pending = !invoice.online?.stripeInvoiceId ? await collection.findOne({ mode, operation: 'issue', ownerId: owner, invoiceId: invoice.id }) : null;
    const invoiceId = invoice.online?.stripeInvoiceId || pending?.stripeInvoiceId;
    if (!invoiceId) fail(409, 'This invoice needs a Stripe review before its saved records can be removed.');
    const upstream = await stripe.invoices.retrieve(invoiceId);
    if (upstream.livemode !== (mode === 'live') || upstream.metadata?.mpt_invoice !== invoice.id || idOf(upstream.transfer_data?.destination) !== record.accountId || (invoice.online?.accountId && invoice.online.accountId !== record.accountId) ||
      upstream.currency?.toUpperCase() !== invoice.currency || (upstream.status !== 'draft' && upstream.total !== invoice.totalCents)) fail(409, 'The online invoice could not be matched to this teacher.');
    return upstream;
  };
  const all = async (resource, params) => {
    const rows = []; let startingAfter;
    for (let page = 0; page < 20; page++) {
      const result = await resource.list({ ...params, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
      rows.push(...result.data);
      if (!result.has_more) return rows;
      const last = result.data.at(-1)?.id;
      if (!last || last === startingAfter) break;
      startingAfter = last;
    }
    fail(503, 'This invoice needs a payment review before it can be changed.');
  };
  const chargesFor = async upstream => {
    const payments = await all(stripe.invoicePayments, { invoice: upstream.id, status: 'paid' });
    const charges = [];
    for (const payment of payments) {
      let chargeId = idOf(payment.payment?.charge);
      if (payment.payment?.type === 'payment_intent') {
        const intent = await stripe.paymentIntents.retrieve(idOf(payment.payment.payment_intent));
        chargeId = idOf(intent.latest_charge);
      }
      if (chargeId && !charges.some(charge => charge.id === chargeId)) {
        const charge = await stripe.charges.retrieve(chargeId, { expand: ['application_fee'] });
        if (charge.currency !== upstream.currency || charge.livemode !== (mode === 'live')) fail(409, 'A payment could not be verified.');
        charges.push(charge);
      }
    }
    return charges;
  };
  const refundsFor = async charge => {
    const refunds = await all(stripe.refunds, { charge: charge.id });
    const confirmed = refunds.filter(refund => refund.status === 'succeeded').reduce((sum, refund) => sum + refund.amount, 0);
    const pending = refunds.filter(refund => ['pending', 'requires_action'].includes(refund.status)).reduce((sum, refund) => sum + refund.amount, 0);
    return { confirmed, pending, available: charge.paid && !charge.disputed ? Math.max(0, charge.amount_captured - confirmed - pending) : 0 };
  };
  const snapshot = async upstream => {
    const charges = await chargesFor(upstream);
    let refundedCents = 0, pendingRefundCents = 0, refundableCents = 0, feeMismatch = false;
    for (const charge of charges) {
      const fee = typeof charge.application_fee === 'string' ? await stripe.applicationFees.retrieve(charge.application_fee) : charge.application_fee;
      if ((fee?.amount || 0) !== invoiceFeeCents(charge.amount_captured)) feeMismatch = true;
      const { confirmed, pending, available } = await refundsFor(charge);
      refundedCents += confirmed;
      pendingRefundCents += pending;
      refundableCents += available;
    }
    const destination = idOf(upstream.transfer_data?.destination);
    if (feeMismatch) await collection.updateOne({ accountId: destination, mode }, { $set: { feeMismatch: true, checkedAt: now() } });
    return { accountId: destination, stripeInvoiceId: upstream.id,
      hostedInvoiceUrl: upstream.hosted_invoice_url ? safeStripeUrl(upstream.hosted_invoice_url, ['invoice.stripe.com']) : null,
      amountPaidCents: upstream.amount_paid, amountRemainingCents: upstream.amount_remaining,
      creditCents: Math.max(0, upstream.total - upstream.amount_paid - upstream.amount_remaining),
      refundedCents, pendingRefundCents, refundableCents, feeMismatch, currency: upstream.currency, status: upstream.status,
      disputed: charges.some(charge => charge.disputed), providerNumber: upstream.number || null };
  };
  const provider = {
    livemode: mode === 'live',
    async settings(owner) {
      await active(owner);
      const common = { available: readyToOnboard(), ready: false, connected: false, onboardingComplete: false, livemode: mode === 'live', feePercent: 5,
        offlinePaymentsSupported: 'full-only', reverseOfflineSupported: false, supportedCurrencies: ['USD'], minimumOnlineCents: 50, country: 'US' };
      if (!readyToOnboard()) return { ...common, reason: mode === 'live' ? 'Live invoice payments need to finish setup.' : 'Stripe invoice payments are not configured yet.' };
      if (!(await verifyPlatform())) return { ...common, available: false, reason: 'The Stripe payment account needs a configuration review.' };
      const record = await mapping(owner);
      if (!record?.accountId) return { ...common, reason: 'Connect a U.S. payment account to receive your lesson payments.' };
      const account = await retrieveAccount(record.accountId);
      const onboardingComplete = accountReady(account);
      return { ...common, connected: true, onboardingComplete, ready: readyToCollect() && onboardingComplete && !record.feeMismatch,
        accountLabel: account.display_name || 'Your payment account',
        reason: record.feeMismatch ? 'Your payment account needs a fee review before creating another online invoice.' : !onboardingComplete ? 'Finish the Stripe account details to receive payments.' : !readyToCollect() ? 'Your payment account is connected. Online invoice payments are not active yet.' : null };
    },
    connect(owner) {
      return serial(owner, async () => {
        await active(owner);
        await requireOnboarding();
        let record = await mapping(owner);
        if (!record) {
          try { await collection.insertOne({ _id: mappingId(owner), ownerId: owner, mode, accountId: null, createdAt: now() }); }
          catch (error) { if (error.code !== 11000) throw error; }
          record = await mapping(owner);
        }
        if (!record.accountId) {
          if (now().getTime() - new Date(record.createdAt).getTime() > 23 * 3600000) fail(409, 'This payment setup needs a Stripe review before creating another account.');
          const tutor = await accounts.tutorById(owner);
          if (!tutor) fail(403, 'This teacher account is unavailable.');
          if (!record.createParams) {
            const createParams = { contact_email: tutor.email, display_name: tutor.name || tutor.email,
            identity: { country: 'us' }, dashboard: 'express',
            defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
            configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
            metadata: { mpt_owner: owner, mpt_mode: mode },
            };
            await collection.updateOne({ _id: mappingId(owner), createParams: { $exists: false } }, { $set: { createParams } });
            record = await mapping(owner);
          }
          const account = await stripe.v2.core.accounts.create(record.createParams, { idempotencyKey: `mpt-connect-${mode}-${owner}` });
          await collection.updateOne({ _id: mappingId(owner), accountId: null }, { $set: { accountId: account.id, updatedAt: now() } });
          record = await mapping(owner);
          if (record.accountId !== account.id) fail(409, 'Payment setup changed. Reload before continuing.');
          await collection.updateOne({ _id: record._id }, { $set: { createParams: null } });
          await active(owner);
        }
        const link = await stripe.v2.core.accountLinks.create({ account: record.accountId,
          use_case: { type: 'account_onboarding', account_onboarding: {
            refresh_url: new URL('/invoices?connect=refresh', base).href, return_url: new URL('/invoices?connect=returned', base).href,
          } },
        });
        return { url: safeStripeUrl(link.url, ['stripe.com']) };
      });
    },
    async dashboard(owner) {
      await active(owner);
      await requireOnboarding();
      const record = await accountFor(owner);
      const link = await stripe.v2.core.accountLinks.create({ account: record.accountId,
        use_case: { type: 'account_dashboard', account_dashboard: { refresh_url: new URL('/invoices?dashboard=refresh', base).href } },
      });
      return { url: safeStripeUrl(link.url, ['stripe.com']) };
    },
    async issue({ ownerId, invoice, idempotencyKey }) {
      const settings = await provider.settings(ownerId);
      if (!settings.ready) fail(409, settings.reason || 'Finish payment setup first.');
      if (invoice.currency !== 'USD') fail(400, 'Online invoice payments currently support USD. Other currencies can use recorded payments.');
      if (invoice.totalCents < 50) fail(400, 'Online invoices need a total of at least $0.50.');
      const record = await accountFor(ownerId);
      let progress = await operation('issue', idempotencyKey, { operation: 'issue', ownerId, invoiceId: invoice.id,
        input: { name: invoice.recipientName, email: invoice.recipientEmail, address: invoice.recipientAddress, number: invoice.number,
          senderName: invoice.senderName, dueDate: invoice.dueDate, timeZone: invoice.timeZone || 'UTC', issuedAt: invoice.issuedAt, lines: invoice.lines, totalCents: invoice.totalCents, notes: invoice.notes } });
      if (progress.complete) return snapshot(await stripe.invoices.retrieve(progress.stripeInvoiceId));
      const customer = progress.customerId ? { id: progress.customerId } : await stripe.customers.create({ name: invoice.recipientName, ...(invoice.recipientEmail ? { email: invoice.recipientEmail } : {}),
        ...(invoice.recipientAddress ? { address: { line1: invoice.recipientAddress.slice(0, 300), ...(invoice.recipientAddress.length > 300 ? { line2: invoice.recipientAddress.slice(300) } : {}) } } : {}),
        metadata: { mpt_invoice: invoice.id } }, { idempotencyKey: `${idempotencyKey}-customer` });
      await checkpoint(progress, { customerId: customer.id });
      const due = Math.max(Math.floor(new Date(invoice.issuedAt).getTime() / 1000) + 60,
        Math.floor(Date.parse(scheduleInstant(invoice.dueDate, '23:59', invoice.timeZone || 'UTC').instant) / 1000));
      const draft = progress.stripeInvoiceId ? { id: progress.stripeInvoiceId } : await stripe.invoices.create({ customer: customer.id, collection_method: 'send_invoice', auto_advance: false,
        currency: 'usd', due_date: due, pending_invoice_items_behavior: 'exclude',
        description: `Tutoring with ${invoice.senderName}`, custom_fields: [{ name: 'Lesson invoice', value: invoice.number }, { name: 'Teacher', value: invoice.senderName.slice(0, 140) }],
        ...(invoice.notes ? { footer: invoice.notes.slice(0, 5000) } : {}),
        // The verified platform pricing rule applies 5% to the actual captured
        // payment, including adjusted balances. An explicit amount overrides it.
        transfer_data: { destination: record.accountId },
        metadata: { mpt_invoice: invoice.id, mpt_payment_kind: 'lesson' },
      }, { idempotencyKey: `${idempotencyKey}-invoice` });
      await checkpoint(progress, { stripeInvoiceId: draft.id });
      // Explicit invoice= prevents collecting unrelated pending family charges.
      for (const [index, line] of invoice.lines.entries()) {
        if (progress.linesDone?.includes(index)) continue;
        await stripe.invoiceItems.create({ customer: customer.id, invoice: draft.id,
        amount: line.unitCents * line.quantity, currency: 'usd', description: `${line.description}${line.quantity === 1 ? '' : ` (${line.quantity} × ${(line.unitCents / 100).toFixed(2)})`}`,
      }, { idempotencyKey: `${idempotencyKey}-line-${index}` });
        await checkpoint(progress, { linesDone: [...(progress.linesDone || []), index] });
      }
      const finalized = await stripe.invoices.finalizeInvoice(draft.id, { auto_advance: false }, { idempotencyKey: `${idempotencyKey}-finalize` });
      await checkpoint(progress, { complete: true, input: null });
      // Finalization creates a payment link; no sendInvoice/charge call is made.
      return snapshot(finalized);
    },
    async sync({ ownerId, invoice }) { return snapshot(await verifiedInvoice(ownerId, invoice)); },
    async void({ ownerId, invoice, idempotencyKey }) {
      let upstream = await verifiedInvoice(ownerId, invoice);
      if (upstream.amount_paid > 0 && upstream.status !== 'void') throw Object.assign(new Error('This invoice has payments. Close its remaining balance in Stripe before removing the invoice or account.'), { status: 409, noSideEffect: true });
      if (upstream.status === 'draft') {
        await stripe.invoices.del(upstream.id);
        return { accountId: idOf(upstream.transfer_data.destination), stripeInvoiceId: upstream.id, amountPaidCents: 0, refundedCents: 0, refundableCents: 0, currency: upstream.currency, status: 'void' };
      }
      if (['open', 'uncollectible'].includes(upstream.status)) upstream = await stripe.invoices.voidInvoice(upstream.id, {}, { idempotencyKey });
      else if (upstream.status !== 'void') throw Object.assign(new Error('This online invoice has payments or is no longer open. Refresh it before continuing.'), { status: 409, noSideEffect: true });
      return snapshot(upstream);
    },
    async recordOffline({ ownerId, invoice, payment, idempotencyKey }) {
      let upstream = await verifiedInvoice(ownerId, invoice);
      const prior = await collection.findOne({ _id: operationId('offline', idempotencyKey) });
      if (!prior && (upstream.status !== 'open' || payment.amountCents !== upstream.amount_remaining)) throw Object.assign(new Error('Refresh this invoice. Record the full remaining balance when it is paid outside the app.'), { status: 409, noSideEffect: true });
      const progress = await operation('offline', idempotencyKey, { operation: 'offline', ownerId, invoiceId: invoice.id, payment });
      if (progress.complete) return snapshot(upstream);
      // Even if a previous attempt paid it, repeat the same idempotent request.
      // A different family's online payment must not become a fictional cash receipt.
      upstream = await stripe.invoices.pay(upstream.id, { paid_out_of_band: true }, { idempotencyKey });
      await checkpoint(progress, { complete: true, payment: null });
      return snapshot(upstream);
    },
    async refund({ ownerId, invoice, amountCents, idempotencyKey }) {
      const upstream = await verifiedInvoice(ownerId, invoice);
      const progress = await operation('refund', idempotencyKey, { operation: 'refund', ownerId, invoiceId: invoice.id, amountCents });
      if (progress.complete) return snapshot(upstream);
      if (!progress.plan) {
        const charges = await chargesFor(upstream);
        const remainingByCharge = await Promise.all(charges.map(refundsFor));
        const available = remainingByCharge.reduce((sum, item) => sum + item.available, 0);
        if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > available) {
          const error = Object.assign(new Error('Refresh this invoice before refunding its available online payment.'), { status: 409 });
          if (!progress.requestStarted) error.noSideEffect = true;
          throw error;
        }
        let remaining = amountCents; const plan = [];
        for (const [index, charge] of charges.entries()) {
          if (!remaining) break;
          const amount = Math.min(remaining, remainingByCharge[index].available);
          if (amount <= 0) continue;
          plan.push({ charge: charge.id, amount, reverse_transfer: true, ...(charge.application_fee ? { refund_application_fee: true } : {}) });
          remaining -= amount;
        }
        await checkpoint(progress, { plan });
      }
      await checkpoint(progress, { requestStarted: true });
      for (const item of progress.plan) await stripe.refunds.create(item, { idempotencyKey: `${idempotencyKey}-${item.charge}` });
      await checkpoint(progress, { complete: true });
      return snapshot(await stripe.invoices.retrieve(upstream.id));
    },
    event(raw, signature) {
      if (!webhookSecret) throw new Error('Invoice webhook is not configured.');
      return stripe.webhooks.constructEvent(raw, signature, webhookSecret);
    },
    connectEvent(raw, signature) {
      if (!connectWebhookSecret) throw new Error('Connect webhook is not configured.');
      return stripe.parseEventNotification(raw, signature, connectWebhookSecret);
    },
    async handleConnect(event) {
      if (!event.type?.startsWith('v2.core.account')) return;
      const accountId = event.related_object?.id;
      if (!accountId) return;
      const record = await collection.findOne({ accountId, mode });
      if (!record) return;
      const account = await retrieveAccount(accountId);
      await collection.updateOne({ _id: record._id }, { $set: { ready: accountReady(account), checkedAt: now() } });
    },
    async handle(event, invoices) {
      if (event.livemode !== (mode === 'live') || event.account) return;
      const object = event.data?.object;
      const ids = [];
      if (invoiceEvents.has(event.type) && object?.id) ids.push(object.id);
      else if (creditEvents.has(event.type) && object?.invoice) ids.push(idOf(object.invoice));
      else if (chargeEvents.has(event.type)) {
        const dispute = event.type.startsWith('charge.dispute.') ? await stripe.disputes.retrieve(object.id) : null;
        const charge = await stripe.charges.retrieve(idOf(dispute?.charge || (event.type.startsWith('refund.') ? object.charge : object.id)));
        const paymentIntent = idOf(charge.payment_intent);
        if (paymentIntent) {
          const payments = await all(stripe.invoicePayments, { payment: { type: 'payment_intent', payment_intent: paymentIntent } });
          ids.push(...payments.map(payment => idOf(payment.invoice)));
        }
        if (dispute) await provider.trackDispute(dispute, charge);
      } else return;
      for (const id of new Set(ids.filter(Boolean))) {
        const upstream = await stripe.invoices.retrieve(id);
        const destination = idOf(upstream.transfer_data?.destination);
        if (!destination) continue;
        const owned = await invoices.findProviderInvoice(destination, upstream.id);
        if (owned) await invoices.sync(owned.ownerId, owned.id);
      }
    },
    async trackDispute(dispute, charge) {
      // Only our mapped teacher destinations may affect the recovery ledger.
      const destination = idOf(charge.transfer_data?.destination);
      if (!destination) return;
      const record = await collection.findOne({ accountId: destination, mode });
      if (!record) return;
      const disputeId = `dispute:${mode}:${dispute.id}`;
      let previous = await collection.findOne({ _id: disputeId });
      if (!previous) {
        try { await collection.insertOne({ _id: disputeId, kind: 'dispute', mode, disputeId: dispute.id, ownerId: record.ownerId, destination, chargeId: charge.id, transferId: idOf(charge.transfer), amountCents: dispute.amount, currency: dispute.currency, createdAt: now() }); }
        catch (error) { if (error.code !== 11000) throw error; }
        previous = await collection.findOne({ _id: disputeId });
      }
      await collection.updateOne({ _id: disputeId }, { $set: { status: dispute.status, dueBy: dispute.evidence_details?.due_by || null, updatedAt: now() } });
      // Recovery is a separate, explicit owner action. A notification records the
      // liability; it must not silently debit a teacher's existing bank balance.
    },
    async disputes() {
      const records = await collection.find({ mode, kind: 'dispute' }).limit(2000).toArray();
      return Promise.all(records.filter(record => record.disputeId).map(async record => {
        const tutor = await accounts.tutorById(record.ownerId);
        return { id: record.disputeId, ownerId: record.ownerId, ownerName: tutor?.name || null, ownerEmail: tutor?.email || null,
          amountCents: record.amountCents, currency: record.currency, status: record.status, dueBy: record.dueBy,
          dashboardUrl: `https://dashboard.stripe.com/${mode === 'test' ? 'test/' : ''}payments/${record.chargeId}` };
      }));
    },
    async scrubOwner(owner) {
      // Retain opaque Stripe references for financial reconciliation, while
      // removing duplicate contact data and notes after account deletion.
      await collection.updateMany({ ownerId: owner, mode }, { $set: { input: null, createParams: null, payment: null, detached: true } });
    },
  };
  return provider;
}

export function connectInvoicePayments({ uri = process.env.MONGODB_URI, secretKey = process.env.STRIPE_INVOICE_SECRET_KEY,
  webhookSecret = process.env.STRIPE_INVOICE_WEBHOOK_SECRET, connectWebhookSecret = process.env.STRIPE_INVOICE_CONNECT_WEBHOOK_SECRET,
  accounts, stripe: client, origin = process.env.INVOICE_PUBLIC_ORIGIN || 'http://localhost:3000',
  liveEnabled = process.env.STRIPE_INVOICE_LIVE_ENABLED === 'true', pricingVerified = process.env.STRIPE_INVOICE_PRICING_VERIFIED === 'true', taxMode = process.env.STRIPE_INVOICE_TAX_MODE || 'none' } = {}) {
  if (!uri || !accounts || (!secretKey && !client)) return null;
  return createInvoicePayments({ stripe: client || new Stripe(secretKey, { apiVersion: '2026-11-18.endive', maxNetworkRetries: 2 }),
    collection: mongoClient(uri).db(DATABASE).collection('teacherPaymentAccounts'), accounts, mode: stripeMode(secretKey), webhookSecret, connectWebhookSecret, origin, liveEnabled, pricingVerified,
    platformAccountId: process.env.STRIPE_INVOICE_PLATFORM_ACCOUNT || null, pricingMode: process.env.STRIPE_INVOICE_PRICING_MODE || null, taxMode });
}
