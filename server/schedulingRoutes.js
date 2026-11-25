import express from 'express';

export function schedulingRoutes({ scheduling, currentTutor, sameSite }) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const tutor = await currentTutor(req);
    if (!tutor) return res.status(401).json({ error: 'Sign in to use your calendar.' });
    if (!['GET', 'HEAD'].includes(req.method) && !sameSite(req)) return res.status(403).json({ error: 'Use this site to change your calendar.' });
    if (!scheduling) return res.status(503).json({ error: 'Your calendar is not available right now. Please try again.' });
    req.scheduleOwner = tutor.id; next();
  });
  const handle = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      const status = [400, 401, 403, 404, 409, 413].includes(error.status) ? error.status : 503;
      if (status === 503) console.warn(`Calendar ${req.method} failed.`);
      if (!res.headersSent) res.status(status).json({ error: status === 503 ? 'Your calendar could not be updated. Please try again.' : error.message });
    }
  };
  const json = express.json({ limit: '32kb' });
  router.get('/', handle(async (req, res) => res.json(await scheduling.list(req.scheduleOwner, req.query))));
  router.post('/', json, handle(async (req, res) => res.status(201).json({ appointment: await scheduling.create(req.scheduleOwner, req.body) })));
  router.get('/occurrences/:id', handle(async (req, res) => res.json({ occurrence: await scheduling.occurrence(req.scheduleOwner, req.params.id, req.query.timeZone) })));
  router.get('/:id', handle(async (req, res) => res.json({ appointment: await scheduling.get(req.scheduleOwner, req.params.id) })));
  router.put('/:id', json, handle(async (req, res) => res.json({ appointment: await scheduling.save(req.scheduleOwner, req.params.id, req.body) })));
  router.patch('/:id/occurrences/:date', json, handle(async (req, res) => res.json({ appointment: await scheduling.changeOccurrence(req.scheduleOwner, req.params.id, req.params.date, req.body) })));
  router.delete('/:id', json, handle(async (req, res) => res.json({ appointment: await scheduling.cancel(req.scheduleOwner, req.params.id, req.body?.revision) })));
  router.use((error, _req, res, _next) => res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: error.type === 'entity.too.large' ? 'This calendar request is too large.' : 'The calendar request could not be read.' }));
  return router;
}
