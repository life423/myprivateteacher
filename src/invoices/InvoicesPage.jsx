import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Copy, ExternalLink, Plus, Printer, Trash2 } from 'lucide-react';
import { Link, navigate, useNavigationGuard } from '../router.jsx';
import { useAccount } from '../account/account.js';
import GoogleButton from '../account/GoogleButton.jsx';
import TeacherNav from '../account/TeacherNav.jsx';
import { cleanInvoiceInput, formatInvoiceMoney as money, INVOICE_CURRENCIES, MAX_INVOICE_LINES, moneyInput, parseMoney } from '../../shared/invoices.js';
import * as api from './api.js';
import './invoices.css';

const button = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50';
const primary = `${button} bg-violet-600 text-white hover:bg-violet-700`;
const secondary = `${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
const field = 'min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:bg-slate-50';
const label = 'mb-1.5 block text-sm font-semibold text-slate-700';
const statusLabels = { draft: 'Draft', issuing: 'Issuing…', issued: 'Unpaid', overdue: 'Overdue', 'partially-paid': 'Part paid', paid: 'Paid', void: 'Void', voiding: 'Voiding…', refunded: 'Refunded', 'partially-refunded': 'Part refunded', disputed: 'Disputed', 'refund-pending': 'Refund pending', settled: 'Settled' };
const dateLabel = value => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const laterDate = date => new Date(new Date(`${date}T12:00:00Z`).getTime() + 14 * 86400000).toISOString().slice(0, 10);
const draftFor = tutor => ({ id: crypto.randomUUID(), senderName: tutor.name || '', senderDetails: tutor.email || '', recipientName: '', recipientEmail: '', recipientAddress: '', studentName: '', issueDate: localDate(), dueDate: laterDate(localDate()), currency: 'USD', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, lines: [{ description: 'Tutoring lesson', quantity: '1', price: '' }], notes: '', allowOnline: false, schedulingOccurrenceId: null });
const editable = invoice => ({ ...invoice, lines: invoice.lines.map(line => ({ ...line, quantity: String(line.quantity), price: moneyInput(line.unitCents) })) });
const payload = draft => cleanInvoiceInput({ ...draft, lines: draft.lines.map(line => ({ description: line.description, quantity: Number(line.quantity), unitCents: parseMoney(line.price) })) });
const draftTotal = draft => draft.lines.reduce((sum, line) => sum + ((parseMoney(line.price) || 0) * (Number(line.quantity) || 0)), 0);

function Notice({ error, children }) {
  if (!error) return null;
  return <div className='rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800'><p role='alert'>{error.message || error}</p>{children && <div className='mt-3 flex flex-wrap gap-2'>{children}</div>}</div>;
}
function Status({ invoice }) {
  const status = invoice.status || invoice.state;
  const tone = status === 'paid' ? 'bg-emerald-50 text-emerald-800' : status === 'overdue' ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-700';
  return <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{statusLabels[status] || status}</span>;
}
function Shell({ children }) {
  return <main className='invoice-print-shell min-h-dvh bg-slate-50 text-slate-900'>
    <header className='invoice-no-print border-b border-slate-200 bg-white'><div className='mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6'><Link to='/' className='flex min-h-11 items-center gap-2 text-sm font-bold sm:text-base'><span className='flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white'><BookOpen aria-hidden='true' className='h-5 w-5' /></span>My Private Teacher</Link><Link to='/account' className={secondary}>My account</Link></div><TeacherNav active='invoices' /></header>
    <div className='invoice-print-shell mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8'>{children}</div>
  </main>;
}
function TestMode({ settings, invoice }) {
  const mode = typeof invoice?.onlineLivemode === 'boolean' ? invoice.onlineLivemode : settings?.livemode;
  return mode === false ? <p className='text-xs font-semibold leading-5 text-amber-800'>Stripe test mode · Online payments are simulated.</p> : null;
}
function PaymentSetup({ settings, busy, onConnect, onManage }) {
  if (!settings) return null;
  if (settings.ready) return <div className='flex flex-wrap items-center justify-between gap-3'><div><p className='text-sm leading-6 text-slate-600'>Online payments connected{settings.accountLabel ? ` · ${settings.accountLabel}` : ''}. {Number.isFinite(settings.feePercent) && `A ${settings.feePercent}% platform fee applies to each online payment.`}</p><TestMode settings={settings} /></div><button type='button' disabled={busy} onClick={onManage} className={secondary}>{busy ? 'Opening…' : 'Manage payment account'}<ExternalLink aria-hidden='true' className='h-4 w-4' /></button></div>;
  const manage = settings.connected && settings.onboardingComplete;
  const title = manage ? 'Payment account connected' : settings.connected ? 'Finish payment setup' : 'Accept online payments';
  const action = manage ? 'Manage payment account' : settings.connected ? 'Continue setup' : 'Connect payments';
  return <div className='rounded-xl border border-slate-200 bg-white p-4'><div className='flex flex-wrap items-center justify-between gap-3'><div className='min-w-0'><h2 className='text-sm font-bold'>{title}</h2><p className='mt-1 max-w-xl text-sm leading-6 text-slate-600'>{settings.reason || 'Connect your payment account so families can pay invoices online.'}</p></div>{settings.available && <button type='button' disabled={busy} onClick={manage ? onManage : onConnect} className={secondary}>{busy ? 'Opening…' : action}<ExternalLink aria-hidden='true' className='h-4 w-4' /></button>}</div></div>;
}
function InvoiceList() {
  const [items, setItems] = useState(null), [settings, setSettings] = useState(null), [error, setError] = useState(null), [retry, setRetry] = useState(0), [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [connecting, setConnecting] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { const controller = new AbortController(); setError(null); api.listInvoices({ signal: controller.signal }).then(invoices => { if (!controller.signal.aborted) setItems(invoices); }).catch(failure => { if (!controller.signal.aborted) setError(failure); }); api.paymentSettings({ signal: controller.signal }).then(nextSettings => { if (!controller.signal.aborted) setSettings(nextSettings); }).catch(failure => { if (!controller.signal.aborted) setError(failure); }); return () => controller.abort(); }, [retry]);
  const connect = async (manage = false) => { if (connecting) return; setConnecting(true); setError(null); try { const result = await (manage ? api.managePayments() : api.connectPayments()); if (result?.url && new URL(result.url).protocol === 'https:') window.location.assign(result.url); else throw new Error('Payment setup could not be opened. Please try again.'); } catch (failure) { if (alive.current) { setError(failure); setConnecting(false); } } };
  const matching = (items || []).filter(item => `${item.recipientName} ${item.studentName || ''} ${item.number || ''}`.toLowerCase().includes(query.toLowerCase().trim()) && (filter === 'all' || filter === 'draft' && item.state === 'draft' || filter === 'unpaid' && item.state === 'issued' && item.balanceCents > 0 || filter === 'paid' && ['paid', 'refunded', 'partially-refunded', 'refund-pending', 'settled'].includes(item.status)));
  return <div className='invoice-no-print mt-6 space-y-5'>
    <div className='flex flex-wrap items-start justify-between gap-4'><div><h1 className='text-2xl font-extrabold tracking-tight sm:text-3xl'>Invoices</h1><p className='mt-2 text-sm leading-6 text-slate-600'>Bill for your lessons and keep payment records together.</p></div><Link to='/invoices/new' className={primary}><Plus className='h-4 w-4' aria-hidden='true' />New invoice</Link></div>
    <PaymentSetup settings={settings} busy={connecting} onConnect={() => connect(false)} onManage={() => connect(true)} />
    <Notice error={error}><button type='button' onClick={() => setRetry(value => value + 1)} className={secondary}>Try again</button></Notice>
    {items === null ? <p role='status' className='py-6 text-sm text-slate-600'>{error ? 'Invoices have not loaded.' : 'Loading invoices…'}</p> : !items.length ? <div className='rounded-2xl border border-dashed border-slate-300 bg-white p-6'><h2 className='font-bold'>Your first invoice starts here</h2><p className='mt-2 max-w-xl text-sm leading-6 text-slate-600'>Add a recipient and your lesson fee. Save a draft, then issue it when you are ready.</p></div> : <>
      <div className='grid gap-3 sm:grid-cols-[1fr_12rem]'><label><span className={label}>Find an invoice</span><input type='search' value={query} onChange={event => setQuery(event.target.value)} placeholder='Recipient, student or invoice number' className={field} /></label><label><span className={label}>Show</span><select aria-label='Show invoices' value={filter} onChange={event => setFilter(event.target.value)} className={field}><option value='all'>All invoices</option><option value='unpaid'>Unpaid</option><option value='draft'>Drafts</option><option value='paid'>Paid and refunded</option></select></label></div>
      <ul className='space-y-3'>{matching.map(item => <li key={item.id}><Link to={`/invoices/${encodeURIComponent(item.id)}`} className='flex min-h-24 items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-violet-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 sm:p-5'><div className='min-w-0'><p className='break-words font-bold'>{item.recipientName}</p><p className='mt-1 break-words text-xs leading-5 text-slate-600'>{item.number || 'Draft invoice'}{item.studentName ? ` · ${item.studentName}` : ''}</p><p className='mt-1 text-xs text-slate-600'>Due {dateLabel(item.dueDate)}</p></div><div className='flex shrink-0 flex-col items-end gap-2'><p className='font-bold tabular-nums'>{money(item.totalCents, item.currency)} <span className='text-xs font-normal'>{item.currency}</span></p><Status invoice={item} /></div></Link></li>)}</ul>{!matching.length && <p role='status' className='rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600'>No invoices match. Try another name or status.</p>}
    </>}
  </div>;
}

function TextField({ title, value, onChange, optional = false, multiline = false, ...props }) {
  const Tag = multiline ? 'textarea' : 'input';
  return <label className='block min-w-0'><span className={label}>{title}{optional && <span className='font-normal text-slate-500'> (optional)</span>}</span><Tag value={value} onChange={event => onChange(event.target.value)} className={field} {...(multiline ? { rows: 3 } : {})} {...props} /></label>;
}
function InvoiceDraft({ draft, setDraft, settings, disabled }) {
  const set = (name, value) => setDraft(current => ({ ...current, [name]: value, ...(name === 'currency' && !(settings?.supportedCurrencies || ['USD']).includes(value) ? { allowOnline: false } : {}) }));
  const line = (index, name, value) => setDraft(current => ({ ...current, lines: current.lines.map((item, position) => position === index ? { ...item, [name]: value } : item) }));
  const setupHelp = settings?.reason || (settings?.connected && settings.onboardingComplete
    ? 'Your payment account is connected. Online payments are not active yet.'
    : settings?.connected ? 'Continue payment setup from Invoices to enable online payment.'
      : 'Connect payments from Invoices to enable online payment.');
  return <fieldset disabled={disabled} className='space-y-5 disabled:opacity-70'>
    <section className='rounded-2xl border border-slate-200 bg-white p-4 sm:p-6'><h2 className='mb-4 text-lg font-bold'>Invoice details</h2><div className='grid gap-4 sm:grid-cols-2'>
      <TextField title='Bill to' value={draft.recipientName} onChange={value => set('recipientName', value)} maxLength={160} required />
      <TextField title='Your name or business' value={draft.senderName} onChange={value => set('senderName', value)} maxLength={160} autoComplete='organization' required />
      <div className='grid grid-cols-2 gap-3 sm:col-span-2'><TextField title='Invoice date' value={draft.issueDate} onChange={value => set('issueDate', value)} type='date' required min='2000-01-01' max='2099-12-31' /><TextField title='Due date' value={draft.dueDate} onChange={value => set('dueDate', value)} type='date' required min={draft.issueDate} max='2099-12-31' /></div>
      <details className='rounded-xl border border-slate-200 sm:col-span-2'><summary className='min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold text-slate-700'>Contact details and student <span className='font-normal text-slate-500'>(optional)</span></summary><div className='grid gap-4 border-t border-slate-100 p-3 sm:grid-cols-2'><TextField title='Recipient email' optional value={draft.recipientEmail} onChange={value => set('recipientEmail', value)} type='email' maxLength={254} autoComplete='off' /><TextField title='Student' optional value={draft.studentName} onChange={value => set('studentName', value)} maxLength={160} autoComplete='off' /><TextField title='Your contact details' optional value={draft.senderDetails} onChange={value => set('senderDetails', value)} maxLength={600} multiline /><TextField title='Recipient address' optional value={draft.recipientAddress} onChange={value => set('recipientAddress', value)} maxLength={600} multiline /></div></details>
    </div></section>
    <section className='rounded-2xl border border-slate-200 bg-white p-4 sm:p-6'><div className='mb-4 flex flex-wrap items-end justify-between gap-3'><h2 className='text-lg font-bold'>Lesson fees</h2><label className='w-32'><span className={label}>Currency</span><select aria-label='Currency' value={draft.currency} onChange={event => set('currency', event.target.value)} className={field}>{INVOICE_CURRENCIES.map(currency => <option key={currency}>{currency}</option>)}</select></label></div>
      <ol className='space-y-4'>{draft.lines.map((item, index) => <li key={index} className='rounded-xl border border-slate-200 p-3 sm:p-4'><TextField title={`Item ${index + 1}`} value={item.description} onChange={value => line(index, 'description', value)} maxLength={240} required /><div className='mt-3 grid grid-cols-[5rem_minmax(0,1fr)_auto] items-end gap-3 sm:grid-cols-[6rem_10rem_1fr_auto]'><TextField title='Quantity' type='number' min='1' max='1000' step='1' value={item.quantity} onChange={value => line(index, 'quantity', value)} required /><TextField title={`Price (${draft.currency})`} inputMode='decimal' value={item.price} onChange={value => line(index, 'price', value)} placeholder='0.00' required /><p className='hidden pb-3 text-right text-sm font-semibold tabular-nums sm:block'>{money((parseMoney(item.price) || 0) * (Number(item.quantity) || 0), draft.currency)}</p><button type='button' aria-label={`Remove item ${index + 1}`} title={`Remove item ${index + 1}`} disabled={draft.lines.length === 1} className={`${button} border border-slate-200 p-2 text-slate-600 hover:bg-slate-50`} onClick={() => set('lines', draft.lines.filter((_value, position) => position !== index))}><Trash2 className='h-4 w-4' aria-hidden='true' /></button></div></li>)}</ol>
      <div className='mt-4 flex flex-wrap items-center justify-between gap-4'><button type='button' disabled={draft.lines.length >= MAX_INVOICE_LINES} onClick={() => set('lines', [...draft.lines, { description: '', quantity: '1', price: '' }])} className={secondary}><Plus aria-hidden='true' className='h-4 w-4' />Add item</button><p className='text-lg font-bold tabular-nums'>Total {money(draftTotal(draft), draft.currency)} <span className='text-xs font-normal text-slate-600'>{draft.currency}</span></p></div>
    </section>
    <section className='space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6'><TextField title='Note shown on the invoice' optional value={draft.notes} onChange={value => set('notes', value)} maxLength={1500} multiline placeholder='For example, Thank you for learning with me.' /><div className='border-t border-slate-100 pt-4'><label className='flex min-h-11 items-center gap-3 text-sm font-semibold'><input type='checkbox' checked={draft.allowOnline} disabled={(!settings?.ready || !(settings.supportedCurrencies || ['USD']).includes(draft.currency)) && !draft.allowOnline} onChange={event => set('allowOnline', event.target.checked)} className='h-5 w-5 shrink-0 accent-violet-600' />Allow online payment</label><p className='ml-8 text-xs leading-5 text-slate-600'>{!(settings?.supportedCurrencies || ['USD']).includes(draft.currency) ? 'Online payments currently use USD. You can record offline payments in the selected currency.' : settings?.ready ? `Families pay on a secure payment page.${Number.isFinite(settings.feePercent) ? ` A ${settings.feePercent}% platform fee applies to each online payment.` : ''}` : `${setupHelp} You can still issue invoices and record offline payments.`}</p></div></section>
  </fieldset>;
}

function InvoicePaper({ invoice, settings }) {
  const overpaid = Math.max(0, invoice.paidCents - invoice.totalCents);
  return <article aria-label='Invoice preview' className='invoice-paper rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8'>
    <div className='flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6'><div className='min-w-0'><p className='text-xs font-semibold uppercase tracking-widest text-violet-700'>My Private Teacher</p><h2 className='mt-2 text-2xl font-extrabold'>Invoice</h2><p className='mt-1 text-sm text-slate-600'>{invoice.number}</p></div><Status invoice={invoice} /></div>
    {invoice.allowOnline && <div className='invoice-print-only mt-4'><TestMode settings={settings} invoice={invoice} /></div>}<div className='mt-6 grid gap-6 sm:grid-cols-2'><div><h3 className='text-xs font-semibold uppercase tracking-wide text-slate-500'>From</h3><p className='mt-2 font-bold'>{invoice.senderName}</p>{invoice.senderDetails && <p className='mt-1 whitespace-pre-line text-sm leading-6 text-slate-600'>{invoice.senderDetails}</p>}</div><div><h3 className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Bill to</h3><p className='mt-2 font-bold'>{invoice.recipientName}</p>{invoice.recipientEmail && <p className='mt-1 text-sm text-slate-600'>{invoice.recipientEmail}</p>}{invoice.recipientAddress && <p className='mt-1 whitespace-pre-line text-sm leading-6 text-slate-600'>{invoice.recipientAddress}</p>}{invoice.studentName && <p className='mt-2 text-sm text-slate-600'>Student: {invoice.studentName}</p>}</div></div>
    <dl className='my-6 grid grid-cols-2 gap-4 border-y border-slate-100 py-4 text-sm'><div><dt className='text-slate-500'>Invoice date</dt><dd className='mt-1 font-semibold'>{dateLabel(invoice.issueDate)}</dd></div><div><dt className='text-slate-500'>Due date</dt><dd className='mt-1 font-semibold'>{dateLabel(invoice.dueDate)}</dd></div></dl>
    <table><caption className='sr-only'>Invoice items in {invoice.currency}</caption><thead><tr><th scope='col'>Description</th><th scope='col'>Qty</th><th scope='col'>Price</th><th scope='col'>Amount</th></tr></thead><tbody>{invoice.lines.map((line, index) => <tr key={index}><td className='text-sm leading-6'>{line.description}</td><td className='text-sm'>{line.quantity}</td><td className='text-sm tabular-nums'>{money(line.unitCents, invoice.currency)}</td><td className='text-sm font-semibold tabular-nums'>{money(line.quantity * line.unitCents, invoice.currency)}</td></tr>)}</tbody></table>
    <dl className='ml-auto mt-6 max-w-xs space-y-3 text-sm'><div className='flex justify-between gap-6'><dt>Total ({invoice.currency})</dt><dd className='font-semibold tabular-nums'>{money(invoice.totalCents, invoice.currency)}</dd></div><div className='flex justify-between gap-6'><dt>Paid</dt><dd className='tabular-nums'>{money(invoice.paidCents, invoice.currency)}</dd></div>{invoice.state !== 'void' && invoice.providerCreditCents > 0 && <div className='flex justify-between gap-6'><dt>Credit applied</dt><dd className='tabular-nums'>{money(invoice.providerCreditCents, invoice.currency)}</dd></div>}{invoice.providerRefundedCents > 0 && <div className='flex justify-between gap-6'><dt>Refunded</dt><dd className='tabular-nums'>{money(invoice.providerRefundedCents, invoice.currency)}</dd></div>}{overpaid > 0 && <div className='flex justify-between gap-6'><dt>Overpayment</dt><dd className='tabular-nums'>{money(overpaid, invoice.currency)}</dd></div>}<div className='flex justify-between gap-6 border-t border-slate-200 pt-3 text-base font-bold'><dt>{invoice.state === 'void' ? 'Void' : 'Amount due'}</dt><dd className='tabular-nums'>{money(invoice.state === 'void' ? 0 : invoice.balanceCents, invoice.currency)}</dd></div></dl>
    {invoice.notes && <p className='mt-8 whitespace-pre-line border-t border-slate-100 pt-5 text-sm leading-6 text-slate-600'>{invoice.notes}</p>}
    {invoice.allowOnline && invoice.online?.hostedInvoiceUrl && invoice.state !== 'void' && <p className='mt-6 break-all text-xs leading-5 text-slate-600'>{invoice.balanceCents > 0 ? 'Pay online' : 'Payment record'}: <a href={invoice.online.hostedInvoiceUrl} className='text-violet-700 underline'>{invoice.online.hostedInvoiceUrl}</a></p>}
  </article>;
}

function InvoiceDetail({ id, tutor }) {
  const isNew = id === 'new';
  const [invoice, setInvoice] = useState(null), [draft, setDraft] = useState(() => isNew ? draftFor(tutor) : null), [savedDraft, setSavedDraft] = useState(() => isNew ? JSON.stringify(draft) : null), [settings, setSettings] = useState(null), [loading, setLoading] = useState(!isNew), [error, setError] = useState(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(null), [paymentOpen, setPaymentOpen] = useState(false), [payment, setPayment] = useState({ amount: '', date: localDate(), method: 'cash', note: '' });
  const alive = useRef(true), busyRef = useRef(false), paymentId = useRef(null), refundId = useRef(null), draftRef = useRef(draft), savedRef = useRef(savedDraft), invoiceRef = useRef(invoice), confirmation = useRef(null), confirmationOpener = useRef(null);
  draftRef.current = draft; savedRef.current = savedDraft; invoiceRef.current = invoice;
  const dirty = draft && JSON.stringify(draft) !== savedDraft;
  const dirtyNow = () => draftRef.current && JSON.stringify(draftRef.current) !== savedRef.current;
  useNavigationGuard(dirtyNow, 'Leave this invoice and discard unsaved changes?');
  const accept = current => {
    setInvoice(current); invoiceRef.current = current;
    const next = editable(current); setDraft(next); draftRef.current = next;
    const signature = JSON.stringify(next); setSavedDraft(signature); savedRef.current = signature;
    if (paymentId.current && current.payments?.some(item => item.id === paymentId.current)) {
      paymentId.current = null; setPaymentOpen(false); setPayment({ amount: '', date: localDate(), method: 'cash', note: '' }); setError(null); setMessage('Payment recorded.');
    } else if (current.pendingPayment?.id === paymentId.current) setPaymentOpen(false);
    if (refundId.current && current.refunds?.some(item => item.id === refundId.current)) { refundId.current = null; setError(null); setMessage('Refund requested. Status updates after Stripe confirms it.'); }
  };
  const askConfirm = value => { confirmationOpener.current = document.activeElement; setConfirm(value); };
  useEffect(() => {
    if (!confirm) return undefined;
    const frame = requestAnimationFrame(() => { confirmation.current?.focus({ preventScroll: true }); confirmation.current?.scrollIntoView({ block: 'nearest' }); });
    return () => { cancelAnimationFrame(frame); if (confirmationOpener.current?.isConnected) confirmationOpener.current.focus({ preventScroll: true }); };
  }, [confirm]);
  useEffect(() => {
    const controller = new AbortController(); alive.current = true;
    api.paymentSettings({ signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setSettings(value);
      if (isNew && !draftRef.current?.allowOnline) {
        const pristine = !dirtyNow(), next = { ...draftRef.current, allowOnline: value.ready === true };
        setDraft(next); draftRef.current = next;
        if (pristine) { const signature = JSON.stringify(next); setSavedDraft(signature); savedRef.current = signature; }
      }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure); });
    if (!isNew) api.getInvoice(id, { signal: controller.signal }).then(current => { if (!controller.signal.aborted) accept(current); }).catch(failure => { if (!controller.signal.aborted) setError(failure); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    else {
      const appointmentId = new URLSearchParams(window.location.search).get('appointment');
      if (appointmentId) {
        setLoading(true);
        api.invoiceFromAppointment(appointmentId, { signal: controller.signal }).then(result => {
          if (controller.signal.aborted) return;
          if (result.existingInvoiceId) { savedRef.current = JSON.stringify(draftRef.current); navigate(`/invoices/${encodeURIComponent(result.existingInvoiceId)}`, { replace: true }); return; }
          const scheduled = result.appointment, pristine = !dirtyNow();
          const next = { ...draftRef.current, studentName: scheduled.studentName, recipientName: scheduled.studentName, schedulingOccurrenceId: appointmentId, timeZone: scheduled.timeZone || draftRef.current.timeZone, lines: [{ description: `Tutoring lesson · ${scheduled.displayDate || scheduled.localDate || scheduled.startsAt?.slice(0, 10)} · ${scheduled.durationMinutes} minutes`, quantity: '1', price: '' }] };
          setDraft(next); draftRef.current = next;
          if (pristine) { const signature = JSON.stringify(next); setSavedDraft(signature); savedRef.current = signature; }
        }).catch(failure => { if (!controller.signal.aborted) setError(failure); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
      }
    }
    return () => { controller.abort(); alive.current = false; };
  }, [id, isNew]);
  const run = async (operation, success) => {
    if (busyRef.current) return null;
    busyRef.current = true; setBusy(true); setError(null); setMessage('');
    try {
      const result = await operation();
      if (alive.current) { if (result?.id) accept(result); setMessage(success || 'Saved.'); setConfirm(null); }
      return result;
    } catch (failure) {
      if (alive.current) {
        setError(failure);
        // External operations may finish after the network reply is lost. Reload
        // an issued invoice to show its durable retry action and current balance.
        if (invoiceRef.current?.state !== 'draft' && invoiceRef.current?.id) {
          try { const current = await api.getInvoice(invoiceRef.current.id); if (alive.current) accept(current); } catch { /* Keep the last saved record. */ }
        }
      }
      return null;
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const persist = async () => {
    const current = draftRef.current, body = { ...payload(current), id: current.id, revision: invoiceRef.current?.revision };
    return invoiceRef.current ? dirtyNow() ? api.saveInvoice(current.id, body) : invoiceRef.current : api.createInvoice(body);
  };
  const save = async event => { event?.preventDefault(); const result = await run(persist, 'Draft saved.'); if (result && isNew) navigate(`/invoices/${encodeURIComponent(result.id)}`, { replace: true }); };
  const issue = async () => {
    const result = await run(async () => { const saved = await persist(); accept(saved); return api.issueInvoice(saved.id, saved.revision); }, draft?.allowOnline ? 'Invoice issued. Copy the payment link to share it.' : 'Invoice issued. You can print it or record a payment.');
    if (result && isNew) navigate(`/invoices/${encodeURIComponent(result.id)}`, { replace: true });
    else if (!result && invoiceRef.current) { try { accept(await api.getInvoice(invoiceRef.current.id)); } catch { /* Keep the last saved invoice available for retry. */ } }
  };
  const reload = () => run(() => api.getInvoice(invoiceRef.current?.id || id), 'Latest invoice loaded.');
  const copy = async () => { try { await navigator.clipboard.writeText(invoice.online.hostedInvoiceUrl); setMessage('Payment link copied.'); } catch { setMessage('Copy the payment link shown in the invoice preview.'); } };
  const record = async event => { event.preventDefault(); const amountCents = parseMoney(payment.amount); if (!amountCents) { setError(new Error('Enter a payment amount greater than zero.')); return; } paymentId.current ||= crypto.randomUUID(); const result = await run(() => api.recordPayment(invoice.id, { ...payment, id: paymentId.current, amountCents, revision: invoice.revision }), 'Payment recorded.'); if (result) { setPaymentOpen(false); paymentId.current = null; setPayment({ amount: '', date: localDate(), method: 'cash', note: '' }); } };
  const refund = async () => { refundId.current ||= crypto.randomUUID(); const pending = invoice.pendingRefund; const result = await run(() => api.refundPayment(invoice.id, { id: pending?.id || refundId.current, amountCents: pending?.amountCents || invoice.refundableCents, revision: invoice.revision }), 'Refund requested. Status updates after Stripe confirms it.'); if (result) refundId.current = null; };
  if (loading) return <p role='status' className='invoice-no-print mt-6 text-sm text-slate-600'>Loading invoice…</p>;
  if (!draft) return <div className='invoice-no-print mt-6 space-y-4'><Notice error={error}><button onClick={reload} className={secondary}>Try again</button></Notice><Link to='/invoices' className={secondary}>Back to invoices</Link></div>;
  const issued = invoice && invoice.state !== 'draft';
  const pending = invoice?.pendingPayment || invoice?.pendingReversal || invoice?.pendingRefund;
  const canRecord = invoice?.state === 'issued' && invoice.balanceCents > 0 && !pending && (!invoice.allowOnline || Boolean(settings?.offlinePaymentsSupported));
  return <div className='invoice-print-shell mt-6 space-y-5'>
    <div className='invoice-no-print'><Link to='/invoices' className={`${button} -ml-3 text-slate-600 hover:bg-slate-100`}><ArrowLeft aria-hidden='true' className='h-4 w-4' />Invoices</Link><div className='mt-3 flex flex-wrap items-start justify-between gap-4'><div><h1 className='text-2xl font-extrabold tracking-tight sm:text-3xl'>{issued ? invoice.number || 'Issuing invoice' : isNew ? 'New invoice' : 'Edit draft'}</h1><p className='mt-2 text-sm leading-6 text-slate-600'>{issued ? 'Your issued details stay in the invoice record.' : 'Save a draft first, or issue it when the details are ready.'}</p></div><div className='flex flex-wrap gap-2'>{!issued ? <><button type='button' disabled={busy || !dirty} onClick={save} className={secondary}>{busy ? 'Saving…' : 'Save draft'}</button><button type='button' disabled={busy} onClick={() => { try { payload(draft); setError(null); askConfirm('issue'); } catch (failure) { setError(failure); } }} className={primary}>Issue invoice</button></> : <><button type='button' disabled={busy} onClick={() => window.print()} className={secondary}><Printer aria-hidden='true' className='h-4 w-4' />Print / save PDF</button>{invoice.allowOnline && <button type='button' disabled={busy} onClick={() => run(() => api.syncInvoice(invoice.id), 'Payment status refreshed.')} className={secondary}>Refresh payment status</button>}</>}</div></div>
      <p role='status' aria-live='polite' className='mt-3 min-h-6 text-sm text-slate-600'>{busy ? 'Saving your update…' : message || (!issued ? dirty ? 'Unsaved changes' : invoice ? 'Draft saved' : '' : '')}</p>
      {(draft.allowOnline || invoice?.allowOnline) && <TestMode settings={settings} invoice={invoice} />}<Notice error={error}>{error?.status === 409 && <button type='button' disabled={busy} onClick={reload} className={secondary}>Reload latest invoice</button>}{error?.status === 401 && <Link to='/login' className={secondary}>Sign in again</Link>}</Notice>
      {confirm === 'issue' && <div ref={confirmation} role='region' aria-label='Confirm issue invoice' tabIndex={-1} className='mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4'><h2 className='font-bold'>Issue this invoice?</h2><p className='mt-2 text-sm leading-6'>{draft.recipientName} · {money(draftTotal(draft), draft.currency)} {draft.currency}. The amount and recipient details will be kept as issued.{draft.allowOnline ? ' You will get a payment link to share.' : ''} No email is sent.</p><div className='mt-4 flex flex-wrap gap-2'><button type='button' disabled={busy} onClick={issue} className={primary}>{busy ? 'Issuing…' : 'Issue invoice'}</button><button type='button' disabled={busy} onClick={() => setConfirm(null)} className={secondary}>Keep editing</button></div></div>}
    </div>
    {!issued ? <div className='invoice-no-print'><InvoiceDraft draft={draft} setDraft={setDraft} settings={settings} disabled={busy} /><div className='mt-5 flex flex-wrap items-center justify-between gap-3'><p className='text-xs leading-5 text-slate-500'>Only you can see a draft. Invoice details are shared through the payment link or a copy you provide.</p>{invoice && <button type='button' disabled={busy} onClick={() => askConfirm('delete')} className={`${button} text-rose-700 hover:bg-rose-50`}><Trash2 className='h-4 w-4' aria-hidden='true' />Delete draft</button>}</div></div> : <>
      {invoice.state === 'issuing' && <div className='invoice-no-print rounded-xl border border-amber-200 bg-amber-50 p-4'><p className='text-sm leading-6'>Issuing has not finished yet. Retrying uses the same invoice and payment request.</p><button type='button' disabled={busy} onClick={() => run(() => api.issueInvoice(invoice.id, invoice.revision), 'Invoice issued.')} className={`${primary} mt-3`}>Finish issuing invoice</button></div>}
      {invoice.state === 'voiding' && <div className='invoice-no-print rounded-xl border border-amber-200 bg-amber-50 p-4'><p className='text-sm'>Voiding has not finished. Retry to disable the payment link.</p><button type='button' disabled={busy} onClick={() => run(() => api.voidInvoice(invoice.id, invoice.revision), 'Invoice voided.')} className={`${secondary} mt-3`}>Finish voiding invoice</button></div>}
      {invoice.state === 'issued' && invoice.allowOnline && invoice.online?.hostedInvoiceUrl && invoice.balanceCents > 0 && <div className='invoice-no-print flex flex-wrap items-center justify-between gap-4 rounded-xl border border-violet-200 bg-violet-50 p-4'><div><h2 className='font-bold'>Ready to share</h2><p className='mt-1 text-sm leading-6 text-slate-600'>Send the payment link to the parent or student when you are ready.</p></div><div className='flex flex-wrap gap-2'><button type='button' onClick={copy} className={primary}><Copy aria-hidden='true' className='h-4 w-4' />Copy payment link</button><a href={invoice.online.hostedInvoiceUrl} target='_blank' rel='noreferrer' className={secondary}>View payment page<ExternalLink aria-hidden='true' className='h-4 w-4' /></a></div></div>}
      <InvoicePaper invoice={invoice} settings={settings} />
      <section className='invoice-no-print rounded-2xl border border-slate-200 bg-white p-4 sm:p-6'><div className='flex flex-wrap items-center justify-between gap-3'><h2 className='text-lg font-bold'>Payments</h2>{canRecord && !paymentOpen && <button type='button' onClick={() => { setPayment(current => ({ ...current, amount: moneyInput(invoice.balanceCents) })); setPaymentOpen(true); }} className={secondary}>Record offline payment</button>}</div>
        {invoice.pendingPayment && <div className='mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm'><p>A payment update still needs to finish. Retry safely using the same record.</p><button type='button' disabled={busy} onClick={() => run(() => api.retryPayment(invoice.id), 'Payment recorded.')} className={`${secondary} mt-3`}>Finish recording payment</button></div>}
        {invoice.pendingReversal && <div className='mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm'><p>A payment correction still needs to finish.</p><button type='button' disabled={busy} onClick={() => run(() => api.retryReversal(invoice.id), 'Payment corrected.')} className={`${secondary} mt-3`}>Finish correction</button></div>}
        {paymentOpen && <form onSubmit={record} className='mt-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4'><p className='text-sm text-slate-600'>{invoice.allowOnline && settings?.offlinePaymentsSupported === 'full-only' ? 'Record the remaining balance you already received outside the app. Partial offline payments use an offline-only invoice.' : 'Record money you already received. This does not charge anyone.'}</p><div className='grid gap-3 sm:grid-cols-2'><TextField title={`Amount (${invoice.currency})`} value={payment.amount} onChange={value => setPayment(current => ({ ...current, amount: value }))} inputMode='decimal' readOnly={invoice.allowOnline && settings?.offlinePaymentsSupported === 'full-only'} required /><TextField title='Payment date' type='date' value={payment.date} onChange={value => setPayment(current => ({ ...current, date: value }))} required /><label><span className={label}>Received by</span><select aria-label='Received by' value={payment.method} onChange={event => setPayment(current => ({ ...current, method: event.target.value }))} className={field}><option value='cash'>Cash</option><option value='check'>Check</option><option value='bank-transfer'>Bank transfer</option><option value='other'>Other</option></select></label><TextField title='Note' optional value={payment.note} onChange={value => setPayment(current => ({ ...current, note: value }))} maxLength={240} /></div><div className='flex flex-wrap gap-2'><button type='submit' disabled={busy} className={primary}>Record payment</button><button type='button' disabled={busy} onClick={() => setPaymentOpen(false)} className={secondary}>Cancel</button></div></form>}
        {invoice.allowOnline && <p className='mt-3 text-sm leading-6 text-slate-600'>Online payment status comes from the payment provider.{invoice.providerSyncedAt ? ` Last checked ${new Date(invoice.providerSyncedAt).toLocaleString()}.` : ''}{!settings?.offlinePaymentsSupported && invoice.balanceCents > 0 ? ' Offline payments on this invoice are managed through the payment account.' : ''}</p>}
        {!invoice.payments?.length ? <p className='mt-4 text-sm text-slate-500'>{invoice.paidCents > 0 ? `${money(invoice.paidCents, invoice.currency)} received through the payment account.${invoice.providerRefundedCents > 0 ? ` ${money(invoice.providerRefundedCents, invoice.currency)} refunded.` : ''}` : 'No payments recorded yet.'}</p> : <ul className='mt-4 divide-y divide-slate-100'>{invoice.payments.map(item => <li key={item.id} className='flex flex-wrap items-center justify-between gap-3 py-3'><div><p className='text-sm font-semibold'>{money(item.amountCents, invoice.currency)} · {item.method === 'bank-transfer' ? 'Bank transfer' : item.method[0].toUpperCase() + item.method.slice(1)}{item.reversedAt ? ' · Reversed' : ''}</p><p className='mt-1 text-xs leading-5 text-slate-600'>{dateLabel(item.date)}{item.note ? ` · ${item.note}` : ''}</p></div>{item.source === 'offline' && !item.reversedAt && !pending && (!invoice.allowOnline || settings?.reverseOfflineSupported) && <button type='button' disabled={busy} onClick={() => askConfirm({ reverse: item.id })} className={`${button} text-slate-600 hover:bg-slate-50`}>Correct payment</button>}</li>)}</ul>}
        {invoice.disputed && <p role='status' className='mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900'>This payment has a dispute. Refunds are paused while it is reviewed.</p>}
        {invoice.feeMismatch && <p role='status' className='mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900'>A payment fee needs review. The payment totals shown here are confirmed by Stripe.</p>}
        {invoice.providerPendingRefundCents > 0 && <p role='status' className='mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900'>{money(invoice.providerPendingRefundCents, invoice.currency)} refund pending. Payment status will update after Stripe confirms it. You can use Refresh payment status to check again.</p>}
        {!invoice.disputed && !invoice.providerPendingRefundCents && (invoice.refundableCents > 0 || invoice.pendingRefund) && <div className='mt-5 border-t border-slate-100 pt-4'><button type='button' disabled={busy || Boolean(invoice.pendingPayment || invoice.pendingReversal)} onClick={() => invoice.pendingRefund ? refund() : askConfirm('refund')} className={`${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>{invoice.pendingRefund ? 'Finish refund' : 'Refund online payment'}</button><p className='mt-2 text-xs leading-5 text-slate-500'>Refunds return online payment to its original payment method.</p></div>}
      </section>
      {invoice.state === 'issued' && invoice.paidCents === 0 && !pending && <div className='invoice-no-print flex justify-end'><button type='button' disabled={busy} onClick={() => askConfirm('void')} className={`${button} text-rose-700 hover:bg-rose-50`}>Void unpaid invoice</button></div>}
    </>}
    {confirm && confirm !== 'issue' && <div ref={confirmation} role='region' aria-label='Confirm invoice action' tabIndex={-1} className='invoice-no-print rounded-xl border border-amber-200 bg-amber-50 p-4'><h2 className='font-bold'>{confirm === 'delete' ? 'Delete this draft?' : confirm === 'void' ? 'Void this invoice?' : confirm === 'refund' ? `Refund ${money(invoice.refundableCents, invoice.currency)}?` : 'Reverse this recorded payment?'}</h2><p className='mt-2 text-sm leading-6'>{confirm === 'delete' ? 'This removes the draft from your records.' : confirm === 'void' ? 'The invoice will stay in your records. Its payment link will stop accepting payments.' : confirm === 'refund' ? 'This returns the remaining refundable online payment to the original payment method. It does not create a new amount due.' : 'This corrects your record. It does not send money to the recipient.'}</p><div className='mt-4 flex flex-wrap gap-2'><button type='button' disabled={busy} onClick={async () => { if (confirm === 'delete') { const result = await run(async () => { await api.deleteInvoice(invoice.id, invoice.revision); savedRef.current = JSON.stringify(draftRef.current); navigate('/invoices'); return true; }); return result; } if (confirm === 'void') return run(() => api.voidInvoice(invoice.id, invoice.revision), 'Invoice voided.'); if (confirm === 'refund') return refund(); return run(() => api.reversePayment(invoice.id, confirm.reverse, invoice.revision), 'Payment record corrected.'); }} className={primary}>{busy ? 'Saving…' : confirm === 'delete' ? 'Delete draft' : confirm === 'void' ? 'Void invoice' : confirm === 'refund' ? 'Refund payment' : 'Reverse record'}</button><button type='button' disabled={busy} onClick={() => setConfirm(null)} className={secondary}>Cancel</button></div></div>}
  </div>;
}

export default function InvoicesPage({ id = null }) {
  const { loading, tutor, googleClientId } = useAccount();
  return <Shell>{loading ? <p role='status' className='mt-6 text-sm text-slate-600'>Checking your account…</p> : !tutor ? <section className='invoice-no-print mt-6 max-w-lg rounded-2xl border border-violet-200 bg-white p-5'><h1 className='text-xl font-bold'>Sign in to manage invoices</h1><p className='my-3 text-sm leading-6 text-slate-600'>Your invoices and payment records stay in your teacher account.</p>{googleClientId ? <GoogleButton clientId={googleClientId} onSignedIn={() => {}} /> : <Link to='/login' className={secondary}>Go to sign in</Link>}</section> : id ? <InvoiceDetail key={`${tutor.id}:${id}`} id={id} tutor={tutor} /> : <InvoiceList key={tutor.id} />}</Shell>;
}
