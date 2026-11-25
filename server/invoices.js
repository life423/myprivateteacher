import { mongoClient } from './db.js';
import { DATABASE } from './library.js';
import { cleanInvoiceInput, cleanRecordedPayment, invoicePaidCents, invoiceBalanceCents, invoiceStatus, invoiceToday, isInvoiceId, MAX_INVOICES } from '../shared/invoices.js';
import { parseOccurrenceId } from '../shared/scheduling.js';

export const INVOICES = 'teacherInvoices';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const ms = value => value instanceof Date ? value.getTime() : value;
const view = doc => {
  const { _id, ownerId: _ownerId, recordType: _recordType, ...safe } = structuredClone(doc);
  return { ...safe, id: _id, createdAt: ms(doc.createdAt), updatedAt: ms(doc.updatedAt), issuedAt: doc.issuedAt ? ms(doc.issuedAt) : null, paidCents: invoicePaidCents(doc), balanceCents: invoiceBalanceCents(doc), status: invoiceStatus(doc) };
};
const summary = doc => {
  const item = view(doc);
  const fields = ['id', 'number', 'recipientName', 'studentName', 'state', 'status', 'currency', 'totalCents', 'paidCents', 'balanceCents', 'dueDate', 'issueDate', 'revision', 'createdAt', 'updatedAt', 'allowOnline', 'schedulingOccurrenceId'];
  return Object.fromEntries(fields.map(key => [key, item[key]]));
};
const revisionMatches = (doc, revision) => { if (!Number.isSafeInteger(revision) || revision !== doc.revision) fail(409, 'This invoice changed in another tab. Reload it before continuing.'); };

