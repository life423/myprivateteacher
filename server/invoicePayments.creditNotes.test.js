import { describe, expect, it, vi } from 'vitest';
import { createInvoicePayments } from './invoicePayments.js';
import { memoryLessonCollection } from './lessonFixtures.js';

// This is an offline provider contract test. The SDK is a stub: there is no API
// credential, network request, invoice creation or financial action.
function fixture() {
  const upstream = { id: 'in_owned_fixture', transfer_data: { destination: 'acct_teacher_fixture' }, currency: 'usd', amount_paid: 0, amount_remaining: 6000 };
  const stripe = { invoices: { retrieve: vi.fn(async () => upstream) } };
  const invoices = { findProviderInvoice: vi.fn(async (account, id) => account === 'acct_teacher_fixture' && id === 'in_owned_fixture' ? { ownerId: 'teacher-owner', id: 'app-owned-invoice' } : null), sync: vi.fn(async () => ({})) };
  const payments = createInvoicePayments({ stripe, collection: memoryLessonCollection(), accounts: {}, mode: 'live', liveEnabled: false });
  const event = (type, patch = {}) => ({ id: `evt_${type}`, type, livemode: true, data: { object: { id: 'cn_fixture', object: 'credit_note', invoice: 'in_owned_fixture', amount: 4000, metadata: { owner: 'forged-owner', invoice: 'forged-invoice' } } }, ...patch });
  return { stripe, invoices, payments, event, upstream };
}

describe('credit-note notifications reconcile the currently owned invoice', () => {
  it.each(['credit_note.created', 'credit_note.updated', 'credit_note.voided'])('%s resolves current provider ownership and reconciles inside the repository', async type => {
    const f = fixture();
    await f.payments.handle(f.event(type), f.invoices);
    expect(f.stripe.invoices.retrieve).toHaveBeenCalledWith('in_owned_fixture');
    expect(f.invoices.findProviderInvoice).toHaveBeenCalledWith('acct_teacher_fixture', 'in_owned_fixture');
    expect(f.invoices.sync).toHaveBeenCalledExactlyOnceWith('teacher-owner', 'app-owned-invoice');
  });

  it('accepts an expanded invoice reference but still reads current provider data', async () => {
    const f = fixture(), event = f.event('credit_note.created');
    event.data.object.invoice = { id: 'in_owned_fixture', transfer_data: { destination: 'acct_old_untrusted' }, amount_remaining: 0 };
    await f.payments.handle(event, f.invoices);
    expect(f.stripe.invoices.retrieve).toHaveBeenCalledWith('in_owned_fixture');
    expect(f.invoices.findProviderInvoice).toHaveBeenCalledWith('acct_teacher_fixture', 'in_owned_fixture');
  });

  it('does not reconcile another invoice or use credit-note metadata as ownership', async () => {
    const f = fixture();
    f.invoices.findProviderInvoice.mockResolvedValue(null);
    await f.payments.handle(f.event('credit_note.created'), f.invoices);
    expect(f.invoices.sync).not.toHaveBeenCalled();
  });

  it('ignores a notification from another mode or a connected-account context', async () => {
    const f = fixture();
    await f.payments.handle(f.event('credit_note.created', { livemode: false }), f.invoices);
    await f.payments.handle(f.event('credit_note.created', { account: 'acct_other_context' }), f.invoices);
    expect(f.stripe.invoices.retrieve).not.toHaveBeenCalled();
    expect(f.invoices.sync).not.toHaveBeenCalled();
  });
});
