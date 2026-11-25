import express from 'express';

export function invoiceRoutes({ invoices, currentTutor, sameSite }) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const tutor = await currentTutor(req);
    if (!tutor) return res.status(401).json({ error: 'Sign in first.' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameSite(req)) return res.status(403).json({ error: 'Use this site to change your invoices.' });
    if (!invoices) return res.status(503).json({ error: 'Invoices are not available right now.' });
    req.invoiceOwner = tutor.id; next();
  });
  const json = express.json({ limit: '64kb' });
  const handle = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      const status = [400, 401, 403, 404, 409].includes(error.status) ? error.status : 503;
      if (status === 503) console.warn(`Invoice ${req.method} failed.`);
      if (!res.headersSent) res.status(status).json({ error: status === 503 ? 'Invoices could not be updated. Your saved details are still here. Please try again.' : error.message });
    }
  };
  router.get('/payment-settings', handle(async (req, res) => res.json({ settings: await invoices.paymentSettings(req.invoiceOwner) })));
  router.post('/connect', json, handle(async (req, res) => res.json(await invoices.connectPayments(req.invoiceOwner, { returnPath: '/invoices', refreshPath: '/invoices?connect=refresh' }))));
  router.get('/from-appointment/:id', handle(async (req, res) => res.json(await invoices.fromAppointment(req.invoiceOwner, req.params.id))));
  router.get('/', handle(async (req, res) => res.json({ invoices: await invoices.list(req.invoiceOwner) })));
  router.post('/', json, handle(async (req, res) => res.status(201).json({ invoice: await invoices.create(req.invoiceOwner, req.body) })));
  router.get('/:id', handle(async (req, res) => res.json({ invoice: await invoices.get(req.invoiceOwner, req.params.id) })));
  router.put('/:id', json, handle(async (req, res) => res.json({ invoice: await invoices.save(req.invoiceOwner, req.params.id, req.body) })));
  router.delete('/:id', json, handle(async (req, res) => { await invoices.remove(req.invoiceOwner, req.params.id, req.body?.revision); res.sendStatus(204); }));
  router.post('/:id/issue', json, handle(async (req, res) => res.json({ invoice: await invoices.issue(req.invoiceOwner, req.params.id, req.body?.revision) })));
  router.post('/:id/void', json, handle(async (req, res) => res.json({ invoice: await invoices.void(req.invoiceOwner, req.params.id, req.body?.revision) })));
  router.post('/:id/sync', handle(async (req, res) => res.json({ invoice: await invoices.sync(req.invoiceOwner, req.params.id) })));
  router.post('/:id/payments', json, handle(async (req, res) => res.json({ invoice: await invoices.recordPayment(req.invoiceOwner, req.params.id, req.body) })));
  router.post('/:id/refunds', json, handle(async (req, res) => res.json({ invoice: await invoices.refund(req.invoiceOwner, req.params.id, req.body) })));
  router.post('/:id/payments/retry', handle(async (req, res) => res.json({ invoice: await invoices.retryPayment(req.invoiceOwner, req.params.id) })));
  router.post('/:id/payments/retry-reversal', handle(async (req, res) => res.json({ invoice: await invoices.retryReversal(req.invoiceOwner, req.params.id) })));
  router.post('/:id/payments/:paymentId/reverse', json, handle(async (req, res) => res.json({ invoice: await invoices.reversePayment(req.invoiceOwner, req.params.id, req.params.paymentId, req.body?.revision) })));
  return router;
}