export function createInvoiceRepository({ collection, payments = null, scheduling = null, ownerExists = async () => true, now = () => new Date() }) {
  const queues = new Map();
  const serial = (owner, fn) => {
    if (!isInvoiceId(owner)) return Promise.reject(Object.assign(new Error('Sign in first.'), { status: 401 }));
    const pending = (queues.get(owner) || Promise.resolve()).catch(() => {}).then(fn);
    queues.set(owner, pending);
    return pending.finally(() => { if (queues.get(owner) === pending) queues.delete(owner); });
  };
  const active = async owner => { if (!isInvoiceId(owner)) fail(401, 'Sign in first.'); if (!(await ownerExists(owner))) fail(403, 'This account is unavailable or being deleted.'); };
  const owned = async (owner, id) => {
    if (!isInvoiceId(id)) fail(404, 'No such invoice.');
    const doc = await collection.findOne({ _id: id, ownerId: owner, recordType: 'invoice' });
    if (!doc) fail(404, 'No such invoice.');
    return doc;
  };
  const update = async (doc, fields) => {
    const result = await collection.findOneAndUpdate({ _id: doc._id, ownerId: doc.ownerId, recordType: 'invoice', revision: doc.revision }, { $set: { ...fields, updatedAt: now() }, $inc: { revision: 1 } }, { returnDocument: 'after' });
    if (!result) fail(409, 'This invoice changed in another tab. Reload it before continuing.');
    return result;
  };
  const nextNumber = async (owner, year) => {
    const _id = `sequence:${owner}:${year}`;
    try { await collection.insertOne({ _id, ownerId: owner, recordType: 'sequence', nextNumber: 1 }); } catch (error) { if (error.code !== 11000) throw error; }
    for (let attempt = 0; attempt < 20; attempt++) {
      const sequence = await collection.findOne({ _id, ownerId: owner });
      if (!sequence || !Number.isSafeInteger(sequence.nextNumber) || sequence.nextNumber > 99999999) fail(503, 'Invoice numbering is temporarily unavailable.');
      const result = await collection.findOneAndUpdate({ _id, ownerId: owner, nextNumber: sequence.nextNumber }, { $inc: { nextNumber: 1 } }, { returnDocument: 'after' });
      if (result) return `INV-${year}-${String(sequence.nextNumber).padStart(4, '0')}`;
    }
    fail(409, 'Another invoice is being issued. Please try again.');
  };
  const paymentSettings = async owner => {
    await active(owner);
    return payments?.settings ? payments.settings(owner) : { available: false, ready: false, reason: 'Online payments are not configured yet.' };
  };
  const providerInvoice = doc => ({ ...view(doc), ownerId: doc.ownerId });
  const normalizeProviderResult = result => {
    if (!result || typeof result !== 'object') fail(503, 'Online payment setup did not finish. Retry issuing this invoice.');
    const url = result.hostedInvoiceUrl || result.paymentUrl || null;
    if (url) {
      let parsed; try { parsed = new URL(url); } catch { fail(503, 'The payment provider returned an invalid payment link.'); }
      if (parsed.protocol !== 'https:') fail(503, 'The payment provider returned an invalid payment link.');
    }
    return { accountId: result.accountId || null, stripeInvoiceId: result.stripeInvoiceId || null, hostedInvoiceUrl: url };
  };
  const providerFields = (doc, snapshot) => {
    if (!snapshot || !Number.isSafeInteger(snapshot.amountPaidCents) || snapshot.amountPaidCents < 0 || snapshot.amountPaidCents > 100000000 || String(snapshot.currency).toUpperCase() !== doc.currency || !['draft', 'open', 'paid', 'void', 'uncollectible'].includes(snapshot.status)) fail(503, 'Payment information could not be verified. Try refreshing the invoice.');
    const online = normalizeProviderResult(snapshot);
    if (!online.accountId || !online.stripeInvoiceId || (doc.online?.accountId && online.accountId !== doc.online.accountId) || (doc.online?.stripeInvoiceId && online.stripeInvoiceId !== doc.online.stripeInvoiceId)) fail(409, 'Payment information does not match this invoice.');
    const refundedCents = snapshot.refundedCents ?? 0, refundableCents = snapshot.refundableCents ?? 0, pendingRefundCents = snapshot.pendingRefundCents ?? 0;
    if (![refundedCents, refundableCents, pendingRefundCents].every(value => Number.isSafeInteger(value) && value >= 0 && value <= snapshot.amountPaidCents) || refundedCents + refundableCents + pendingRefundCents > snapshot.amountPaidCents) fail(503, 'Refund information could not be verified. Try refreshing this invoice.');
    const balanceCents = snapshot.amountRemainingCents ?? Math.max(0, doc.totalCents - snapshot.amountPaidCents), creditCents = snapshot.creditCents ?? Math.max(0, doc.totalCents - snapshot.amountPaidCents - balanceCents);
    if (![balanceCents, creditCents].every(value => Number.isSafeInteger(value) && value >= 0 && value <= doc.totalCents) || balanceCents + creditCents !== Math.max(0, doc.totalCents - snapshot.amountPaidCents)) fail(503, 'Invoice balance information could not be verified. Try refreshing this invoice.');
    const providerNumber = typeof snapshot.providerNumber === 'string' && snapshot.providerNumber.trim() ? snapshot.providerNumber.slice(0, 80) : doc.providerNumber || null;
    const onlineLivemode = typeof snapshot.livemode === 'boolean' ? snapshot.livemode : typeof doc.onlineLivemode === 'boolean' ? doc.onlineLivemode : typeof payments?.livemode === 'boolean' ? payments.livemode : null;
    return { online: { ...doc.online, ...online }, providerAccountId: online.accountId, providerInvoiceId: online.stripeInvoiceId, providerNumber, onlineLivemode, ...(providerNumber ? { localNumber: doc.localNumber || doc.number, number: providerNumber } : {}), providerPaidCents: snapshot.amountPaidCents, providerBalanceCents: balanceCents, providerCreditCents: creditCents, providerRefundedCents: refundedCents, providerPendingRefundCents: pendingRefundCents, refundableCents, disputed: snapshot.disputed === true, feeMismatch: snapshot.feeMismatch === true, providerStatus: snapshot.status, providerSyncedAt: ms(now()), ...(snapshot.status === 'void' ? { state: 'void' } : doc.state === 'voiding' && (snapshot.amountPaidCents > 0 || snapshot.status === 'paid') ? { state: 'issued' } : {}) };
  };
  const repository = {
    paymentSettings,
    async connectPayments(owner, context) {
      await active(owner);
      if (!payments?.connect) fail(503, 'Online payment setup is not available right now.');
      return payments.connect(owner, context);
    },
    async list(owner) {
      await active(owner);
      return (await collection.find({ ownerId: owner, recordType: 'invoice' }).limit(MAX_INVOICES).toArray()).sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt)).map(summary);
    },
    async get(owner, id) { await active(owner); return view(await owned(owner, id)); },
    async findProviderInvoice(accountId, stripeInvoiceId) {
      if (typeof accountId !== 'string' || typeof stripeInvoiceId !== 'string' || !accountId || !stripeInvoiceId) return null;
      const doc = await collection.findOne({ recordType: 'invoice', providerAccountId: accountId, providerInvoiceId: stripeInvoiceId });
      return doc ? { ownerId: doc.ownerId, id: doc._id } : null;
    },
    async fromAppointment(owner, id) {
      await active(owner);
      if (!parseOccurrenceId(id)) fail(404, 'No such scheduled lesson.');
      if (!scheduling?.occurrence) fail(503, 'Scheduled lessons are not available right now.');
      const appointment = await scheduling.occurrence(owner, id);
      if (appointment?.id !== id) fail(503, 'Scheduled lesson details could not be verified. Please try again.');
      const records = await collection.find({ ownerId: owner, recordType: 'invoice' }).limit(MAX_INVOICES).toArray();
      const previous = records.find(item => item.schedulingOccurrenceId === appointment.id && item.state !== 'void');
      return { appointment, existingInvoiceId: previous?._id || null };
    },
    create(owner, input) {
      return serial(owner, async () => {
        await active(owner);
        if (!isInvoiceId(input?.id)) fail(400, 'An invoice needs a valid ID.');
        const existing = await collection.findOne({ _id: input.id });
        if (existing) return view(await owned(owner, input.id));
        const clean = cleanInvoiceInput(input);
        if (clean.schedulingOccurrenceId) {
          const { appointment, existingInvoiceId } = await repository.fromAppointment(owner, clean.schedulingOccurrenceId);
          if (existingInvoiceId) fail(409, 'This scheduled lesson already has an invoice. Open that invoice instead.');
          clean.schedulingOccurrenceId = appointment.id;
        }
        if (await collection.countDocuments({ ownerId: owner, recordType: 'invoice' }) >= MAX_INVOICES) fail(409, `Keep up to ${MAX_INVOICES} invoices in this account.`);
        const doc = { _id: input.id, ownerId: owner, recordType: 'invoice', schemaVersion: 1, ...clean, revision: 1, state: 'draft', number: null, payments: [], createdAt: now(), updatedAt: now() };
        try { await collection.insertOne(doc); } catch (error) { if (error.code !== 11000) throw error; return view(await owned(owner, input.id)); }
        if (!(await ownerExists(owner))) { await collection.deleteOne({ _id: input.id, ownerId: owner }); fail(403, 'This account is unavailable or being deleted.'); }
        return view(doc);
      });
    },
    save(owner, id, input) {
      return serial(owner, async () => {
        await active(owner); const doc = await owned(owner, id); revisionMatches(doc, input?.revision);
        if (doc.state !== 'draft') fail(409, 'Issued invoices keep their original details. Create a new draft to make a correction.');
        const clean = cleanInvoiceInput(input);
        if (clean.schedulingOccurrenceId && clean.schedulingOccurrenceId !== doc.schedulingOccurrenceId) {
          const { appointment, existingInvoiceId } = await repository.fromAppointment(owner, clean.schedulingOccurrenceId);
          if (existingInvoiceId && existingInvoiceId !== id) fail(409, 'This scheduled lesson already has an invoice. Open that invoice instead.');
          clean.schedulingOccurrenceId = appointment.id;
        }
        return view(await update(doc, clean));
      });
    },
    issue(owner, id, revision) {
      return serial(owner, async () => {
        await active(owner); let doc = await owned(owner, id);
        if (doc.state === 'issued') return view(doc);
        if (!['draft', 'issuing'].includes(doc.state)) fail(409, 'This invoice cannot be issued.');
        if (doc.state === 'draft') {
          revisionMatches(doc, revision);
          if (doc.totalCents < 1) fail(400, 'Add an invoice total greater than zero before issuing.');
          if (doc.allowOnline) {
            if (doc.dueDate < invoiceToday(doc.timeZone || 'UTC', now())) fail(400, 'Choose today or a later due date for an online invoice.');
            const settings = await paymentSettings(owner);
            if (!settings.ready) fail(409, 'Connect your payment account before issuing an invoice with online payment.');
            if (!(settings.supportedCurrencies || ['USD']).includes(doc.currency)) fail(400, 'Online payments currently support USD. Choose USD or turn off online payment.');
            if (doc.totalCents < (settings.minimumOnlineCents || 50)) fail(400, 'Online invoices need a total of at least 0.50 USD.');
          }
          doc = await update(doc, { state: 'issuing', issuedAt: now() });
        }
        if (!doc.number) {
          const number = await nextNumber(owner, doc.issueDate.slice(0, 4));
          try { doc = await update(doc, { number }); }
          catch (error) { if (error.status !== 409) throw error; doc = await owned(owner, id); if (!doc.number) throw error; }
        }
        let online = null;
        if (doc.allowOnline) {
          if (!payments?.issue) fail(503, 'Online payment setup is unavailable. Retry issuing this invoice.');
          const result = await payments.issue({ ownerId: owner, invoice: providerInvoice(doc), idempotencyKey: `teacher-invoice-issue:${id}` });
          online = providerFields(doc, result);
        }
        await active(owner);
        try { return view(await update(doc, { state: 'issued', ...(online || { online: null }) })); }
        catch (error) { if (error.status !== 409) throw error; const current = await owned(owner, id); if (current.state === 'issued') return view(current); throw error; }
      });
    },
    recordPayment(owner, id, input) {
      return serial(owner, async () => {
        await active(owner); let doc = await owned(owner, id); const payment = cleanRecordedPayment(input);
        const previous = doc.payments.find(item => item.id === payment.id);
        if (previous) {
          if (['amountCents', 'date', 'method', 'note'].some(key => previous[key] !== payment[key])) fail(409, 'That payment reference already contains a different payment.');
          return view(doc);
        }
        revisionMatches(doc, input.revision);
        if (doc.state !== 'issued') fail(409, 'Issue this invoice before recording a payment.');
        if (doc.pendingPayment || doc.pendingReversal || doc.pendingRefund) fail(409, 'Another payment update needs to finish first. Reload this invoice.');
        if (payment.amountCents > invoiceBalanceCents(doc)) fail(400, 'The payment is greater than the amount due.');
        if (doc.payments.length >= 200) fail(409, 'This invoice has reached its payment record limit.');
        let provider = {};
        if (doc.allowOnline) {
          if (!payments?.recordOffline) fail(409, 'Record offline payment through the connected payment account, then refresh this invoice.');
          const settings = await paymentSettings(owner);
          if (settings.offlinePaymentsSupported === 'full-only' && payment.amountCents !== invoiceBalanceCents(doc)) fail(400, 'For an online invoice, record the full remaining balance received offline. Use an offline-only invoice for partial offline payments.');
          // Reserve the immutable request before provider I/O. Retrying never creates a
          // second payment; a changed request must use a fresh payment ID.
          doc = await update(doc, { pendingPayment: payment });
          try { provider = providerFields(doc, await payments.recordOffline({ ownerId: owner, invoice: providerInvoice(doc), payment, idempotencyKey: `teacher-invoice-payment:${id}:${payment.id}` })); }
          catch (error) { if (error.noSideEffect === true) await update(doc, { pendingPayment: null }); throw error; }
          await active(owner);
        }
        return view(await update(doc, { payments: [...doc.payments, { ...payment, source: 'offline', recordedAt: ms(now()) }], pendingPayment: null, ...provider }));
      });
    },
    retryPayment(owner, id) {
      return serial(owner, async () => {
        await active(owner); let doc = await owned(owner, id); const payment = doc.pendingPayment;
        if (!payment) return view(doc);
        if (!payments?.recordOffline) fail(503, 'Payment recording is temporarily unavailable.');
        let provider;
        try { provider = providerFields(doc, await payments.recordOffline({ ownerId: owner, invoice: providerInvoice(doc), payment, idempotencyKey: `teacher-invoice-payment:${id}:${payment.id}` })); }
        catch (error) { if (error.noSideEffect === true) await update(doc, { pendingPayment: null }); throw error; }
        await active(owner);
        return view(await update(doc, { payments: [...doc.payments, { ...payment, source: 'offline', recordedAt: ms(now()) }], pendingPayment: null, ...provider }));
      });
    },
    reversePayment(owner, id, paymentId, revision) {
      return serial(owner, async () => {
        await active(owner); let doc = await owned(owner, id);
        const payment = doc.payments.find(item => item.id === paymentId);
        if (!payment || payment.source !== 'offline') fail(404, 'No such offline payment.');
        if (payment.reversedAt) return view(doc);
        revisionMatches(doc, revision);
        if (doc.state !== 'issued' || doc.pendingPayment || doc.pendingReversal || doc.pendingRefund) fail(409, 'Finish the pending invoice update first.');
        let provider = {};
        if (doc.allowOnline) {
          if (!payments?.reverseOffline || (await paymentSettings(owner)).reverseOfflineSupported !== true) fail(409, 'Correct this payment through the connected payment account, then refresh this invoice.');
          doc = await update(doc, { pendingReversal: payment.id });
          provider = providerFields(doc, await payments.reverseOffline({ ownerId: owner, invoice: providerInvoice(doc), payment, idempotencyKey: `teacher-invoice-reverse:${id}:${payment.id}` }));
          await active(owner);
        }
        return view(await update(doc, { payments: doc.payments.map(item => item.id === paymentId ? { ...item, reversedAt: ms(now()) } : item), pendingReversal: null, ...provider }));
      });
    },
    retryReversal(owner, id) {
      return serial(owner, async () => {
        await active(owner); const doc = await owned(owner, id); const payment = doc.payments.find(item => item.id === doc.pendingReversal);
        if (!payment) return view(doc);
        if (!payments?.reverseOffline) fail(503, 'Payment correction is temporarily unavailable.');
        const provider = providerFields(doc, await payments.reverseOffline({ ownerId: owner, invoice: providerInvoice(doc), payment, idempotencyKey: `teacher-invoice-reverse:${id}:${payment.id}` }));
        await active(owner);
        return view(await update(doc, { payments: doc.payments.map(item => item.id === payment.id ? { ...item, reversedAt: ms(now()) } : item), pendingReversal: null, ...provider }));
      });
    },
    void(owner, id, revision) {
      return serial(owner, async () => {
        await active(owner); let doc = await owned(owner, id);
        if (doc.state === 'void') return view(doc);
        if (!['issued', 'voiding'].includes(doc.state)) fail(409, 'Only an issued invoice can be voided.');
        if (invoicePaidCents(doc) > 0) fail(409, 'An invoice with payments cannot be voided. Correct recorded offline payments first.');
        if (doc.pendingPayment || doc.pendingReversal || doc.pendingRefund) fail(409, 'Finish the pending payment update first.');
        if (doc.state === 'issued') {
          revisionMatches(doc, revision);
          const fresh = doc.allowOnline && payments?.sync ? providerFields(doc, await payments.sync({ ownerId: owner, invoice: providerInvoice(doc) })) : {};
          const current = { ...doc, ...fresh };
          if (current.state === 'void') return view(await update(doc, fresh));
          if (invoicePaidCents(current) > 0 || current.providerStatus === 'paid') {
            await update(doc, fresh);
            fail(409, 'This online invoice has a payment or credit. Refresh its status before continuing.');
          }
          doc = await update(doc, { ...fresh, state: 'voiding' });
        }
        let provider = {};
        if (doc.allowOnline) {
          if (!payments?.void) fail(503, 'Voiding this invoice is temporarily unavailable.');
          try {
            const result = await payments.void({ ownerId: owner, invoice: providerInvoice(doc), idempotencyKey: `teacher-invoice-void:${id}` });
            if (result?.status !== 'void') fail(503, 'Voiding has not been confirmed by the payment provider. Refresh this invoice and try again.');
            provider = providerFields(doc, result);
          }
          catch (error) { if (error.noSideEffect === true) await update(doc, { state: 'issued' }); throw error; }
          await active(owner);
        }
        return view(await update(doc, { ...provider, state: 'void', voidedAt: ms(now()) }));
      });
    },
    remove(owner, id, revision) {
      return serial(owner, async () => {
        await active(owner); const doc = await owned(owner, id); revisionMatches(doc, revision);
        if (doc.state !== 'draft') fail(409, 'Issued invoices stay in your records. Void an unpaid invoice instead.');
        const result = await collection.deleteOne({ _id: id, ownerId: owner, recordType: 'invoice', revision });
        if (!result.deletedCount) fail(409, 'This invoice changed. Reload it before deleting.');
      });
    },
    refund(owner, id, input) {
      return serial(owner, async () => {
        await active(owner); let doc = await owned(owner, id);
        if (!isInvoiceId(input?.id)) fail(400, 'A refund needs a valid reference.');
        const previous = (doc.refunds || []).find(item => item.id === input.id);
        if (previous) { if (previous.amountCents !== input.amountCents) fail(409, 'That refund reference already contains a different amount.'); return view(doc); }
        if (doc.pendingRefund && doc.pendingRefund.id !== input.id) fail(409, 'Another refund needs to finish first.');
        if (doc.pendingRefund && doc.pendingRefund.amountCents !== input.amountCents) fail(409, 'That refund reference already contains a different amount.');
        if (!doc.pendingRefund) {
          revisionMatches(doc, input.revision);
          if (doc.state !== 'issued' || !doc.allowOnline || doc.pendingPayment || doc.pendingReversal) fail(409, 'Finish other invoice updates before refunding online payment.');
          const fresh = payments?.sync ? providerFields(doc, await payments.sync({ ownerId: owner, invoice: providerInvoice(doc) })) : {};
          const current = { ...doc, ...fresh };
          if (current.disputed || current.providerPendingRefundCents > 0 || !Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > (current.refundableCents || 0)) {
            if (Object.keys(fresh).length) await update(doc, fresh);
            if (current.disputed) fail(409, 'Refunds are paused while this payment dispute is reviewed.');
            if (current.providerPendingRefundCents > 0) fail(409, 'A refund is already pending. Refresh the payment status before requesting another.');
            fail(400, 'Choose an amount no greater than the remaining online payment.');
          }
          if ((doc.refunds || []).length >= 200) fail(409, 'This invoice has reached its refund record limit.');
          if (!payments?.refund) fail(503, 'Online refunds are not available right now.');
          doc = await update(doc, { ...fresh, pendingRefund: { id: input.id, amountCents: input.amountCents } });
        }
        const refund = doc.pendingRefund;
        let result;
        try { result = await payments.refund({ ownerId: owner, invoice: providerInvoice(doc), amountCents: refund.amountCents, idempotencyKey: `teacher-invoice-refund:${id}:${refund.id}` }); }
        catch (error) {
          // Only an adapter that knows no provider mutation occurred may release
          // this reservation. Unknown failures retain the original retry key.
          if (error.noSideEffect === true) await update(doc, { pendingRefund: null });
          throw error;
        }
        await active(owner);
        const provider = providerFields(doc, result);
        return view(await update(doc, { ...provider, pendingRefund: null, refunds: [...(doc.refunds || []), { ...refund, recordedAt: ms(now()) }] }));
      });
    },
    // Server-only: call after verifying the webhook signature and account owner.
    // Always retrieve a fresh provider invoice; event order is not guaranteed.
    applyProviderSnapshot(owner, id, snapshot) {
      return serial(owner, async () => {
        await active(owner); const doc = await owned(owner, id);
        if (!doc.allowOnline || !['issued', 'issuing', 'voiding', 'void'].includes(doc.state)) fail(409, 'This invoice is not accepting online payments.');
        return view(await update(doc, providerFields(doc, snapshot)));
      });
    },
    sync(owner, id) {
      return serial(owner, async () => {
        await active(owner); const doc = await owned(owner, id);
        if (doc.allowOnline && payments?.sync && doc.online?.stripeInvoiceId) {
          const snapshot = await payments.sync({ ownerId: owner, invoice: providerInvoice(doc) });
          await active(owner);
          return view(await update(doc, providerFields(doc, snapshot)));
        }
        return view(doc);
      });
    },
    deleteOwner(owner) {
      return serial(owner, async () => {
        // Account deletion must close payable links before removing the local
        // ownership mapping. Financial records at the provider are retained.
        const docs = await collection.find({ ownerId: owner, recordType: 'invoice' }).limit(MAX_INVOICES).toArray();
        for (const doc of docs) {
          if (!doc.allowOnline || !['issued', 'issuing', 'voiding'].includes(doc.state)) continue;
          if (doc.online?.stripeInvoiceId && payments?.sync) {
            const snapshot = await payments.sync({ ownerId: owner, invoice: providerInvoice(doc) });
            const provider = providerFields(doc, snapshot);
            if (['paid', 'void'].includes(snapshot.status)) { await update(doc, provider); continue; }
            if (snapshot.amountPaidCents > 0) {
              await update(doc, provider);
              fail(409, 'An online invoice is partially paid. Resolve its remaining balance before deleting this account.');
            }
          }
          if (!payments?.void) fail(503, 'Online invoices must be closed before deleting this account. Try again when payments are available.');
          const snapshot = await payments.void({ ownerId: owner, invoice: providerInvoice(doc), idempotencyKey: `teacher-invoice-void:${doc._id}` });
          if (snapshot?.status !== 'void') fail(503, 'An online invoice could not be closed. Account deletion has not finished.');
          await update(doc, { ...providerFields(doc, snapshot), state: 'void' });
        }
        await collection.deleteMany({ ownerId: owner });
      });
    },
  };
  return repository;
}

export function connectInvoices({ uri = process.env.MONGODB_URI, payments, scheduling, ownerExists } = {}) {
  return uri ? createInvoiceRepository({ collection: mongoClient(uri).db(DATABASE).collection(INVOICES), payments, scheduling, ownerExists }) : null;
}
