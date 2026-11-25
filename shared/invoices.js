import { parseOccurrenceId, scheduleLocalParts, scheduleTimeZone } from './scheduling.js';

export const INVOICE_CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD'];
export const MAX_INVOICES = 1000;
export const MAX_INVOICE_LINES = 40;
export const MAX_INVOICE_TOTAL_CENTS = 100000000;
export const PAYMENT_METHODS = ['cash', 'check', 'bank-transfer', 'other'];
export const isInvoiceId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
const text = (value, max, label, required = false) => {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max) invalid(`${label} is too long or is not text.`);
  const result = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (required && !result) invalid(`Enter ${label.toLowerCase()}.`);
  return result;
};
export function isInvoiceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return date.getUTCFullYear() >= 2000 && date.getUTCFullYear() <= 2099 && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function invoiceTotal(lines) {
  let total = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 1000 || !Number.isSafeInteger(line.unitCents) || line.unitCents < 0 || line.unitCents > MAX_INVOICE_TOTAL_CENTS) invalid('Use a whole quantity from 1 to 1,000 and a valid price.');
    total += line.quantity * line.unitCents;
    if (!Number.isSafeInteger(total) || total > MAX_INVOICE_TOTAL_CENTS) invalid('This invoice exceeds the supported total of 1,000,000.');
  }
  return total;
}
export function cleanInvoiceInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Enter invoice details.');
  if (!INVOICE_CURRENCIES.includes(input.currency)) invalid('Choose a supported currency.');
  if (!isInvoiceDate(input.issueDate) || !isInvoiceDate(input.dueDate) || input.dueDate < input.issueDate) invalid('Choose a due date on or after the invoice date.');
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > MAX_INVOICE_LINES) invalid(`Add between 1 and ${MAX_INVOICE_LINES} invoice items.`);
  const lines = input.lines.map(line => {
    if (!line || typeof line !== 'object') invalid('Enter valid invoice items.');
    return { description: text(line.description, 240, 'Item description', true), quantity: line.quantity, unitCents: line.unitCents };
  });
  const email = text(input.recipientEmail, 254, 'Recipient email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid('Enter a valid recipient email address.');
  const occurrenceId = text(input.schedulingOccurrenceId, 180, 'Scheduled lesson reference');
  if (occurrenceId && !parseOccurrenceId(occurrenceId)) invalid('Choose a valid scheduled lesson reference.');
  if (input.allowOnline !== undefined && typeof input.allowOnline !== 'boolean') invalid('Online payment must be on or off.');
  return {
    recipientName: text(input.recipientName, 160, 'Recipient name', true), recipientEmail: email,
    recipientAddress: text(input.recipientAddress, 600, 'Recipient address'),
    senderName: text(input.senderName, 160, 'Your name or business', true), senderDetails: text(input.senderDetails, 600, 'Your contact details'),
    studentName: text(input.studentName, 160, 'Student name'), currency: input.currency,
    issueDate: input.issueDate, dueDate: input.dueDate, timeZone: scheduleTimeZone(input.timeZone || 'UTC'), lines, totalCents: invoiceTotal(lines),
    notes: text(input.notes, 1500, 'Invoice note'), allowOnline: input.allowOnline === true,
    schedulingOccurrenceId: occurrenceId || null,
  };
}
export function cleanRecordedPayment(input) {
  if (!input || !isInvoiceId(input.id)) invalid('A payment needs a valid reference.');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > MAX_INVOICE_TOTAL_CENTS) invalid('Enter a valid payment amount.');
  if (!isInvoiceDate(input.date)) invalid('Choose a valid payment date.');
  if (!PAYMENT_METHODS.includes(input.method)) invalid('Choose how you received the payment.');
  return { id: input.id, amountCents: input.amountCents, date: input.date, method: input.method, note: text(input.note, 240, 'Payment note') };
}
// The provider total already includes mirrored offline payments. Adding the local
// activity ledger again would double count them on invoices that accept online pay.
export const invoicePaidCents = invoice => invoice.allowOnline && Number.isSafeInteger(invoice.providerPaidCents) ? invoice.providerPaidCents : (invoice.payments || []).reduce((sum, payment) => sum + (payment.reversedAt ? 0 : payment.amountCents), 0);
export const invoiceBalanceCents = invoice => invoice.allowOnline && Number.isSafeInteger(invoice.providerBalanceCents) ? invoice.providerBalanceCents : Math.max(0, invoice.totalCents - invoicePaidCents(invoice));
export const invoiceToday = (timeZone = 'UTC', now = Date.now()) => scheduleLocalParts(now, timeZone).date;
export function invoiceStatus(invoice, today = invoiceToday(invoice.timeZone || 'UTC')) {
  if (['draft', 'issuing', 'void', 'voiding'].includes(invoice.state)) return invoice.state;
  if (invoice.disputed) return 'disputed';
  if (invoice.providerPendingRefundCents > 0) return 'refund-pending';
  const paid = invoicePaidCents(invoice);
  if (invoice.providerRefundedCents > 0) return invoice.providerRefundedCents >= paid ? 'refunded' : 'partially-refunded';
  if (invoice.allowOnline && invoice.providerStatus === 'paid' && invoiceBalanceCents(invoice) === 0 && paid < invoice.totalCents) return 'settled';
  if (paid >= invoice.totalCents) return 'paid';
  if (paid > 0) return 'partially-paid';
  return invoice.dueDate < today ? 'overdue' : 'issued';
}
export function parseMoney(value) {
  if (typeof value !== 'string' || !/^\d{1,7}(?:\.\d{0,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= MAX_INVOICE_TOTAL_CENTS ? cents : null;
}
export const moneyInput = cents => (cents / 100).toFixed(2);
export const formatInvoiceMoney = (cents, currency = 'USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(cents / 100);
