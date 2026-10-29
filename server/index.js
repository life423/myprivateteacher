import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import { attachRealtime } from './realtime.js';
import { MAX_PICTURE_BYTES } from '../shared/pieces.js';
import { cleanPictureMetadata } from '../shared/pictureMetadata.js';
import { connectLibrary } from './library.js';
import { SESSION_COOKIE, SESSION_DAYS, connectAccounts, publicTutor, tutorAccess } from './accounts.js';
import { connectWords } from './words.js';
import { adminRoutes } from './admin.js';
import { PLAN_PRICE_CENTS, TRIAL_DAYS, connectBilling } from './billing.js';
import { closeDatabases, warmDatabase } from './db.js';

const PORT = Number(process.env.PORT) || 8080;
const CANONICAL_HOST = process.env.CANONICAL_HOST || 'myprivateteacher.com';
const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const ALLOWED_ORIGINS = new Set([
  `https://${CANONICAL_HOST}`,
  'http://localhost:3000',
  'http://localhost:8080',
  ...(process.env.EXTRA_ORIGINS ? process.env.EXTRA_ORIGINS.split(',') : []),
]);

const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000',
  // Google's sign-in button loads its own script, style and frame from accounts.google.com/gsi,
  // and styles itself inline (hence 'unsafe-inline' for styles only; scripts stay locked to
  // this site and Google sign-in). Profile pictures come from googleusercontent.com.
  'Content-Security-Policy': `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client; worker-src 'self'; font-src 'self' data:; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; frame-src https://accounts.google.com/gsi/; connect-src 'self' wss://${CANONICAL_HOST} https://accounts.google.com/gsi/; img-src 'self' data: blob: https://*.googleusercontent.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()', // camera and mic for video calls, this site only
};

// Sent to an old cached page in place of its old code (old-browser-friendly on purpose). It
// refetches the page, which updates the browser's saved copy, then reloads once.
const OLD_PAGE_RELOAD = `(function () {
  try {
    if (sessionStorage.getItem('old-page-reloaded')) return;
    sessionStorage.setItem('old-page-reloaded', '1');
  } catch (e) {}
  fetch('/', { cache: 'reload' }).catch(function () {}).then(function () { location.reload(); });
})();`;

// What kind of image the bytes really are (never trust the declared type), or null.
export function imageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// `pictures` connects the picture routes to the live rooms (see start()).
// A cookie's value from a Cookie header, or null.
function cookieFrom(header, name) {
  for (const part of (header || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

const cookieValue = (req, name) => cookieFrom(req.headers.cookie, name);

const isHttps = (req) => req.secure || req.get('x-forwarded-proto') === 'https';

// Starting a lesson. With billing switched on: a signed-in tutor with access (the owner, free
// access, or a current trial or plan; see tutorAccess). Without billing, anyone can, as before.
export function lessonGate({ accounts, billing } = {}) {
  if (!accounts || !billing) return async () => ({ ok: true });
  return async (cookieHeader) => {
    const tutor = await accounts.tutorFor(cookieFrom(cookieHeader, SESSION_COOKIE)).catch(() => null);
    if (!tutor) return { ok: false, reason: 'sign-in' };
    return tutorAccess(tutor).ok ? { ok: true } : { ok: false, reason: 'plan' };
  };
}

// A request made by this site's own pages (not a form or script on another website).
function sameSite(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

export function createApp({ pictures, library, accounts, billing, liveLessons, words } = {}) {
  const gate = lessonGate({ accounts, billing });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  // Every other host (www, the *.azurecontainerapps.io default name) redirects to the canonical one.
  app.use((req, res, next) => {
    if (req.hostname === CANONICAL_HOST || LOCAL_HOSTS.has(req.hostname)) return next();
    res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
  });

  app.use(compression());
  app.use((req, res, next) => {
    res.set(SECURITY_HEADERS);
    next();
  });

  // Authenticate before an asynchronous copy or request body can outlive a clear/rejoin.
  // Minimal picture adapters used by embedders/tests can still provide synchronous add.
  const beginPictureWrite = (req, res, next) => {
    if (pictures.beginWrite) {
      req.pictureWriteToken = pictures.beginWrite(req.params.code, req.get('x-room-key'));
      if (!req.pictureWriteToken) return res.sendStatus(403);
    }
    next();
  };

  // Whiteboard pictures: held in memory for one room, never written anywhere. Only the
  // room's tutor can add one; the address has a random 128-bit id, so it can't be guessed.
  if (pictures) {
    app.post('/api/rooms/:code/pictures/:id', beginPictureWrite, express.raw({ type: () => true, limit: MAX_PICTURE_BYTES }), (req, res) => {
      const type = imageType(req.body);
      if (!type) return res.status(415).json({ ok: false });
      const { status } = pictures.add({
        code: req.params.code,
        id: req.params.id,
        key: req.get('x-room-key'),
        w: Number(req.query.w),
        h: Number(req.query.h),
        type,
        bytes: req.body,
        ...cleanPictureMetadata(req.query),
        writeToken: req.pictureWriteToken,
      });
      res.status(status).json({ ok: status < 300 });
    });
    app.get('/api/rooms/:code/pictures/:id', (req, res) => {
      const pic = pictures.get(req.params.code, req.params.id);
      if (!pic) return res.sendStatus(404);
      res.set({ 'Content-Type': pic.type, 'Cache-Control': 'private, max-age=86400', 'Content-Security-Policy': `default-src 'none'` });
      res.send(pic.bytes);
    });
  }

  // The picture library, for the tutor of a live room: what's in it, and copying a card into
  // the room, where it becomes one of the session's pictures like any other.
  if (library && pictures) {
    const tutorOnly = (req, res, next) =>
      pictures.isTutor(req.params.code, req.get('x-room-key')) ? next() : res.sendStatus(403);
    app.get('/api/rooms/:code/library', tutorOnly, async (req, res) => {
      try {
        res.set('Cache-Control', 'no-store').json({ cards: await library.list() });
      } catch (error) {
        console.warn(`Library list failed: ${error.message}`);
        res.status(503).json({ cards: [] });
      }
    });
    // Preview a private catalog image without copying it into the live lesson.
    // The room key travels in a header, never in a URL or public Blob link.
    app.get('/api/rooms/:code/library/:card/image', tutorOnly, async (req, res) => {
      try {
        const card = await library.image(req.params.card);
        if (!card) return res.sendStatus(404);
        if (card.bytes.length > MAX_PICTURE_BYTES) return res.sendStatus(413);
        const type = imageType(card.bytes);
        if (!type) return res.sendStatus(415);
        res.set({ 'Content-Type': type, 'Cache-Control': 'private, no-store', 'Content-Security-Policy': `default-src 'none'` });
        res.send(card.bytes);
      } catch (error) {
        console.warn(`Library preview failed: ${error.message}`);
        res.sendStatus(503);
      }
    });
    app.post('/api/rooms/:code/pictures/:id/from-library/:card', tutorOnly, beginPictureWrite, async (req, res) => {
      try {
        const card = await library.image(req.params.card);
        if (!card) return res.sendStatus(404);
        if (card.bytes.length > MAX_PICTURE_BYTES) return res.sendStatus(413);
        const type = imageType(card.bytes);
        if (!type) return res.sendStatus(415);
        const key = req.get('x-room-key');
        const { status } = pictures.add({ code: req.params.code, key, id: req.params.id, w: card.w, h: card.h, type, bytes: card.bytes, regions: card.regions, library: req.params.card, title: card.title, writeToken: req.pictureWriteToken });
        res.status(status).json({ ok: status < 300 });
      } catch (error) {
        console.warn(`Library copy failed: ${error.message}`);
        res.sendStatus(503);
      }
    });
  }

  // Tutor accounts (Sign in with Google). Which tutor this browser is signed in as, if any,
  // and whether sign-in is available.
  const currentTutor = async (req) => (accounts ? accounts.tutorFor(cookieValue(req, SESSION_COOKIE)).catch(() => null) : null);
  // Phoneme Pop's words, by level. Anyone may read them; the game falls back to its own if this fails.
  if (words) {
    app.get('/api/words', async (req, res) => {
      try {
        const bank = await words.bank();
        res.set('Cache-Control', 'public, max-age=300').json(bank);
      } catch (error) {
        console.error('Word bank:', error.message);
        res.status(503).json({ error: 'The word bank is not available right now.' });
      }
    });
  }

  app.get('/api/me', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!accounts) return res.json({ tutor: null, signIn: null });
    const tutor = await currentTutor(req);
    res.json({
      tutor: tutor ? publicTutor(tutor) : null,
      signIn: { google: accounts.clientId },
      billing: billing ? { trialDays: TRIAL_DAYS } : null,
      lesson: await gate(req.headers.cookie), // may this person start a lesson now?
    });
  });
  if (accounts) {
    // The page hands over Google's credential; the server checks it with Google's keys, then
    // signs the browser in with a cookie that scripts can't read.
    app.post('/auth/google', express.json({ limit: '16kb' }), async (req, res) => {
      if (!sameSite(req)) return res.sendStatus(403);
      res.set('Cache-Control', 'no-store');
      const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
      let profile;
      try {
        profile = credential ? await accounts.verify(credential) : null;
      } catch (error) {
        console.warn(`Google verification failed: ${error.message}`);
        return res.status(401).json({ error: 'That Google account could not be used.' });
      }
      if (!profile) return res.status(401).json({ error: 'That Google account could not be used.' });
      try {
        const { token, tutor } = await accounts.signIn(profile, { userAgent: req.get('user-agent') || '' });
        res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: isHttps(req), sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86400000 });
        res.json({ tutor: publicTutor(tutor) });
      } catch (error) {
        console.warn(`Google session failed: ${error.message}`);
        res.set('Retry-After', '5').status(503).json({ error: 'Sign-in is temporarily unavailable. Please try again in a moment.' });
      }
    });
    app.post('/auth/logout', async (req, res) => {
      if (!sameSite(req)) return res.sendStatus(403);
      await accounts.signOut(cookieValue(req, SESSION_COOKIE)).catch(() => {});
      res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: isHttps(req) });
      res.sendStatus(204);
    });
  }

  // Billing with Stripe (tutors only): Checkout for the free trial and plan, Stripe's billing
  // page, and Stripe's notifications. Checkout and billing need a signed-in tutor and this
  // site's own pages; notifications are accepted only with Stripe's signature.
  if (accounts && billing) {
    const origin = (req) => `${isHttps(req) ? 'https' : 'http'}://${req.get('host')}`;
    const planOf = (summary) => summary && { status: summary.status, trialEnd: summary.trialEnd, periodEnd: summary.periodEnd, cancelAtPeriodEnd: summary.cancelAtPeriodEnd };
    const billingPage = (open) => async (req, res) => {
      if (!sameSite(req)) return res.sendStatus(403);
      const tutor = await currentTutor(req);
      if (!tutor) return res.status(401).json({ error: 'Sign in first.' });
      try {
        res.set('Cache-Control', 'no-store').json({ url: await open(tutor, origin(req)) });
      } catch (error) {
        console.warn(`Billing page failed: ${error.message}`);
        res.status(502).json({ error: 'Billing is not available right now. Please try again.' });
      }
    };
    app.post('/api/billing/checkout', billingPage((tutor, at) => billing.checkout(tutor, at)));
    app.post('/api/billing/portal', billingPage((tutor, at) => billing.portal(tutor, at)));
    app.get('/api/billing/done', async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const tutor = await currentTutor(req);
      if (!tutor) return res.status(401).json({ error: 'Sign in first.' });
      const id = typeof req.query.session_id === 'string' && /^cs_[A-Za-z0-9_]{10,250}$/.test(req.query.session_id) ? req.query.session_id : null;
      if (!id) return res.status(400).json({ error: 'That checkout link is not complete.' });
      try {
        res.json({ plan: planOf(await billing.completeCheckout(id, tutor)) });
      } catch (error) {
        console.warn(`Checkout confirmation failed: ${error.message}`);
        res.status(502).json({ error: 'Could not confirm with Stripe yet. Please refresh in a moment.' });
      }
    });
    app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
      let event;
      try {
        event = billing.event(req.body, req.get('stripe-signature') || '');
      } catch (error) {
        console.warn(`Stripe notification rejected: ${error.message}`);
        return res.sendStatus(400);
      }
      try {
        await billing.handle(event);
        res.json({ received: true });
      } catch (error) {
        console.warn(`Stripe notification ${event.type} failed: ${error.message}`);
        res.sendStatus(500); // Stripe tries again later
      }
    });
  }

  // The owner's admin panel (owners only, checked on every request).
  if (accounts) app.use('/api/admin', adminRoutes({ accounts, billing, currentTutor, sameSite, liveLessons, planPrice: PLAN_PRICE_CENTS }));

  // Pages from the site's old version (a Create React App build) can still be saved in a
  // browser's cache. They ask for their old code under /static, which no longer exists: answer
  // with a script that refreshes the browser's copy of the page and reloads, so the visitor lands
  // on the current site instead of a blank page. Their old styles get an empty stylesheet.
  app.get(/^\/static\/js\/[^/]+\.js$/, (req, res) => {
    res.set('Cache-Control', 'no-store').type('application/javascript').send(OLD_PAGE_RELOAD);
  });
  app.get(/^\/static\/css\/[^/]+\.css$/, (req, res) => {
    res.set('Cache-Control', 'no-store').type('text/css').send('');
  });

  // Hashed build assets cache forever; a missing one is a 404, not the app shell.
  app.use(
    '/assets',
    express.static(path.join(DIST, 'assets'), { immutable: true, maxAge: '1y', index: false }),
    (req, res) => res.sendStatus(404),
  );

  // Everything else revalidates on each visit.
  app.use(express.static(DIST, { index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

  // Client-side routes (/, /phoneme-pop, /whiteboard/4827, ...) all get the app shell.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(DIST, 'index.html'));
  });

  return app;
}

