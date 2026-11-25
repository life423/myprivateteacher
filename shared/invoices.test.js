import { describe, expect, it, vi } from 'vitest';
import { cleanInvoiceInput, cleanRecordedPayment, invoiceTotal, invoicePaidCents, invoiceStatus, invoiceToday, isInvoiceDate, parseMoney } from './invoices.js';

const draft = () => ({ senderName: 'Tutor', recipientName: 'Parent', currency: 'USD', issueDate: '2026-11-24', dueDate: '2026-12-01', lines: [{ description: 'Reading lesson', quantity: 2, unitCents: 3575 }] });
describe('invoice amounts and input', () => {
  it('calculates cents without floating-point amount parsing', () => {
    expect(parseMoney('35.75')).toBe(3575); expect(parseMoney('0.10')).toBe(10); expect(parseMoney('2.')).toBe(200);
    expect(parseMoney('1.005')).toBeNull(); expect(parseMoney('1e3')).toBeNull(); expect(parseMoney('-5')).toBeNull();
    expect(cleanInvoiceInput(draft()).totalCents).toBe(7150);
  });
  it('rejects unsafe totals, unsupported currencies and fractional quantities', () => {
    for (const input of [{ ...draft(), currency: 'JPY' }, { ...draft(), lines: [{ description: 'x', quantity: 1.5, unitCents: 100 }] }, { ...draft(), lines: [{ description: 'x', quantity: 1000, unitCents: 100000000 }] }]) expect(() => cleanInvoiceInput(input)).toThrow();
    expect(() => invoiceTotal([{ quantity: 1, unitCents: NaN }])).toThrow();
  });
  it('validates actual calendar dates and due-date order', () => {
    expect(isInvoiceDate('2028-02-29')).toBe(true); expect(isInvoiceDate('2026-02-29')).toBe(false); expect(isInvoiceDate('2026-13-01')).toBe(false);
    expect(() => cleanInvoiceInput({ ...draft(), dueDate: '2026-11-23' })).toThrow();
  });
  it('requires one canonical scheduled occurrence reference instead of accepting aliases', () => {
    expect(cleanInvoiceInput({ ...draft(), schedulingOccurrenceId: 'series~2026-11-24' }).schedulingOccurrenceId).toBe('series~2026-11-24');
    for (const reference of ['series~2026-11-24~', 'series~2026-11-24~~alias', 'series~2026-11-24~~', 'series~2026-02-30', 'series:2026-11-24']) {
      expect(() => cleanInvoiceInput({ ...draft(), schedulingOccurrenceId: reference })).toThrow('scheduled lesson reference');
    }
  });
  it('keeps provider totals authoritative, including mirrored offline payments', () => {
    const invoice = { allowOnline: true, state: 'issued', totalCents: 10000, dueDate: '2026-12-01', payments: [{ amountCents: 2000 }], providerPaidCents: 4000 };
    expect(invoicePaidCents(invoice)).toBe(4000); expect(invoiceStatus(invoice)).toBe('partially-paid');
    expect(invoiceStatus({ ...invoice, providerPaidCents: 10000, providerRefundedCents: 10000 })).toBe('refunded');
    expect(invoiceStatus({ ...invoice, providerPaidCents: 10000, providerPendingRefundCents: 10000 })).toBe('refund-pending');
  });
  it('accepts valid offline methods and rejects zero, negative or malformed payments', () => {
    expect(cleanRecordedPayment({ id: 'payment', amountCents: 5, date: '2026-11-24', method: 'cash' })).toMatchObject({ amountCents: 5 });
    for (const amountCents of [0, -10, 1.1, Infinity]) expect(() => cleanRecordedPayment({ id: 'payment', amountCents, date: '2026-11-24', method: 'cash' })).toThrow();
  });
  it('keeps the invoice due date in the saved business timezone across the UTC boundary', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-25T01:00:00Z'));
      expect(invoiceToday('America/Chicago')).toBe('2026-11-24');
      const invoice = { state: 'issued', totalCents: 100, payments: [], dueDate: '2026-11-24', timeZone: 'America/Chicago' };
      expect(invoiceStatus(invoice)).toBe('issued');
      vi.setSystemTime(new Date('2026-11-25T06:01:00Z')); expect(invoiceStatus(invoice)).toBe('overdue');
      expect(() => cleanInvoiceInput({ ...draft(), timeZone: 'Unknown/Place' })).toThrow();
    } finally { vi.useRealTimers(); }
  });
});
