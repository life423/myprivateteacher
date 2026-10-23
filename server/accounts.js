import { createHash, randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { mongoClient } from './db.js';
import { OAuth2Client } from 'google-auth-library';

// Tutor accounts: Sign in with Google, with sessions kept in MongoDB. Only a fingerprint
// (SHA-256) of each session token is stored, so the database alone can't sign anyone in.
// Off unless MONGODB_URI and GOOGLE_CLIENT_ID are set. Students never need an account.
export const SESSION_COOKIE = 'mpt_session';
export const SESSION_DAYS = 30;
const fingerprint = (token) => createHash('sha256').update(token).digest('hex');
// Test and live Stripe are kept apart: each tutor has a billing slot per Stripe mode, and the
// server uses the one matching its key (sk_live_ is live, anything else is test).
export const stripeMode = (key) => (/^(sk|rk)_live_/.test(key || '') ? 'live' : 'test');

const time = (d) => (d ? new Date(d).getTime() : null);
const CURRENT_PLAN = new Set(['trialing', 'active', 'past_due']); // past due: while Stripe retries the card

// Whether a tutor may teach, and why: the owner always; free access (a comp) until it ends,
// or forever; or a Stripe trial or plan that's current. Everything that asks (the lesson
// check, the account menu, the admin panel) asks this, so they always agree.
export function tutorAccess(t, now = Date.now()) {
  if (t?.roles?.includes('owner')) return { ok: true, kind: 'owner', until: null };
  if (t?.comp && (!t.comp.until || t.comp.until > now)) return { ok: true, kind: 'comp', until: t.comp.until || null };
  if (CURRENT_PLAN.has(t?.subscription?.status)) {
    return { ok: true, kind: 'plan', until: t.subscription.trialEnd || t.subscription.periodEnd || null };
  }
  return { ok: false, kind: null, until: null };
}

// What the server works with: the tutor, their roles and free access, plus their Stripe
// customer and subscription status (for this server's Stripe mode).
const tutorRecord = (t, mode) => ({
  id: String(t._id),
  email: t.email,
  name: t.name || '',
  picture: t.picture || '',
  roles: t.roles || [],
  comp: t.comp ? { until: time(t.comp.until), note: t.comp.note || '', by: t.comp.by || null, at: time(t.comp.at) } : null,
  createdAt: time(t.createdAt),
  lastSignInAt: time(t.lastSignInAt),
  stripeCustomerId: t.billing?.[mode]?.customerId || null,
  subscription: t.billing?.[mode]?.subscription || null,
});
// What the tutor's own browser is told (no Stripe ids, no notes).
export const publicTutor = (t) => {
  const access = tutorAccess(t);
  return {
    id: t.id,
    email: t.email,
    name: t.name,
    picture: t.picture,
    plan: t.subscription
      ? { status: t.subscription.status, trialEnd: t.subscription.trialEnd, periodEnd: t.subscription.periodEnd, cancelAtPeriodEnd: t.subscription.cancelAtPeriodEnd }
      : null,
    access: { ok: access.ok, kind: access.kind, until: access.until },
    owner: access.kind === 'owner',
    billingAccount: Boolean(t.stripeCustomerId),
  };
};

export function connectAccounts({
  uri = process.env.MONGODB_URI,
  clientId = process.env.GOOGLE_CLIENT_ID,
  billingMode = stripeMode(process.env.STRIPE_SECRET_KEY),
} = {}) {
  if (!uri || !clientId) return null;
  const db = mongoClient(uri).db('myprivateteacher');
  const tutors = db.collection('tutors');
  const sessions = db.collection('sessions');
  const grants = db.collection('grants'); // free access or roles for an email, waiting for its first sign-in
  const activity = db.collection('activity'); // every admin action
  tutors.createIndex({ googleSub: 1 }, { unique: true }).catch(() => {});
  const google = new OAuth2Client(clientId);
  const slot = (fields) => ({
    ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [`billing.${billingMode}.${k === 'stripeCustomerId' ? 'customerId' : k}`, v])),
    [`billing.${billingMode}.updatedAt`]: new Date(),
  });
  const byId = (id) => (ObjectId.isValid(id) ? { _id: new ObjectId(id) } : null);
  const toComp = (comp, by) => ({ until: comp.until ? new Date(comp.until) : null, note: String(comp.note || '').slice(0, 120), by, at: new Date() });

  // Recent sign-in checks, remembered for 30 seconds so page loads don't each ask the database.
  // Signing out, or any change to billing or access, forgets them at once.
  const recent = new Map(); // session fingerprint -> { tutor, until }
  const REMEMBER_MS = 30000;
  const remember = (key, tutor, expiresAt) => {
    if (recent.size > 2000) recent.clear();
    recent.set(key, { tutor, until: Math.min(Date.now() + REMEMBER_MS, expiresAt.getTime()) });
  };

  return {
    clientId,
    // Google's sign-in credential (an ID token), checked against Google's keys and this app's
    // client ID. Only verified email addresses are accepted.
    async verify(credential) {
      const ticket = await google.verifyIdToken({ idToken: credential, audience: clientId });
      const p = ticket.getPayload();
      if (!p?.sub || !p.email || p.email_verified !== true) return null;
      return { googleSub: p.sub, email: p.email.toLowerCase(), name: p.name || '', picture: p.picture || '' };
    },
    // Records the tutor (first sign-in creates them), applies anything granted to their email
    // before they signed in, and starts a session.
    async signIn(profile, { userAgent = '' } = {}) {
      const now = new Date();
      let tutor = await tutors.findOneAndUpdate(
        { googleSub: profile.googleSub },
        {
          $set: { email: profile.email, name: profile.name, picture: profile.picture, lastSignInAt: now },
          $setOnInsert: { googleSub: profile.googleSub, createdAt: now },
        },
        { upsert: true, returnDocument: 'after' },
      );
      const grant = await grants.findOneAndDelete({ _id: profile.email });
      if (grant) {
        const change = { ...(grant.comp ? { $set: { comp: grant.comp } } : {}), ...(grant.roles?.length ? { $addToSet: { roles: { $each: grant.roles } } } : {}) };
        if (Object.keys(change).length) await tutors.updateOne({ _id: tutor._id }, change);
        tutor = await tutors.findOne({ _id: tutor._id });
      }
      const token = randomBytes(32).toString('base64url');
      await sessions.insertOne({
        _id: fingerprint(token),
        tutorId: tutor._id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + SESSION_DAYS * 86400000),
        userAgent: String(userAgent).slice(0, 200),
      });
      return { token, tutor: tutorRecord(tutor, billingMode) };
    },
    // The signed-in tutor for a session token, or null.
    async tutorFor(token) {
      if (!token) return null;
      const key = fingerprint(token);
      const known = recent.get(key);
      if (known && known.until > Date.now()) return known.tutor;
      recent.delete(key);
      const session = await sessions.findOne({ _id: key });
      if (!session) return null;
      if (session.expiresAt < new Date()) {
        await sessions.deleteOne({ _id: session._id });
        return null;
      }
      const tutor = await tutors.findOne({ _id: session.tutorId });
      if (!tutor) return null;
      const record = tutorRecord(tutor, billingMode);
      remember(key, record, session.expiresAt);
      return record;
    },
    // Billing details from Stripe, kept in this mode's slot: a tutor's customer id, or a
    // customer's subscription status.
    async setBilling(tutorId, fields) {
      recent.clear();
      await tutors.updateOne({ _id: new ObjectId(tutorId) }, { $set: slot(fields) });
    },
    async setBillingByCustomer(customerId, fields) {
      recent.clear();
      await tutors.updateOne({ [`billing.${billingMode}.customerId`]: customerId }, { $set: slot(fields) });
    },
    async signOut(token) {
      if (!token) return;
      recent.delete(fingerprint(token));
      await sessions.deleteOne({ _id: fingerprint(token) });
    },

    // For the owner's admin panel.
    // Newest first. (Sorted by _id, which records when each was made: Cosmos DB only sorts by
    // indexed fields, and _id always is.)
    async listTutors() {
      const all = await tutors.find({}).sort({ _id: -1 }).limit(1000).toArray();
      return all.map((t) => tutorRecord(t, billingMode));
    },
    async tutorById(id) {
      const query = byId(id);
      const t = query && (await tutors.findOne(query));
      return t ? tutorRecord(t, billingMode) : null;
    },
    // Free access: { until (ms or null for no end), note }, or null to remove it.
    async setComp(id, comp, by) {
      const query = byId(id);
      if (!query) return;
      recent.clear();
      await tutors.updateOne(query, comp ? { $set: { comp: toComp(comp, by) } } : { $unset: { comp: '' } });
    },
    // Free access (and roles) for an email: straight onto the tutor if they've signed in,
    // otherwise waiting for their first sign-in.
    async grantByEmail(email, { comp = null, roles = [] }, by) {
      recent.clear();
      const existing = await tutors.findOne({ email });
      const fields = { ...(comp ? { comp: toComp(comp, by) } : {}) };
      if (existing) {
        await tutors.updateOne({ _id: existing._id }, { ...(comp ? { $set: fields } : {}), ...(roles.length ? { $addToSet: { roles: { $each: roles } } } : {}) });
        return { applied: true };
      }
      await grants.updateOne({ _id: email }, { $set: { ...fields, roles, by, at: new Date() } }, { upsert: true });
      return { applied: false };
    },
    async listGrants() {
      const all = (await grants.find({}).limit(500).toArray()).sort((a, b) => (b.at?.getTime?.() || 0) - (a.at?.getTime?.() || 0));
      return all.map((g) => ({ email: g._id, comp: g.comp ? { until: time(g.comp.until), note: g.comp.note || '' } : null, roles: g.roles || [], at: time(g.at) }));
    },
    async removeGrant(email) {
      await grants.deleteOne({ _id: email });
    },
    async signOutEverywhere(id) {
      const query = byId(id);
      if (!query) return 0;
      recent.clear();
      const result = await sessions.deleteMany({ tutorId: query._id });
      return result.deletedCount || 0;
    },
    // Deletes a tutor's account: the tutor, their sessions and any invite for their email.
    // (Stripe keeps its own billing records, as the privacy policy says.)
    async deleteTutor(id) {
      const query = byId(id);
      if (!query) return false;
      const t = await tutors.findOne(query);
      if (!t) return false;
      recent.clear();
      await sessions.deleteMany({ tutorId: t._id });
      await grants.deleteOne({ _id: t.email });
      await tutors.deleteOne({ _id: t._id });
      return true;
    },
    async record(entry) {
      await activity.insertOne({ ...entry, at: new Date() });
    },
    async listActivity(limit = 100) {
      const all = await activity.find({}).sort({ _id: -1 }).limit(limit).toArray();
      return all.map(({ _id, at, ...rest }) => ({ id: String(_id), at: time(at), ...rest }));
    },
    close: () => {}, // the shared connection closes with the server
  };
}
