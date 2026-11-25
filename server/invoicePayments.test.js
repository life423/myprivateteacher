import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createInvoicePayments, invoiceFeeCents } from './invoicePayments.js';
import { installInvoicePaymentRoutes } from './invoicePaymentRoutes.js';
import { memoryLessonCollection } from './lessonFixtures.js';

const copy = value => structuredClone(value);
const invoice = (patch = {}) => ({ id: 'invoice-a', number: 'INV-2026-0001', recipientName: 'Fixture family', recipientEmail: 'family@example.test',
  senderName: 'Fixture teacher', currency: 'USD', totalCents: 10000, dueDate: '2026-11-30', issuedAt: Date.parse('2026-11-24T12:00:00Z'),
  lines: [{ description: 'Tutoring lesson', quantity: 1, unitCents: 10000 }], ...patch });

function fixture(options = {}) {
  const collection = memoryLessonCollection();
  collection.records.set('test:tutor-a', { _id: 'test:tutor-a', mode: 'test', ownerId: 'tutor-a', accountId: 'acct_teacher_a' });
  const upstream = { id: 'in_fixture', currency: 'usd', total: 10000, amount_paid: 0, amount_remaining: 10000, amount_paid_off_stripe: 0, livemode: false,
    transfer_data: { destination: 'acct_teacher_a' }, metadata: { mpt_invoice: 'invoice-a' }, status: 'open',
    hosted_invoice_url: 'https://invoice.stripe.com/i/fixture', number: 'FIXTURE-0001' };
  const charges = new Map(), refundResponses = new Map(), offlineResponses = new Map(), refundRecords = [];
  const stripe = {
    accounts: { retrieve: vi.fn(async () => ({ id: 'acct_platform_fixture', country: 'US' })) },
    v2: { core: {
      accounts: { retrieve: vi.fn(async id => ({ id, display_name: 'Fixture teacher', configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: 'active' } } } } } })),
        create: vi.fn(async params => ({ id: `acct_${params.metadata.mpt_owner}`, ...copy(params) })) },
      accountLinks: { create: vi.fn(async () => ({ url: 'https://connect.stripe.com/setup/fixture' })) },
    } },
    customers: { create: vi.fn(async () => ({ id: 'cus_fixture' })) },
    invoices: {
      create: vi.fn(async () => ({ ...copy(upstream), status: 'draft' })),
      retrieve: vi.fn(async () => copy(upstream)),
      finalizeInvoice: vi.fn(async () => copy(upstream)),
      voidInvoice: vi.fn(async () => { upstream.status = 'void'; return copy(upstream); }),
      pay: vi.fn(async (_id, _params, { idempotencyKey }) => {
        if (offlineResponses.has(idempotencyKey)) return copy(offlineResponses.get(idempotencyKey));
        upstream.amount_paid_off_stripe += upstream.amount_remaining; upstream.amount_paid += upstream.amount_remaining; upstream.amount_remaining = 0; upstream.status = 'paid';
        offlineResponses.set(idempotencyKey, copy(upstream)); return copy(upstream);
      }),
    },
    invoiceItems: { create: vi.fn(async () => ({ id: 'ii_fixture' })) },
    invoicePayments: { list: vi.fn(async () => ({ data: [], has_more: false })) },
    paymentIntents: { retrieve: vi.fn(async id => ({ id, latest_charge: 'ch_fixture' })) },
    charges: { retrieve: vi.fn(async id => copy(charges.get(id))) },
    refunds: { list: vi.fn(async params => ({ data: copy(refundRecords.filter(refund => refund.charge === params.charge)), has_more: false })), create: vi.fn(async (params, { idempotencyKey }) => {
      if (refundResponses.has(idempotencyKey)) return copy(refundResponses.get(idempotencyKey));
      const charge = charges.get(params.charge); charge.amount_refunded += params.amount;
      const response = { id: 're_fixture', status: 'succeeded', ...copy(params) }; refundResponses.set(idempotencyKey, response); refundRecords.push(response); return copy(response);
    }) },
    webhooks: { constructEvent: vi.fn() }, parseEventNotification: vi.fn(),
  };
  const accounts = { isActive: vi.fn(async owner => owner === 'tutor-a' || owner === 'tutor-b'), tutorById: vi.fn(async owner => ({ id: owner, name: owner, email: `${owner}@example.test` })) };
  const provider = createInvoicePayments({ stripe, collection, accounts, mode: 'test', webhookSecret: 'fixture-invoice-signing-secret',
    connectWebhookSecret: 'fixture-connect-signing-secret', origin: 'http://localhost:3000', pricingVerified: true, platformAccountId: 'acct_platform_fixture', pricingMode: 'test',
    now: () => new Date('2026-11-24T12:00:00Z'), ...options });
  const paidCharge = (patch = {}) => {
    const charge = { id: 'ch_fixture', currency: 'usd', livemode: false, paid: true, disputed: false, amount_captured: 10000, amount_refunded: 0,
      transfer_data: { destination: 'acct_teacher_a' }, transfer: 'tr_fixture', payment_intent: 'pi_fixture', application_fee: { id: 'fee_fixture', amount: 500 }, ...patch };
    charges.set(charge.id, charge);
    stripe.invoicePayments.list.mockResolvedValue({ data: [{ id: 'inpay_fixture', invoice: upstream.id, status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_fixture' } }], has_more: false });
    upstream.status = 'paid'; upstream.amount_paid = 10000; upstream.amount_remaining = 0;
    if (charge.amount_refunded) refundRecords.push({ id: 're_prior', charge: charge.id, amount: charge.amount_refunded, status: 'succeeded' });
    return charge;
  };
  return { provider, stripe, collection, accounts, upstream, charges, paidCharge, refundRecords,
    local: invoice({ online: { accountId: 'acct_teacher_a', stripeInvoiceId: 'in_fixture' } }) };
}

describe('teacher Stripe invoice adapter', () => {
  it('uses integer fee arithmetic and rejects unsupported amounts', () => {
    expect([0, 1, 9, 10, 19, 20, 999, 10000, 100000000].map(invoiceFeeCents)).toEqual([0, 0, 0, 1, 1, 1, 50, 500, 5000000]);
    for (const amount of [-1, 1.1, NaN, Infinity, 100000001]) expect(() => invoiceFeeCents(amount)).toThrow();
  });

  it.each([{ webhookSecret: null }, { connectWebhookSecret: null }])('requires both webhook configurations before onboarding or issuing: %j', async options => {
    const missing = fixture(options);
    expect(await missing.provider.settings('tutor-a')).toMatchObject({ available: false, ready: false, livemode: false });
    await expect(missing.provider.connect('tutor-a')).rejects.toMatchObject({ status: 409 });
    await expect(missing.provider.dashboard('tutor-a')).rejects.toMatchObject({ status: 409 });
    await expect(missing.provider.issue({ ownerId: 'tutor-a', invoice: invoice(), idempotencyKey: 'missing-notifications' })).rejects.toMatchObject({ status: 409 });
    expect(missing.stripe.v2.core.accounts.create).not.toHaveBeenCalled();
    expect(missing.stripe.v2.core.accountLinks.create).not.toHaveBeenCalled();
    expect(missing.stripe.customers.create).not.toHaveBeenCalled();
    expect(missing.stripe.invoices.create).not.toHaveBeenCalled();
  });

  it.each([
    { liveEnabled: false, pricingVerified: false },
    { liveEnabled: false, pricingVerified: true },
    { liveEnabled: true, pricingVerified: false },
    { liveEnabled: true, pricingVerified: true, taxMode: 'unverified' },
  ])('allows verified live-account onboarding and dashboard access while collection stays blocked: %j', async collectionOptions => {
    const { provider, stripe } = fixture({ mode: 'live', pricingMode: 'live', origin: 'https://myprivateteacher.com', taxMode: 'none', ...collectionOptions });
    expect(await provider.settings('tutor-b')).toMatchObject({ available: true, ready: false, connected: false, onboardingComplete: false, livemode: true, feePercent: 5 });
    await provider.connect('tutor-b');
    expect(stripe.v2.core.accounts.create).toHaveBeenCalledTimes(1);
    expect(stripe.v2.core.accountLinks.create).toHaveBeenLastCalledWith(expect.objectContaining({
      account: 'acct_tutor-b', use_case: { type: 'account_onboarding', account_onboarding: {
        refresh_url: 'https://myprivateteacher.com/invoices?connect=refresh', return_url: 'https://myprivateteacher.com/invoices?connect=returned',
      } },
    }));
    expect(await provider.settings('tutor-b')).toMatchObject({ available: true, connected: true, onboardingComplete: true, ready: false,
      reason: 'Your payment account is connected. Online invoice payments are not active yet.' });
    await provider.dashboard('tutor-b');
    expect(stripe.v2.core.accountLinks.create).toHaveBeenLastCalledWith({ account: 'acct_tutor-b',
      use_case: { type: 'account_dashboard', account_dashboard: { refresh_url: 'https://myprivateteacher.com/invoices?dashboard=refresh' } } });
    await expect(provider.issue({ ownerId: 'tutor-b', invoice: invoice(), idempotencyKey: 'collection-off' })).rejects.toMatchObject({ status: 409 });
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.invoices.create).not.toHaveBeenCalled();
    expect(stripe.invoiceItems.create).not.toHaveBeenCalled();
    expect(stripe.invoices.finalizeInvoice).not.toHaveBeenCalled();
  });

  it('keeps an incomplete recipient account connected but unable to collect', async () => {
    const { provider, stripe } = fixture();
    stripe.v2.core.accounts.retrieve.mockResolvedValue({ id: 'acct_teacher_a', display_name: 'Fixture teacher',
      configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: 'pending' } } } } } });
    expect(await provider.settings('tutor-a')).toMatchObject({ available: true, connected: true, onboardingComplete: false, ready: false,
      reason: 'Finish the Stripe account details to receive payments.' });
    await expect(provider.issue({ ownerId: 'tutor-a', invoice: invoice(), idempotencyKey: 'incomplete-recipient' })).rejects.toMatchObject({ status: 409 });
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.invoices.create).not.toHaveBeenCalled();
  });

  it('allows online issuance only after verified live setup, pricing, activation and recipient readiness are all complete', async () => {
    const { provider, stripe, upstream } = fixture({ mode: 'live', pricingMode: 'live', origin: 'https://myprivateteacher.com', liveEnabled: true, pricingVerified: true, taxMode: 'none' });
    await provider.connect('tutor-b');
    upstream.livemode = true; upstream.transfer_data.destination = 'acct_tutor-b';
    expect(await provider.settings('tutor-b')).toMatchObject({ available: true, connected: true, onboardingComplete: true, ready: true, reason: null });
    await provider.issue({ ownerId: 'tutor-b', invoice: invoice(), idempotencyKey: 'verified-live-fixture' });
    expect(stripe.customers.create).toHaveBeenCalledTimes(1);
    expect(stripe.invoices.create).toHaveBeenCalledWith(expect.objectContaining({ transfer_data: { destination: 'acct_tutor-b' } }), expect.any(Object));
    expect(stripe.invoices.finalizeInvoice).toHaveBeenCalledTimes(1);
  });

  it('rejects unavailable teachers before any Stripe read or account creation', async () => {
    const { provider, stripe } = fixture();
    await expect(provider.settings('other-owner')).rejects.toMatchObject({ status: 403 });
    await expect(provider.connect('other-owner')).rejects.toMatchObject({ status: 403 });
    expect(stripe.v2.core.accounts.retrieve).not.toHaveBeenCalled(); expect(stripe.v2.core.accounts.create).not.toHaveBeenCalled();
  });

  it.each([{ pricingMode: 'live' }, { platformAccountId: null }, { platformAccountId: 'acct_wrong_platform' },
    { mode: 'live', pricingMode: 'live', origin: 'http://localhost:3000', liveEnabled: true }])('blocks setup and collection when account/mode/origin verification fails: %j', async options => {
    const { provider, stripe } = fixture(options);
    expect(await provider.settings('tutor-a')).toMatchObject({ available: false, ready: false });
    await expect(provider.issue({ ownerId: 'tutor-a', invoice: invoice(), idempotencyKey: 'wrong-configuration' })).rejects.toMatchObject({ status: 409 });
    expect(stripe.invoices.create).not.toHaveBeenCalled();
    await expect(provider.connect('tutor-b')).rejects.toMatchObject({ status: 409 });
    await expect(provider.dashboard('tutor-a')).rejects.toMatchObject({ status: 409 });
    expect(stripe.v2.core.accounts.create).not.toHaveBeenCalled();
    expect(stripe.v2.core.accountLinks.create).not.toHaveBeenCalled();
  });

  it('requires a verified U.S. platform even when the rest of collection setup is complete', async () => {
    const { provider, stripe } = fixture();
    stripe.accounts.retrieve.mockResolvedValue({ id: 'acct_platform_fixture', country: 'CA' });
    expect(await provider.settings('tutor-a')).toMatchObject({ available: false, ready: false, connected: false });
    await expect(provider.connect('tutor-b')).rejects.toMatchObject({ status: 409 });
    await expect(provider.dashboard('tutor-a')).rejects.toMatchObject({ status: 409 });
    await expect(provider.issue({ ownerId: 'tutor-a', invoice: invoice(), idempotencyKey: 'wrong-country' })).rejects.toMatchObject({ status: 409 });
    expect(stripe.v2.core.accounts.create).not.toHaveBeenCalled();
    expect(stripe.v2.core.accountLinks.create).not.toHaveBeenCalled();
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.invoices.create).not.toHaveBeenCalled();
  });

  it('rejects non-HTTP local return links instead of treating them as a development origin', () => {
    expect(() => fixture({ origin: 'ftp://localhost' })).toThrow('Invoice return links require HTTPS.');
  });

  it('reuses the server-owned account and never accepts a caller-supplied destination or return site', async () => {
    const { provider, stripe, collection } = fixture();
    const first = await provider.connect('tutor-b', { accountId: 'acct_attacker', returnPath: 'https://attacker.example' });
    await provider.connect('tutor-b');
    expect(first.url).toBe('https://connect.stripe.com/setup/fixture');
    expect(stripe.v2.core.accounts.create).toHaveBeenCalledTimes(1);
    expect((await collection.findOne({ _id: 'test:tutor-b' })).accountId).toBe('acct_tutor-b');
    for (const [params] of stripe.v2.core.accountLinks.create.mock.calls) {
      expect(params.account).toBe('acct_tutor-b');
      expect(params.use_case.account_onboarding.return_url).toBe('http://localhost:3000/invoices?connect=returned');
    }
  });

  it('issues only USD invoices above the minimum and creates an explicit hosted invoice without sending it', async () => {
    const { provider, stripe } = fixture();
    await expect(provider.issue({ ownerId: 'tutor-a', invoice: invoice({ currency: 'EUR' }), idempotencyKey: 'eur' })).rejects.toMatchObject({ status: 400 });
    await expect(provider.issue({ ownerId: 'tutor-a', invoice: invoice({ totalCents: 49 }), idempotencyKey: 'small' })).rejects.toMatchObject({ status: 400 });
    expect(stripe.customers.create).not.toHaveBeenCalled();
    const result = await provider.issue({ ownerId: 'tutor-a', invoice: invoice(), idempotencyKey: 'issue-a' });
    expect(result).toMatchObject({ accountId: 'acct_teacher_a', stripeInvoiceId: 'in_fixture', amountPaidCents: 0, status: 'open' });
    expect(stripe.invoices.create.mock.calls[0][0]).toMatchObject({ auto_advance: false, collection_method: 'send_invoice', pending_invoice_items_behavior: 'exclude',
      transfer_data: { destination: 'acct_teacher_a' } });
    expect(stripe.invoices.create.mock.calls[0][0].transfer_data).not.toHaveProperty('amount');
    expect(stripe.invoiceItems.create.mock.calls[0][0]).toMatchObject({ invoice: 'in_fixture', customer: 'cus_fixture', amount: 10000, currency: 'usd' });
    expect(stripe.invoices.finalizeInvoice).toHaveBeenCalledWith('in_fixture', { auto_advance: false }, expect.objectContaining({ idempotencyKey: expect.any(String) }));
    expect(JSON.stringify(stripe.invoices.create.mock.calls)).not.toContain('payment_method_types');
  });

  it.each([
    ['live/test mode', { livemode: true }], ['another teacher', { transfer_data: { destination: 'acct_other' } }],
    ['currency', { currency: 'eur' }], ['total', { total: 10001 }], ['invoice metadata', { metadata: { mpt_invoice: 'another-local-invoice' } }],
  ])('refuses to synchronize a provider invoice with mismatched %s', async (_name, patch) => {
    const { provider, upstream, local, stripe } = fixture(); Object.assign(upstream, patch);
    await expect(provider.sync({ ownerId: 'tutor-a', invoice: local })).rejects.toMatchObject({ status: 409 });
    expect(stripe.invoicePayments.list).not.toHaveBeenCalled();
  });

  it('returns paid and refundable totals from retrieved charge records rather than webhook amounts', async () => {
    const { provider, paidCharge, local, stripe } = fixture(); paidCharge({ amount_refunded: 1250 });
    const result = await provider.sync({ ownerId: 'tutor-a', invoice: local });
    expect(result).toMatchObject({ amountPaidCents: 10000, refundedCents: 1250, refundableCents: 8750, disputed: false });
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_fixture'); expect(stripe.charges.retrieve.mock.calls.map(call => call[0])).toContain('ch_fixture');
  });

  it('preserves the actual payment ledger but blocks future online issuance after a platform-fee mismatch', async () => {
    const { provider, paidCharge, local, stripe } = fixture(); paidCharge({ application_fee: { id: 'fee_wrong', amount: 0 } });
    expect(await provider.sync({ ownerId: 'tutor-a', invoice: local })).toMatchObject({ amountPaidCents: 10000, feeMismatch: true });
    expect(await provider.settings('tutor-a')).toMatchObject({ ready: false });
    await expect(provider.issue({ ownerId: 'tutor-a', invoice: invoice({ id: 'another-invoice' }), idempotencyKey: 'fee-mismatch' })).rejects.toMatchObject({ status: 409 });
    expect(stripe.invoices.create).not.toHaveBeenCalled();
  });

  it.each([
    { paid: 6000, remaining: 4000, credit: 0 },
    { paid: 8000, remaining: 0, credit: 2000 },
  ])('checks the fee against the captured payment after a partial payment or credit: %j', async ({ paid, remaining, credit }) => {
    const { provider, paidCharge, local, upstream } = fixture();
    paidCharge({ amount_captured: paid, application_fee: { id: 'fee_adjusted', amount: invoiceFeeCents(paid) } });
    Object.assign(upstream, { amount_paid: paid, amount_remaining: remaining, amount_due: paid + remaining, status: remaining ? 'open' : 'paid' });
    expect(await provider.sync({ ownerId: 'tutor-a', invoice: local })).toMatchObject({ amountPaidCents: paid, amountRemainingCents: remaining, creditCents: credit, feeMismatch: false });
    expect(await provider.settings('tutor-a')).toMatchObject({ ready: true });
  });

  it('reverses the associated transfer for refunds and excludes disputed funds', async () => {
    const { provider, paidCharge, local, stripe } = fixture(); const charge = paidCharge();
    const refunded = await provider.refund({ ownerId: 'tutor-a', invoice: local, amountCents: 2500, idempotencyKey: 'refund-a' });
    expect(stripe.refunds.create.mock.calls[0][0]).toEqual({ charge: 'ch_fixture', amount: 2500, reverse_transfer: true, refund_application_fee: true });
    expect(refunded.refundedCents).toBe(2500);
    charge.disputed = true;
    await expect(provider.refund({ ownerId: 'tutor-a', invoice: local, amountCents: 1, idempotencyKey: 'refund-b' })).rejects.toMatchObject({ status: 409 });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a completed refund POST after its Stripe idempotency key may have expired', async () => {
    let clock = new Date('2026-11-24T12:00:00Z');
    const { provider, paidCharge, local, stripe } = fixture({ now: () => clock }); paidCharge();
    const request = { ownerId: 'tutor-a', invoice: local, amountCents: 2500, idempotencyKey: 'refund-durable' };
    await provider.refund(request); clock = new Date('2026-11-27T12:00:00Z');
    expect((await provider.refund(request)).refundedCents).toBe(2500);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it('reserves pending refund funds without presenting them as a completed refund', async () => {
    const { provider, paidCharge, local, refundRecords } = fixture(); paidCharge();
    refundRecords.push(
      { id: 're_done', charge: 'ch_fixture', amount: 1000, status: 'succeeded' },
      { id: 're_pending', charge: 'ch_fixture', amount: 2000, status: 'pending' },
      { id: 're_action', charge: 'ch_fixture', amount: 500, status: 'requires_action' },
      { id: 're_failed', charge: 'ch_fixture', amount: 250, status: 'failed' },
      { id: 're_canceled', charge: 'ch_fixture', amount: 250, status: 'canceled' },
    );
    expect(await provider.sync({ ownerId: 'tutor-a', invoice: local })).toMatchObject({ refundedCents: 1000, pendingRefundCents: 2500, refundableCents: 6500 });
  });

  it('keeps disputes visible after more than two thousand ordinary account or operation records', async () => {
    const { provider, collection } = fixture();
    for (let n = 0; n < 2001; n++) collection.records.set(`ordinary-${n}`, { _id: `ordinary-${n}`, mode: 'test', operation: 'issue' });
    collection.records.set('dispute:test:dp_fixture', { _id: 'dispute:test:dp_fixture', mode: 'test', kind: 'dispute', disputeId: 'dp_fixture', ownerId: 'tutor-a',
      amountCents: 10000, currency: 'usd', status: 'needs_response', dueBy: 1800000000, chargeId: 'ch_fixture' });
    expect(await provider.disputes()).toEqual([expect.objectContaining({ id: 'dp_fixture', ownerId: 'tutor-a', amountCents: 10000 })]);
  });

  it('requires review instead of retrying an unresolved refund after the safety window', async () => {
    let clock = new Date('2026-11-24T12:00:00Z');
    const { provider, paidCharge, local, stripe } = fixture({ now: () => clock }); paidCharge();
    const request = { ownerId: 'tutor-a', invoice: local, amountCents: 2500, idempotencyKey: 'refund-unresolved' };
    stripe.refunds.create.mockRejectedValueOnce(new Error('Fixture lost connection'));
    await expect(provider.refund(request)).rejects.toThrow('Fixture lost connection');
    clock = new Date('2026-11-25T12:00:00Z');
    await expect(provider.refund(request)).rejects.toMatchObject({ status: 409 });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it('does not turn a family’s already completed online payment into a new offline receipt', async () => {
    const { provider, paidCharge, local, stripe } = fixture(); paidCharge();
    await expect(provider.recordOffline({ ownerId: 'tutor-a', invoice: local, payment: { id: 'payment-new', amountCents: 10000 }, idempotencyKey: 'offline-new' })).rejects.toMatchObject({ status: 409 });
    expect(stripe.invoices.pay).not.toHaveBeenCalled();
  });

  it('retries the same recorded offline payment and rejects a changed request under its reference', async () => {
    const { provider, local, stripe } = fixture();
    const request = { ownerId: 'tutor-a', invoice: local, payment: { id: 'payment-a', amountCents: 10000 }, idempotencyKey: 'offline-a' };
    expect((await provider.recordOffline(request)).amountPaidCents).toBe(10000);
    expect((await provider.recordOffline(request)).amountPaidCents).toBe(10000);
    expect(stripe.invoices.pay).toHaveBeenCalledTimes(1);
    await expect(provider.recordOffline({ ...request, payment: { ...request.payment, amountCents: 9000 } })).rejects.toMatchObject({ status: 409 });
    expect(stripe.invoices.pay).toHaveBeenCalledTimes(1);
  });

  it('replays the exact idempotent offline request after payment succeeded but its local checkpoint failed', async () => {
    const { provider, local, stripe, collection } = fixture();
    const original = collection.updateOne.bind(collection); let loseCheckpoint = true;
    collection.updateOne = async (query, changes) => {
      if (loseCheckpoint && changes.$set?.complete === true) { loseCheckpoint = false; throw new Error('Fixture lost checkpoint'); }
      return original(query, changes);
    };
    const request = { ownerId: 'tutor-a', invoice: local, payment: { id: 'payment-lost', amountCents: 10000 }, idempotencyKey: 'offline-lost' };
    await expect(provider.recordOffline(request)).rejects.toThrow('Fixture lost checkpoint');
    expect((await provider.recordOffline(request)).amountPaidCents).toBe(10000);
    expect(stripe.invoices.pay).toHaveBeenCalledTimes(2);
    expect(stripe.invoices.pay.mock.calls[0]).toEqual(stripe.invoices.pay.mock.calls[1]);
  });

  it('never exposes a non-Stripe hosted payment URL', async () => {
    const { provider, upstream, local } = fixture(); upstream.hosted_invoice_url = 'https://invoice.stripe.com.attacker.example/pay';
    await expect(provider.sync({ ownerId: 'tutor-a', invoice: local })).rejects.toThrow('Invalid Stripe link');
  });

  it('ignores another mode or connected-account webhook and reconciles only locally mapped invoices', async () => {
    const { provider, stripe } = fixture();
    const invoices = { findProviderInvoice: vi.fn(async () => ({ ownerId: 'tutor-a', id: 'invoice-a' })), sync: vi.fn() };
    const event = { type: 'invoice.paid', livemode: false, data: { object: { id: 'in_fixture', amount_paid: 999999 } } };
    await provider.handle({ ...event, livemode: true }, invoices); await provider.handle({ ...event, account: 'acct_elsewhere' }, invoices);
    expect(stripe.invoices.retrieve).not.toHaveBeenCalled();
    await provider.handle(event, invoices);
    expect(invoices.findProviderInvoice).toHaveBeenCalledExactlyOnceWith('acct_teacher_a', 'in_fixture');
    expect(invoices.sync).toHaveBeenCalledExactlyOnceWith('tutor-a', 'invoice-a');
    invoices.findProviderInvoice.mockResolvedValue(null); invoices.sync.mockClear();
    await provider.handle(event, invoices); expect(invoices.sync).not.toHaveBeenCalled();
  });
});

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
});
async function routes(payments, tutor = null) {
  const app = express(); installInvoicePaymentRoutes({ app, payments, invoices: {}, currentTutor: async () => tutor });
  const server = http.createServer(app); servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

describe('invoice payment webhook boundary', () => {
  it('verifies the unchanged raw bytes and rejects bad signatures before reconciliation', async () => {
    const payload = '{"id":"evt_fixture", "untouched": true}';
    const payments = { event: vi.fn((raw, signature) => { expect(Buffer.isBuffer(raw)).toBe(true); expect(raw.toString()).toBe(payload); if (signature !== 'fixture-good-signature') throw new Error('Bad signature'); return { id: 'evt_fixture' }; }), handle: vi.fn() };
    const base = await routes(payments);
    expect((await fetch(`${base}/api/stripe/invoices/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 'bad' }, body: payload })).status).toBe(400);
    expect(payments.handle).not.toHaveBeenCalled();
    expect((await fetch(`${base}/api/stripe/invoices/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 'fixture-good-signature' }, body: payload })).status).toBe(200);
    expect(payments.handle).toHaveBeenCalledExactlyOnceWith({ id: 'evt_fixture' }, {});
  });

  it('keeps dispute details restricted to the site owner', async () => {
    const payments = { disputes: vi.fn(async () => [{ id: 'dp_fixture' }]) };
    const anonymous = await routes(payments); const teacher = await routes(payments, { id: 'tutor-a', roles: [] }); const owner = await routes(payments, { id: 'site-owner', roles: ['owner'] });
    expect((await fetch(`${anonymous}/api/admin/invoice-payments/disputes`)).status).toBe(401);
    expect((await fetch(`${teacher}/api/admin/invoice-payments/disputes`)).status).toBe(403);
    expect(payments.disputes).not.toHaveBeenCalled();
    expect((await fetch(`${owner}/api/admin/invoice-payments/disputes`)).status).toBe(200);
    expect(payments.disputes).toHaveBeenCalledTimes(1);
  });
});
