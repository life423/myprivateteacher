import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInvoiceRepository as createRealInvoiceRepository } from './invoices.js';
import { memoryLessonCollection } from './lessonFixtures.js';
import { createSchedulingRepository } from './scheduling.js';

const owner = 'owner-a', other = 'owner-b';
const createInvoiceRepository = options => createRealInvoiceRepository({ now: () => new Date('2026-11-24T18:00:00Z'), ...options });
const draft = (id = 'invoice-1', allowOnline = false) => ({ id, senderName: 'Tutor Example', senderDetails: 'teacher@example.test', recipientName: 'Parent Example', recipientEmail: 'parent@example.test', currency: 'USD', issueDate: '2026-11-24', dueDate: '2026-12-01', allowOnline, lines: [{ description: 'Reading lesson', quantity: 2, unitCents: 3500 }] });
const snapshot = (amountPaidCents = 0, extra = {}) => ({ accountId: 'acct_teacher', stripeInvoiceId: 'in_example', hostedInvoiceUrl: 'https://invoice.stripe.com/i/example', amountPaidCents, currency: 'usd', status: amountPaidCents === 7000 ? 'paid' : 'open', refundedCents: 0, refundableCents: amountPaidCents, ...extra });
let collection, invoices;
beforeEach(() => { collection = memoryLessonCollection(); invoices = createInvoiceRepository({ collection }); });
describe('private teacher invoice persistence', () => {
  it('isolates every operation by owner and makes create retries idempotent', async () => {
    const created = await invoices.create(owner, draft());
    expect(await invoices.create(owner, { ...draft(), recipientName: 'Must not overwrite' })).toEqual(created);
    expect(await invoices.list(other)).toEqual([]);
    for (const action of [() => invoices.get(other, created.id), () => invoices.create(other, draft()), () => invoices.save(other, created.id, { ...draft(), revision: 1 }), () => invoices.issue(other, created.id, 1), () => invoices.remove(other, created.id, 1), () => invoices.recordPayment(other, created.id, { id: 'p', amountCents: 1, date: '2026-11-24', method: 'cash', revision: 1 })]) await expect(action()).rejects.toMatchObject({ status: 404 });
  });
  it('prevents stale writes, locks issued details and preserves issued records', async () => {
    const initial = await invoices.create(owner, draft());
    const saved = await invoices.save(owner, initial.id, { ...draft(), recipientName: 'New name', revision: initial.revision });
    await expect(invoices.save(owner, initial.id, { ...draft(), revision: 1 })).rejects.toMatchObject({ status: 409 });
    const issued = await invoices.issue(owner, initial.id, saved.revision);
    expect(issued).toMatchObject({ state: 'issued', number: 'INV-2026-0001', totalCents: 7000, recipientName: 'New name' });
    await expect(invoices.save(owner, initial.id, { ...draft(), revision: issued.revision })).rejects.toMatchObject({ status: 409 });
    await expect(invoices.remove(owner, initial.id, issued.revision)).rejects.toMatchObject({ status: 409 });
    expect(await invoices.issue(owner, initial.id, saved.revision)).toEqual(issued);
  });
  it('numbers concurrent invoices uniquely across repository instances', async () => {
    const secondProcess = createInvoiceRepository({ collection });
    await invoices.create(owner, draft('first')); await invoices.create(owner, draft('second'));
    const issued = await Promise.all([invoices.issue(owner, 'first', 1), secondProcess.issue(owner, 'second', 1)]);
    expect(new Set(issued.map(invoice => invoice.number)).size).toBe(2);
  });
  it('records partial and full payments, prevents overpayment and supports correction', async () => {
    await invoices.create(owner, draft()); let current = await invoices.issue(owner, 'invoice-1', 1);
    const input = { id: 'p1', amountCents: 2000, date: '2026-11-24', method: 'cash', note: '', revision: current.revision };
    current = await invoices.recordPayment(owner, current.id, input);
    expect(current).toMatchObject({ status: 'partially-paid', balanceCents: 5000 });
    expect(await invoices.recordPayment(owner, current.id, input)).toEqual(current);
    await expect(invoices.recordPayment(owner, current.id, { ...input, amountCents: 3000 })).rejects.toMatchObject({ status: 409 });
    await expect(invoices.recordPayment(owner, current.id, { ...input, id: 'p2', amountCents: 5001, revision: current.revision })).rejects.toMatchObject({ status: 400 });
    current = await invoices.recordPayment(owner, current.id, { ...input, id: 'p2', amountCents: 5000, revision: current.revision });
    expect(current.status).toBe('paid'); expect(current.balanceCents).toBe(0);
    current = await invoices.reversePayment(owner, current.id, 'p1', current.revision);
    expect(current).toMatchObject({ status: 'partially-paid', paidCents: 5000, balanceCents: 2000 });
    await expect(invoices.void(owner, current.id, current.revision)).rejects.toMatchObject({ status: 409 });
  });
  it('voids an unpaid issued invoice and deletes only drafts', async () => {
    await invoices.create(owner, draft()); const issued = await invoices.issue(owner, 'invoice-1', 1);
    expect((await invoices.void(owner, issued.id, issued.revision)).state).toBe('void');
    await invoices.create(owner, draft('draft-2')); await invoices.remove(owner, 'draft-2', 1);
    await expect(invoices.get(owner, 'draft-2')).rejects.toMatchObject({ status: 404 });
  });
  it('validates schedule ownership and opens an existing invoice instead of duplicating the lesson', async () => {
    const scheduling = { occurrence: vi.fn(async (actor, id) => { if (actor !== owner || id !== 'series~2026-11-24') throw Object.assign(new Error('No such scheduled lesson.'), { status: 404 }); return { id, studentName: 'Student', durationMinutes: 45 }; }) };
    invoices = createInvoiceRepository({ collection, scheduling });
    await expect(invoices.create(other, { ...draft(), schedulingOccurrenceId: 'series~2026-11-24' })).rejects.toMatchObject({ status: 404 });
    await invoices.create(owner, { ...draft(), schedulingOccurrenceId: 'series~2026-11-24' });
    expect(await invoices.fromAppointment(owner, 'series~2026-11-24')).toMatchObject({ existingInvoiceId: 'invoice-1' });
    await expect(invoices.create(owner, { ...draft('second'), schedulingOccurrenceId: 'series~2026-11-24' })).rejects.toMatchObject({ status: 409 });
  });
  it('rejects occurrence aliases and retains one invoice when the real scheduled lesson moves', async () => {
    const scheduling = createSchedulingRepository({ collection: memoryLessonCollection() });
    await scheduling.create(owner, { id: 'series', studentName: 'Fixture Student', localDate: '2026-11-24', localTime: '15:00', timeZone: 'America/Chicago', durationMinutes: 45, repeat: 'weekly', lessonId: null });
    invoices = createInvoiceRepository({ collection, scheduling });
    const reference = 'series~2026-11-24';
    await invoices.create(owner, { ...draft(), schedulingOccurrenceId: reference });
    for (const alias of [`${reference}~`, `${reference}~~alias`]) {
      await expect(invoices.fromAppointment(owner, alias)).rejects.toMatchObject({ status: 404 });
      await expect(invoices.create(owner, { ...draft('second'), schedulingOccurrenceId: alias })).rejects.toMatchObject({ status: 400 });
      await expect(invoices.save(owner, 'invoice-1', { ...draft(), revision: 1, schedulingOccurrenceId: alias })).rejects.toMatchObject({ status: 400 });
    }
    await scheduling.changeOccurrence(owner, 'series', '2026-11-24', { revision: 1, localDate: '2026-12-03', localTime: '16:00', durationMinutes: 60 });
    expect(await invoices.fromAppointment(owner, reference)).toMatchObject({ appointment: { id: reference, localDate: '2026-12-03' }, existingInvoiceId: 'invoice-1' });
    await expect(invoices.create(owner, { ...draft('second'), schedulingOccurrenceId: reference })).rejects.toMatchObject({ status: 409 });
    await expect(invoices.fromAppointment(other, reference)).rejects.toMatchObject({ status: 404 });
    expect((await invoices.list(owner)).map(invoice => invoice.id)).toEqual(['invoice-1']);
    expect((await invoices.get(owner, 'invoice-1')).schedulingOccurrenceId).toBe(reference);
  });
  it('cleans invoices and numbering when an account is deleted', async () => {
    await invoices.create(owner, draft()); await invoices.issue(owner, 'invoice-1', 1); await invoices.create(other, draft('other'));
    await invoices.deleteOwner(owner);
    expect(await invoices.list(owner)).toEqual([]); expect((await invoices.list(other))).toHaveLength(1);
    expect([...collection.records.values()].some(item => item.ownerId === owner)).toBe(false);
  });
});
describe('online invoice integrity', () => {
  const provider = () => ({ settings: vi.fn(async () => ({ ready: true, available: true })), issue: vi.fn(async () => snapshot()), sync: vi.fn(async () => snapshot(7000)), void: vi.fn(async () => snapshot(0, { status: 'void' })), recordOffline: vi.fn(async () => snapshot(2000, { refundableCents: 0 })), refund: vi.fn(async () => snapshot(7000, { refundedCents: 7000, refundableCents: 0 })) });
  it('requires a ready account before committing online issue', async () => {
    await invoices.create(owner, draft('invoice-1', true));
    await expect(invoices.issue(owner, 'invoice-1', 1)).rejects.toMatchObject({ status: 409 });
    expect((await invoices.get(owner, 'invoice-1')).state).toBe('draft');
  });
  it('retries a failed issue with one immutable snapshot, number and idempotency key', async () => {
    const payments = provider(); payments.issue.mockRejectedValueOnce(new Error('Lost reply'));
    invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true));
    await expect(invoices.issue(owner, 'invoice-1', 1)).rejects.toThrow('Lost reply');
    const pending = await invoices.get(owner, 'invoice-1'); expect(pending.state).toBe('issuing');
    await expect(invoices.save(owner, pending.id, { ...draft(), revision: pending.revision })).rejects.toMatchObject({ status: 409 });
    const issued = await invoices.issue(owner, pending.id, 1);
    expect(issued).toMatchObject({ state: 'issued', number: 'INV-2026-0001', online: { stripeInvoiceId: 'in_example' } });
    expect(payments.issue.mock.calls[0][0].idempotencyKey).toBe(payments.issue.mock.calls[1][0].idempotencyKey);
    expect(payments.issue.mock.calls[0][0].invoice.lines).toEqual(payments.issue.mock.calls[1][0].invoice.lines);
  });
  it('shows the same invoice number as the hosted payment page', async () => {
    const payments = provider(); payments.issue.mockResolvedValue(snapshot(0, { providerNumber: 'STRIPE-1042' }));
    invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true));
    const issued = await invoices.issue(owner, 'invoice-1', 1);
    expect(issued).toMatchObject({ number: 'STRIPE-1042', localNumber: 'INV-2026-0001', providerNumber: 'STRIPE-1042' });
  });
  it('validates online currency and minimum before reserving an immutable issue', async () => {
    const payments = provider(); invoices = createInvoiceRepository({ collection, payments });
    await invoices.create(owner, { ...draft('currency', true), currency: 'CAD' });
    await invoices.create(owner, { ...draft('small', true), lines: [{ description: 'Small', quantity: 1, unitCents: 10 }] });
    for (const id of ['currency', 'small']) { await expect(invoices.issue(owner, id, 1)).rejects.toMatchObject({ status: 400 }); expect((await invoices.get(owner, id)).state).toBe('draft'); }
    expect(payments.issue).not.toHaveBeenCalled();
  });
  it('rejects a past online due date before reserving or contacting the provider', async () => {
    const payments = provider(); invoices = createInvoiceRepository({ collection, payments });
    await invoices.create(owner, { ...draft('past', true), issueDate: '2026-11-23', dueDate: '2026-11-23', timeZone: 'America/Chicago' });
    await expect(invoices.issue(owner, 'past', 1)).rejects.toMatchObject({ status: 400 });
    expect((await invoices.get(owner, 'past')).state).toBe('draft'); expect(payments.issue).not.toHaveBeenCalled();
  });
  it('does not double count an offline payment mirrored by Stripe', async () => {
    const payments = provider(); invoices = createInvoiceRepository({ collection, payments });
    await invoices.create(owner, draft('invoice-1', true)); let current = await invoices.issue(owner, 'invoice-1', 1);
    current = await invoices.recordPayment(owner, current.id, { id: 'cash', amountCents: 2000, date: '2026-11-24', method: 'cash', revision: current.revision });
    expect(current).toMatchObject({ paidCents: 2000, balanceCents: 5000 }); expect(current.payments).toHaveLength(1);
    current = await invoices.sync(owner, current.id); expect(current).toMatchObject({ paidCents: 7000, balanceCents: 0, status: 'paid' });
    expect(await invoices.findProviderInvoice('acct_teacher', 'in_example')).toEqual({ ownerId: owner, id: 'invoice-1' });
    expect(await invoices.findProviderInvoice('acct_other', 'in_example')).toBeNull();
  });
  it('keeps a failed external payment durable and retries exactly the same entry', async () => {
    const payments = provider(); payments.recordOffline.mockRejectedValueOnce(new Error('Lost response'));
    invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true)); let current = await invoices.issue(owner, 'invoice-1', 1);
    await expect(invoices.recordPayment(owner, current.id, { id: 'cash', amountCents: 2000, date: '2026-11-24', method: 'cash', revision: current.revision })).rejects.toThrow();
    current = await invoices.get(owner, current.id); expect(current.pendingPayment).toMatchObject({ id: 'cash' }); expect(current.paidCents).toBe(0);
    current = await invoices.retryPayment(owner, current.id); expect(current.paidCents).toBe(2000); expect(current.payments).toHaveLength(1);
    expect(payments.recordOffline.mock.calls[0][0].idempotencyKey).toBe(payments.recordOffline.mock.calls[1][0].idempotencyKey);
  });
  it('rejects a forged provider snapshot and keeps totals untouched', async () => {
    const payments = provider(); invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true)); await invoices.issue(owner, 'invoice-1', 1);
    for (const change of [{ accountId: 'acct_other' }, { stripeInvoiceId: 'in_other' }, { currency: 'EUR' }, { amountPaidCents: -1 }]) await expect(invoices.applyProviderSnapshot(owner, 'invoice-1', snapshot(7000, change))).rejects.toThrow();
    expect((await invoices.get(owner, 'invoice-1')).paidCents).toBe(0);
  });
  it('shows a provider credit as settled without inventing a cash payment', async () => {
    const payments = provider(); invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true)); await invoices.issue(owner, 'invoice-1', 1);
    payments.sync.mockResolvedValue(snapshot(0, { status: 'paid', amountRemainingCents: 0, creditCents: 7000 }));
    const current = await invoices.sync(owner, 'invoice-1'); expect(current).toMatchObject({ status: 'settled', paidCents: 0, balanceCents: 0, providerCreditCents: 7000 });
  });
  it('prevents voiding an online invoice that has a fresh partial payment', async () => {
    const payments = provider(); invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true)); const issued = await invoices.issue(owner, 'invoice-1', 1);
    payments.sync.mockResolvedValue(snapshot(2000));
    await expect(invoices.void(owner, issued.id, issued.revision)).rejects.toMatchObject({ status: 409 });
    expect(payments.void).not.toHaveBeenCalled(); expect(await invoices.get(owner, issued.id)).toMatchObject({ state: 'issued', paidCents: 2000, balanceCents: 5000 });
  });
  it('releases known non-posting payment and void reservations without creating money records', async () => {
    const payments = provider(); payments.sync.mockResolvedValue(snapshot());
    invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true)); let current = await invoices.issue(owner, 'invoice-1', 1);
    payments.recordOffline.mockRejectedValue(Object.assign(new Error('Precondition changed'), { status: 409, noSideEffect: true }));
    await expect(invoices.recordPayment(owner, current.id, { id: 'known-failure', amountCents: 7000, date: '2026-11-24', method: 'cash', revision: current.revision })).rejects.toMatchObject({ status: 409 });
    current = await invoices.get(owner, current.id); expect(current.pendingPayment).toBeNull(); expect(current.payments).toEqual([]);
    payments.void.mockRejectedValue(Object.assign(new Error('Precondition changed'), { status: 409, noSideEffect: true }));
    await expect(invoices.void(owner, current.id, current.revision)).rejects.toMatchObject({ status: 409 }); expect((await invoices.get(owner, current.id)).state).toBe('issued');
  });
  it('issues a retry-safe refund without reopening the invoice balance', async () => {
    const payments = provider(); invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true)); await invoices.issue(owner, 'invoice-1', 1);
    let current = await invoices.sync(owner, 'invoice-1');
    const request = { id: 'refund-1', amountCents: 7000, revision: current.revision };
    payments.refund.mockRejectedValueOnce(new Error('Lost response'));
    await expect(invoices.refund(owner, current.id, request)).rejects.toThrow();
    current = await invoices.refund(owner, current.id, request);
    expect(current).toMatchObject({ status: 'refunded', paidCents: 7000, balanceCents: 0, providerRefundedCents: 7000 });
    expect((await invoices.refund(owner, current.id, request)).refunds).toHaveLength(1);
    expect(payments.refund).toHaveBeenCalledTimes(2);
    expect(payments.refund.mock.calls[0][0].idempotencyKey).toBe(payments.refund.mock.calls[1][0].idempotencyKey);
  });
  it('requires the full offline balance when an online invoice uses a fixed payout', async () => {
    const payments = provider(); payments.settings.mockResolvedValue({ available: true, ready: true, offlinePaymentsSupported: 'full-only' });
    invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true));
    const current = await invoices.issue(owner, 'invoice-1', 1);
    await expect(invoices.recordPayment(owner, current.id, { id: 'partial', amountCents: 1000, date: '2026-11-24', method: 'cash', revision: current.revision })).rejects.toMatchObject({ status: 400 });
    expect(payments.recordOffline).not.toHaveBeenCalled(); expect((await invoices.get(owner, current.id)).pendingPayment).toBeUndefined();
  });
  it('keeps requested refunds pending until the provider confirms settlement', async () => {
    const payments = provider(); invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true)); await invoices.issue(owner, 'invoice-1', 1);
    let current = await invoices.sync(owner, 'invoice-1');
    payments.refund.mockResolvedValue(snapshot(7000, { refundedCents: 0, pendingRefundCents: 7000, refundableCents: 0 }));
    current = await invoices.refund(owner, current.id, { id: 'pending-refund', amountCents: 7000, revision: current.revision });
    expect(current).toMatchObject({ status: 'refund-pending', providerRefundedCents: 0, providerPendingRefundCents: 7000, balanceCents: 0 });
    payments.sync.mockResolvedValue(snapshot(7000, { refundedCents: 0, pendingRefundCents: 7000, refundableCents: 0 }));
    await expect(invoices.refund(owner, current.id, { id: 'second-refund', amountCents: 7000, revision: current.revision })).rejects.toMatchObject({ status: 409 });
    payments.sync.mockResolvedValue(snapshot(7000, { refundedCents: 7000, pendingRefundCents: 0, refundableCents: 0 }));
    current = await invoices.sync(owner, current.id); expect(current.status).toBe('refunded');
  });
  it('closes hosted payment links before deleting their ownership mapping', async () => {
    const payments = provider(); payments.sync.mockResolvedValue(snapshot());
    invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true)); await invoices.issue(owner, 'invoice-1', 1);
    payments.void.mockRejectedValueOnce(new Error('Provider unavailable'));
    await expect(invoices.deleteOwner(owner)).rejects.toThrow('Provider unavailable');
    expect((await invoices.get(owner, 'invoice-1')).state).toBe('issued');
    expect(await invoices.findProviderInvoice('acct_teacher', 'in_example')).toEqual({ ownerId: owner, id: 'invoice-1' });
    await invoices.deleteOwner(owner); expect(await invoices.list(owner)).toEqual([]);
    expect(payments.void).toHaveBeenCalledTimes(2);
  });
  it('closes an uncollectible invoice before deleting its still-payable mapping', async () => {
    const payments = provider(); payments.sync.mockResolvedValue(snapshot(0, { status: 'uncollectible' }));
    invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true)); await invoices.issue(owner, 'invoice-1', 1);
    await invoices.deleteOwner(owner); expect(payments.void).toHaveBeenCalledOnce(); expect(await invoices.list(owner)).toEqual([]);
  });
  it('validates a changed draft schedule reference without blocking an unchanged historical reference', async () => {
    const scheduling = { occurrence: vi.fn(async (actor, id) => { if (actor !== owner || id !== 'series~2026-11-24') throw Object.assign(new Error('No such lesson.'), { status: 404 }); return { id }; }) };
    invoices = createInvoiceRepository({ collection, payments: provider(), scheduling });
    await invoices.create(owner, { ...draft(), schedulingOccurrenceId: 'series~2026-11-24' }); await invoices.create(owner, draft('second'));
    await expect(invoices.save(owner, 'second', { ...draft('second'), schedulingOccurrenceId: 'series~2026-11-24', revision: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(invoices.save(owner, 'second', { ...draft('second'), schedulingOccurrenceId: 'other~2026-11-24', revision: 1 })).rejects.toMatchObject({ status: 404 });
    scheduling.occurrence.mockRejectedValue(Object.assign(new Error('Cancelled'), { status: 404 }));
    expect((await invoices.save(owner, 'invoice-1', { ...draft(), schedulingOccurrenceId: 'series~2026-11-24', revision: 1 })).revision).toBe(2);
  });
  it('prechecks a fresh provider refund balance before creating a pending operation', async () => {
    const payments = provider(); invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true)); await invoices.issue(owner, 'invoice-1', 1);
    const paid = await invoices.sync(owner, 'invoice-1'); payments.sync.mockResolvedValue(snapshot(7000, { refundableCents: 0, refundedCents: 7000 }));
    await expect(invoices.refund(owner, paid.id, { id: 'stale-refund', amountCents: 7000, revision: paid.revision })).rejects.toMatchObject({ status: 400 });
    const current = await invoices.get(owner, paid.id); expect(current.pendingRefund).toBeUndefined(); expect(current.providerRefundedCents).toBe(7000); expect(payments.refund).not.toHaveBeenCalled();
  });
  it('releases a refund reservation only when the adapter proves no side effect occurred', async () => {
    const payments = provider(); invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true)); await invoices.issue(owner, 'invoice-1', 1);
    let current = await invoices.sync(owner, 'invoice-1'); payments.refund.mockRejectedValue(Object.assign(new Error('Precondition changed'), { status: 409, noSideEffect: true }));
    await expect(invoices.refund(owner, current.id, { id: 'guard-refund', amountCents: 7000, revision: current.revision })).rejects.toMatchObject({ status: 409 });
    current = await invoices.get(owner, current.id); expect(current.pendingRefund).toBeNull(); expect(current.refunds).toBeUndefined();
  });
  it('retains paid provider records without automatically refunding account deletion', async () => {
    const payments = provider(); invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true)); await invoices.issue(owner, 'invoice-1', 1);
    await invoices.deleteOwner(owner);
    expect(payments.void).not.toHaveBeenCalled(); expect(payments.refund).not.toHaveBeenCalled(); expect(await invoices.list(owner)).toEqual([]);
  });
  it('blocks account deletion when a partially paid invoice still has a balance', async () => {
    const payments = provider(); payments.sync.mockResolvedValue(snapshot(2000));
    invoices = createInvoiceRepository({ collection, payments }); await invoices.create(owner, draft('invoice-1', true)); await invoices.issue(owner, 'invoice-1', 1);
    await expect(invoices.deleteOwner(owner)).rejects.toMatchObject({ status: 409 });
    expect(payments.void).not.toHaveBeenCalled(); expect(await invoices.get(owner, 'invoice-1')).toMatchObject({ paidCents: 2000, balanceCents: 5000 });
  });
});
