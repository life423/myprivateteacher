import express from 'express';
import { MAX_PICTURE_BYTES } from '../shared/pieces.js';

export function lessonRoutes({ lessons, currentTutor, sameSite, library, imageType }) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const tutor = await currentTutor(req);
    if (!tutor) return res.status(401).json({ error: 'Sign in first.' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameSite(req)) return res.status(403).json({ error: 'Use this site to change your lessons.' });
    if (!lessons) return res.status(503).json({ error: 'Saved lessons are not available right now.' });
    req.lessonOwner = tutor.id;
    next();
  });
  const handle = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      const status = [400, 401, 403, 404, 409, 413, 415].includes(error.status) ? error.status : 503;
      if (status === 503) console.warn(`Saved lesson ${req.method} failed.`);
      if (!res.headersSent) res.status(status).json({ error: status === 503 ? 'Saved lessons could not be updated. Please try again.' : error.message });
    }
  };
  const json = express.json({ limit: '256kb' });
  // Catalog access is account-authenticated and never needs a live room key.
  router.get('/catalog', handle(async (_req, res) => {
    if (!library) return res.status(503).json({ error: 'The card library is not available right now.' });
    res.json({ cards: await library.list() });
  }));
  router.get('/catalog/:id/image', handle(async (req, res) => {
    const card = library && await library.image(req.params.id);
    if (!card) return res.status(404).json({ error: 'No such card.' });
    if (card.bytes.length > MAX_PICTURE_BYTES) return res.sendStatus(413);
    const type = imageType(card.bytes);
    if (!type) return res.sendStatus(415);
    res.set({ 'Content-Type': type, 'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff' }).send(card.bytes);
  }));
  router.get('/', handle(async (req, res) => res.json({ lessons: await lessons.list(req.lessonOwner) })));
  router.post('/', json, handle(async (req, res) => res.status(201).json({ lesson: await lessons.create(req.lessonOwner, req.body) })));
  router.get('/:id', handle(async (req, res) => res.json({ lesson: await lessons.get(req.lessonOwner, req.params.id) })));
  router.put('/:id', json, handle(async (req, res) => res.json({ lesson: await lessons.save(req.lessonOwner, req.params.id, req.body) })));
  router.delete('/:id', json, handle(async (req, res) => { await lessons.remove(req.lessonOwner, req.params.id, req.body?.revision); res.sendStatus(204); }));
  router.post('/:id/assets/:assetId', express.raw({ type: () => true, limit: MAX_PICTURE_BYTES }), handle(async (req, res) => {
    const type = imageType(req.body);
    if (!type) return res.status(415).json({ error: 'Upload a prepared picture, not the original document.' });
    const asset = await lessons.putAsset(req.lessonOwner, req.params.id, req.params.assetId, {
      bytes: req.body, type, w: Number(req.get('x-image-width') ?? req.query.w), h: Number(req.get('x-image-height') ?? req.query.h),
    });
    res.status(201).json({ asset });
  }));
  router.get('/:id/assets/:assetId', handle(async (req, res) => {
    const asset = await lessons.getAsset(req.lessonOwner, req.params.id, req.params.assetId);
    res.set({ 'Content-Type': asset.type, 'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff' }).send(asset.data);
  }));
  router.delete('/:id/assets/:assetId', handle(async (req, res) => { await lessons.removeAsset(req.lessonOwner, req.params.id, req.params.assetId); res.sendStatus(204); }));
  router.use((error, _req, res, _next) => res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: error.type === 'entity.too.large' ? 'This lesson or image is too large.' : 'The request could not be read.' }));
  return router;
}
