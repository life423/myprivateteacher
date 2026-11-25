export class InvoiceError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'InvoiceError'; this.status = status; }
}
async function request(path, { signal, ...options } = {}) {
  let response;
  try { response = await fetch(path.startsWith('/api/') ? path : `/api/invoices${path}`, { credentials: 'same-origin', cache: 'no-store', ...options, signal }); }
  catch (error) { if (error.name === 'AbortError') throw error; throw new InvoiceError('Could not connect. Your entries are still here. Please try again.'); }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new InvoiceError(response.status === 401 ? 'Sign in again to continue. Your entries are still here.' : data?.error || 'This invoice could not be updated. Please try again.', response.status);
  if (!data && response.status !== 204) throw new InvoiceError('The server returned an incomplete reply. Please try again.');
  return data;
}
const json = (method, body, options) => ({ ...options, method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const invoice = data => { if (!data?.invoice?.id) throw new InvoiceError('The server returned an incomplete invoice. Please refresh.'); return data.invoice; };
const segment = value => encodeURIComponent(value);
export const listInvoices = async options => { const data = await request('', options); if (!Array.isArray(data?.invoices)) throw new InvoiceError('Your invoices could not be loaded.'); return data.invoices; };
export const getInvoice = async (id, options) => invoice(await request(`/${segment(id)}`, options));
export const createInvoice = async (body, options) => invoice(await request('', json('POST', body, options)));
export const saveInvoice = async (id, body, options) => invoice(await request(`/${segment(id)}`, json('PUT', body, options)));
export const issueInvoice = async (id, revision, options) => invoice(await request(`/${segment(id)}/issue`, json('POST', { revision }, options)));
export const voidInvoice = async (id, revision, options) => invoice(await request(`/${segment(id)}/void`, json('POST', { revision }, options)));
export const deleteInvoice = (id, revision, options) => request(`/${segment(id)}`, json('DELETE', { revision }, options));
export const syncInvoice = async (id, options) => invoice(await request(`/${segment(id)}/sync`, { ...options, method: 'POST' }));
export const recordPayment = async (id, body, options) => invoice(await request(`/${segment(id)}/payments`, json('POST', body, options)));
export const reversePayment = async (id, paymentId, revision, options) => invoice(await request(`/${segment(id)}/payments/${segment(paymentId)}/reverse`, json('POST', { revision }, options)));
export const retryPayment = async (id, options) => invoice(await request(`/${segment(id)}/payments/retry`, { ...options, method: 'POST' }));
export const retryReversal = async (id, options) => invoice(await request(`/${segment(id)}/payments/retry-reversal`, { ...options, method: 'POST' }));
export const refundPayment = async (id, body, options) => invoice(await request(`/${segment(id)}/refunds`, json('POST', body, options)));
export const paymentSettings = async options => (await request('/payment-settings', options)).settings;
export const connectPayments = options => request('/connect', { ...options, method: 'POST' });
export const managePayments = options => request('/api/invoice-payments/dashboard', { ...options, method: 'POST' });
export const invoiceFromAppointment = (id, options) => request(`/from-appointment/${segment(id)}`, options);
