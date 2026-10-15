import { createHash, randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { OAuth2Client } from 'google-auth-library';

// Tutor accounts: Sign in with Google, with sessions kept in MongoDB. Only a fingerprint
// (SHA-256) of each session token is stored, so the database alone can't sign anyone in.
// Off unless MONGODB_URI and GOOGLE_CLIENT_ID are set. Students never need an account.
export const SESSION_COOKIE = 'mpt_session';
export const SESSION_DAYS = 30;
const fingerprint = (token) => createHash('sha256').update(token).digest('hex');
const publicTutor = (t) => ({ id: String(t._id), email: t.email, name: t.name || '', picture: t.picture || '' });

export function connectAccounts({ uri = process.env.MONGODB_URI, clientId = process.env.GOOGLE_CLIENT_ID } = {}) {
  if (!uri || !clientId) return null;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, retryWrites: false });
  const db = client.db('myprivateteacher');
  const tutors = db.collection('tutors');
  const sessions = db.collection('sessions');
  tutors.createIndex({ googleSub: 1 }, { unique: true }).catch(() => {});
  const google = new OAuth2Client(clientId);

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
      return { token, tutor: publicTutor(tutor) };
    },
    // The signed-in tutor for a session token, or null.
    async tutorFor(token) {
      if (!token) return null;
      const session = await sessions.findOne({ _id: fingerprint(token) });
      if (!session) return null;
      if (session.expiresAt < new Date()) {
        await sessions.deleteOne({ _id: session._id });
        return null;
      }
      const tutor = await tutors.findOne({ _id: session.tutorId });
      return tutor ? publicTutor(tutor) : null;
    },
    async signOut(token) {
      if (token) await sessions.deleteOne({ _id: fingerprint(token) });
    },
    close: () => client.close(),
  };
}
