import express from 'express';

export function installInvoicePaymentRoutes({ app, payments, invoices, currentTutor, sameSite = () => false }) {
  app.post('/api/invoice-payments/dashboard', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const tutor = await currentTutor(req);
    if (!tutor) return res.status(401).json({ error: 'Sign in first.' });
    if (!sameSite(req)) return res.status(403).json({ error: 'Open payment settings from this site.' });
    if (!payments?.dashboard) return res.status(503).json({ error: 'Your payment account is not available right now.' });
    try { res.json(await payments.dashboard(tutor.id)); }
    catch { res.status(503).json({ error: 'Your payment account could not be opened. Please try again.' }); }
  });
  // Separate signing secrets and endpoints from tutor subscription notifications.
  app.post('/api/stripe/invoices/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!payments || !invoices) return res.sendStatus(503);
    let event;
    try { event = payments.event(req.body, req.get('stripe-signature') || ''); }
    catch { return res.sendStatus(400); }
    try { await payments.handle(event, invoices); res.json({ received: true }); }
    catch { console.warn('Invoice payment notification could not be reconciled.'); res.sendStatus(500); }
  });
  app.post('/api/stripe/connect/events', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!payments) return res.sendStatus(503);
    let event;
    try { event = payments.connectEvent(req.body, req.get('stripe-signature') || ''); }
    catch { return res.sendStatus(400); }
    try { await payments.handleConnect(event); res.json({ received: true }); }
    catch { console.warn('Teacher payment account notification could not be reconciled.'); res.sendStatus(500); }
  });
  app.get('/api/admin/invoice-payments/disputes', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const tutor = await currentTutor(req);
    if (!tutor) return res.status(401).json({ error: 'Sign in first.' });
    if (!tutor.roles?.includes('owner')) return res.status(403).json({ error: 'This page is for the site owner.' });
    if (!payments) return res.json({ disputes: [], configured: false });
    try { res.json({ disputes: await payments.disputes(), configured: true, livemode: payments.livemode }); }
    catch { res.status(503).json({ error: 'Payment disputes could not be loaded. Please try again.' }); }
  });
}