export function start(port = PORT) {
  // The picture routes reach the live rooms through this, once the realtime server exists.
  let realtime = null;
  const pictures = {
    beginWrite: (code, key) => realtime.pictures.beginWrite(code, key),
    add: (upload) => realtime.pictures.add(upload),
    get: (code, id) => realtime.pictures.get(code, id),
    isTutor: (code, key) => realtime.pictures.isTutor(code, key),
  };
  warmDatabase(process.env.MONGODB_URI); // connect now, not on the first visitor's request
  const library = connectLibrary();
  const accounts = connectAccounts();
  if (accounts) console.log('Tutor sign-in connected');
  const words = connectWords();
  if (words) console.log('Word bank connected');
  const billing = connectBilling({ accounts });
  if (billing) console.log('Billing connected');
  if (library) console.log('Picture library connected');
  // Lessons running now, for the admin panel (the realtime server starts just below).
  const liveLessons = () => (realtime ? { lessons: realtime.rooms.size, withStudent: [...realtime.rooms.values()].filter((r) => r.student).length } : null);
  const server = http.createServer(createApp({ pictures, library, accounts, billing, liveLessons, words }));
  realtime = attachRealtime(server, {
    allowedOrigins: ALLOWED_ORIGINS,
    turn: { host: process.env.TURN_HOST, secret: process.env.TURN_SECRET, tls: process.env.TURN_TLS === 'true' },
    canStartLesson: lessonGate({ accounts, billing }),
  });

  server.listen(port, () => {
    // The container binds port 80 as root, then runs as the unprivileged node user.
    if (process.getuid?.() === 0) {
      try {
        process.setgid('node');
        process.setuid('node');
      } catch (error) {
        console.warn(`Still running as root: ${error.message}`);
      }
    }
    console.log(`My Private Teacher listening on ${port}`);
  });

  const shutdown = () => {
    realtime.close();
    library?.close();
    accounts?.close();
    closeDatabases();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
