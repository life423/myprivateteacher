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
// What the server works with: the tutor plus their Stripe customer and subscription status.
const tutorRecord = (t) => ({
  id: String(t._id),
  email: t.email,
  name: t.name || '',
  picture: t.picture || '',
  stripeCustomerId: t.stripeCustomerId || null,
  subscription: t.subscription || null,
});
// What the tutor's own browser is told (no Stripe ids).
export const publicTutor = (t) => ({
  id: t.id,
  email: t.email,
  name: t.name,
  picture: t.picture,
  plan: t.subscription
    ? { status: t.subscription.status, trialEnd: t.subscription.trialEnd, periodEnd: t.subscription.periodEnd, cancelAtPeriodEnd: t.subscription.cancelAtPeriodEnd }
    : null,
  billingAccount: Boolean(t.stripeCustomerId),
});

export function connectAccounts({ uri = process.env.MONGODB_URI, clientId = process.env.GOOGLE_CLIENT_ID } = {}) {
  if (!uri || !clientId) return null;
  const db = mongoClient(uri).db('myprivateteacher');
  const tutors = db.collection('tutors');
  const sessions = db.collection('sessions');
  tutors.createIndex({ googleSub: 1 }, { unique: true }).catch(() => {});
  const google = new OAuth2Client(clientId);

  // Recent sign-in checks, remembered for 30 seconds so page loads don't each ask the database.
  // Signing out, or any billing change, forgets them at once.
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
    // Records the tutor (first sign-in creates them) and starts a session.
    async signIn(profile, { userAgent = '' } = {}) {
      const now = new Date();
      const tutor = await tutors.findOneAndUpdate(
        { googleSub: profile.googleSub },
        {
          $set: { email: profile.email, name: profile.name, picture: profile.picture, lastSignInAt: now },
          $setOnInsert: { googleSub: profile.googleSub, createdAt: now },
        },
        { upsert: true, returnDocument: 'after' },
      );
      const token = randomBytes(32).toString('base64url');
      await sessions.insertOne({
        _id: fingerprint(token),
        tutorId: tutor._id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + SESSION_DAYS * 86400000),
        userAgent: String(userAgent).slice(0, 200),
      });
      return { token, tutor: tutorRecord(tutor) };
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
      const record = tutorRecord(tutor);
      remember(key, record, session.expiresAt);
      return record;
    },
    // Billing details from Stripe: a tutor's customer id, or a customer's subscription status.
    async setBilling(tutorId, fields) {
      recent.clear();
      await tutors.updateOne({ _id: new ObjectId(tutorId) }, { $set: { ...fields, billingUpdatedAt: new Date() } });
    },
    async setBillingByCustomer(customerId, fields) {
      recent.clear();
      await tutors.updateOne({ stripeCustomerId: customerId }, { $set: { ...fields, billingUpdatedAt: new Date() } });
    },
    async signOut(token) {
      if (!token) return;
      recent.delete(fingerprint(token));
      await sessions.deleteOne({ _id: fingerprint(token) });
    },
    close: () => {}, // the shared connection closes with the server
  };
}
