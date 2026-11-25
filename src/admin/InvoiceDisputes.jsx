import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { INVOICE_CURRENCIES } from '../../shared/invoices.js';

const action = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 motion-reduce:transition-none disabled:cursor-wait disabled:opacity-50';
const labels = { needs_response: 'Needs response', under_review: 'Under review', won: 'Won', lost: 'Lost', warning_needs_response: 'Inquiry needs response', warning_under_review: 'Inquiry under review', warning_closed: 'Inquiry closed', prevented: 'Prevented' };
const needsResponse = dispute => ['needs_response', 'warning_needs_response'].includes(dispute.status);
export function disputeDashboardUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'dashboard.stripe.com' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function disputeAmount(dispute) {
  const currency = typeof dispute.currency === 'string' ? dispute.currency.toUpperCase() : '';
  if (!INVOICE_CURRENCIES.includes(currency) || !Number.isSafeInteger(dispute.amountCents) || dispute.amountCents < 0) return 'Amount unavailable';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'code' }).format(dispute.amountCents / 100);
}
function EvidenceDeadline({ dueBy }) {
  if (!Number.isSafeInteger(dueBy) || dueBy <= 0) return <span>No evidence deadline</span>;
  const date = new Date(dueBy * 1000);
  if (!Number.isFinite(+date)) return <span>Deadline unavailable</span>;
  return <span>Evidence due <time dateTime={date.toISOString()}>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date)}</time></span>;
}
function Dispute({ dispute }) {
  const url = disputeDashboardUrl(dispute.dashboardUrl);
  const tone = needsResponse(dispute) ? 'border-amber-200 bg-amber-50 text-amber-900' : dispute.status === 'won' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : dispute.status === 'lost' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-slate-200 bg-slate-100 text-slate-700';
  return <li className='min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5'>
    <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center gap-3'><h4 className='text-lg font-bold text-slate-900'>{disputeAmount(dispute)}</h4><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{labels[dispute.status] || 'Status unavailable'}</span></div>
        <p className='mt-2 break-words text-sm font-semibold text-slate-700'>{dispute.ownerName || dispute.ownerEmail || 'Teacher account'}</p>
        {dispute.ownerName && dispute.ownerEmail && <p className='mt-1 break-all text-xs text-slate-600'>{dispute.ownerEmail}</p>}
        {!dispute.ownerName && !dispute.ownerEmail && <p className='mt-1 break-all font-mono text-xs text-slate-500'>{dispute.ownerId}</p>}
        <p className='mt-3 text-sm leading-6 text-slate-600'><EvidenceDeadline dueBy={dispute.dueBy} /></p>
        <p className='mt-1 break-all text-xs text-slate-500'>Dispute {dispute.id}</p>
      </div>
      {url ? <a href={url} target='_blank' rel='noopener noreferrer' className={`${action} w-full shrink-0 sm:w-auto`} aria-label={`Review dispute ${dispute.id} in Stripe (opens a new tab)`}>Review in Stripe<ExternalLink size={16} aria-hidden='true' /></a> : <p className='text-sm text-slate-600'>Stripe review link unavailable</p>}
    </div>
  </li>;
}

export default function InvoiceDisputes() {
  const [data, setData] = useState(null), [error, setError] = useState(null), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    Promise.resolve().then(async () => {
      const response = await fetch('/api/admin/invoice-payments/disputes', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      const reply = await response.json().catch(() => null);
      if (!response.ok) throw new Error(reply?.error || 'Lesson payments could not be loaded. Please try again.');
      if (typeof reply?.configured !== 'boolean' || !Array.isArray(reply.disputes) || reply.disputes.length > 2000 || reply.disputes.some(dispute => !dispute || typeof dispute.id !== 'string' || typeof dispute.status !== 'string')) throw new Error('The server returned an incomplete reply. Please try again.');
      if (!controller.signal.aborted) setData(reply);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof TypeError ? 'Could not connect. Check your connection and try again.' : failure?.message || 'Could not connect. Please try again.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  const disputes = [...(data?.disputes || [])].sort((a, b) => Number(needsResponse(b)) - Number(needsResponse(a)) || (a.dueBy || Infinity) - (b.dueBy || Infinity) || String(a.id).localeCompare(String(b.id)));
  const mode = !data?.configured ? 'Not connected' : data.livemode === true ? 'Live mode' : data.livemode === false ? 'Test mode' : 'Connected';
  return <section className='min-w-0 space-y-5' aria-labelledby='lesson-payments-heading' aria-busy={loading}>
    <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
      <div><div className='flex flex-wrap items-center gap-3'><h2 id='lesson-payments-heading' className='text-lg font-bold text-slate-900'>Lesson payments</h2>{data && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${data.configured ? data.livemode === false ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900' : 'bg-slate-200 text-slate-700'}`}>{mode}</span>}</div><p className='mt-2 max-w-xl text-sm leading-6 text-slate-600'>Review disputes for student and parent invoice payments.</p></div>
      <button type='button' className={`${action} self-start`} disabled={loading} onClick={() => setRetry(value => value + 1)}><RefreshCw size={16} aria-hidden='true' />{loading && data ? 'Refreshing…' : 'Refresh'}</button>
    </div>
    {error && <p role='alert' className='rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-800'>{error}</p>}
    {loading && !data && <p role='status' className='rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600'>Loading lesson payments…</p>}
    {data && !data.configured ? <div className='rounded-2xl border border-slate-200 bg-white p-5'><h3 className='font-bold text-slate-900'>Finish Stripe setup</h3><p className='mt-2 max-w-xl text-sm leading-6 text-slate-600'>Connect the platform’s Stripe account and finish invoice payment setup to track payments and review disputes here.</p></div> : data && <div className='space-y-3'><h3 className='text-base font-bold text-slate-900'>Payment disputes</h3>{disputes.length ? <ul className='grid gap-3'>{disputes.map(dispute => <Dispute key={dispute.id} dispute={dispute} />)}</ul> : <p className='rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-600'>No payment disputes to review.</p>}</div>}
  </section>;
}
