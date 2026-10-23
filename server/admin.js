import express from 'express';
import { tutorAccess } from './accounts.js';

// The owner's admin panel: every tutor and their access, free access (with an end date or
// none), a free extension, signing someone out everywhere, and a record of every action. Each
// request needs a signed-in owner; changes also need this site's own pages, like the rest of
// the app. Students never appear here: they have no accounts.
const DAY = 86400000;
const ID = /^[a-f0-9]{24}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

// An end date in the future (at most ten years away), or null for no end; undefined if invalid.
function untilFrom(value) {
  if (value === null || value === undefined || value === '') return null;
  const at = new Date(value).getTime();
  if (!Number.isFinite(at) || at <= Date.now() || at > Date.now() + 3650 * DAY) return undefined;
  return at;
}
const noteFrom = (value) => String(value ?? '').trim().slice(0, 120);
const planOf = (s) => s && { status: s.status, trialEnd: s.trialEnd ?? null, periodEnd: s.periodEnd ?? null, cancelAtPeriodEnd: Boolean(s.cancelAtPeriodEnd) };
const view = (t) => ({
  id: t.id,
  email: t.email,
  name: t.name,
  picture: t.picture,
  createdAt: t.createdAt,
  lastSignInAt: t.lastSignInAt,
  roles: t.roles,
  comp: t.comp,
  plan: planOf(t.subscription),
  access: tutorAccess(t),
});

export function adminRoutes({ accounts, billing, currentTutor, sameSite }) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const me = await currentTutor(req);
    if (!me) return res.status(401).json({ error: 'Sign in first.' });
    if (!me.roles?.includes('owner')) return res.status(403).json({ error: 'Only the owner can use the admin panel.' });
    if (req.method !== 'GET' && !sameSite(req)) return res.sendStatus(403);
    req.owner = { id: me.id, email: me.email };
    next();
  });
  router.use(express.json({ limit: '16kb' }));

  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      console.warn(`Admin ${req.method} ${req.path} failed: ${error.message}`);
      if (!res.headersSent) res.status(502).json({ error: 'That didn’t work. Please try again.' });
    }
  };
  const target = async (req, res) => {
    const t = ID.test(req.params.id) ? await accounts.tutorById(req.params.id) : null;
    if (!t) res.status(404).json({ error: 'No such tutor.' });
    return t;
  };
  const record = (req, action, who, detail = {}) =>
    accounts.record({ by: req.owner, action, target: who ? { id: who.id ?? null, email: who.email } : null, detail });
  const fresh = async (id) => view(await accounts.tutorById(id));

  router.get(
    '/tutors',
    handle(async (req, res) => {
      const [all, grants] = await Promise.all([accounts.listTutors(), accounts.listGrants()]);
      res.json({ tutors: all.map(view), grants, billing: Boolean(billing) });
    }),
  );

  // Free access, until a date or with no end (until: null).
  router.post(
    '/tutors/:id/comp',
    handle(async (req, res) => {
      const t = await target(req, res);
      if (!t) return;
      const until = untilFrom(req.body?.until);
      if (until === undefined) return res.status(400).json({ error: 'Pick a date in the future, or no end date.' });
      const note = noteFrom(req.body?.note);
      await accounts.setComp(t.id, { until, note }, req.owner);
      await record(req, 'comp', t, { until, note });
      res.json({ tutor: await fresh(t.id) });
    }),
  );
  router.delete(
    '/tutors/:id/comp',
    handle(async (req, res) => {
      const t = await target(req, res);
      if (!t) return;
      await accounts.setComp(t.id, null, req.owner);
      await record(req, 'uncomp', t);
      res.json({ tutor: await fresh(t.id) });
    }),
  );

  // A free extension. On a Stripe trial or plan, the next charge moves back by that many days
  // (Stripe never bills for the added time); otherwise free access is extended, or given.
  router.post(
    '/tutors/:id/extend',
    handle(async (req, res) => {
      const t = await target(req, res);
      if (!t) return;
      const days = Math.round(Number(req.body?.days ?? 30));
      if (!(days >= 1 && days <= 365)) return res.status(400).json({ error: 'Extend by 1 to 365 days.' });
      const access = tutorAccess(t);
      if (access.kind === 'owner') return res.status(409).json({ error: 'The owner never needs extending.' });
      if (access.kind === 'comp' && !access.until) return res.status(409).json({ error: 'They already have free access with no end date.' });
      let detail;
      if (access.kind === 'plan' && billing?.extend) {
        const plan = await billing.extend(t, days);
        detail = { days, how: 'plan', until: plan?.trialEnd ?? null };
      } else {
        const until = Math.max(Date.now(), t.comp?.until || 0) + days * DAY;
        await accounts.setComp(t.id, { until, note: t.comp?.note || `Free extension, ${days} days` }, req.owner);
        detail = { days, how: 'comp', until };
      }
      await record(req, 'extend', t, detail);
      res.json({ tutor: await fresh(t.id), ...detail });
    }),
  );

  router.post(
    '/tutors/:id/sign-out',
    handle(async (req, res) => {
      const t = await target(req, res);
      if (!t) return;
      const sessions = await accounts.signOutEverywhere(t.id);
      await record(req, 'sign-out', t, { sessions });
      res.json({ signedOut: sessions });
    }),
  );

  // Free access for an email: given straight away if they've signed in before, otherwise it
  // waits for that email's first sign-in.
  router.post(
    '/grants',
    handle(async (req, res) => {
      const email = String(req.body?.email || '')
        .trim()
        .toLowerCase();
      if (!EMAIL.test(email)) return res.status(400).json({ error: 'That doesn’t look like an email address.' });
      const until = untilFrom(req.body?.until);
      if (until === undefined) return res.status(400).json({ error: 'Pick a date in the future, or no end date.' });
      const note = noteFrom(req.body?.note);
      const result = await accounts.grantByEmail(email, { comp: { until, note } }, req.owner);
      await record(req, 'grant', { email }, { until, note, applied: result.applied });
      res.json(result);
    }),
  );
  router.delete(
    '/grants/:email',
    handle(async (req, res) => {
      const email = String(req.params.email || '').toLowerCase();
      await accounts.removeGrant(email);
      await record(req, 'ungrant', { email });
      res.json({ ok: true });
    }),
  );

  router.get(
    '/activity',
    handle(async (req, res) => {
      res.json({ activity: await accounts.listActivity(100) });
    }),
  );
  return router;
}
