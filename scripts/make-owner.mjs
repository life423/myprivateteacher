// Makes an email an owner: the admin panel, and never needing a plan to teach. If they haven't
// signed in yet, it waits for that email's first sign-in.
// Run: npm run make-owner -- you@example.com
import { connectAccounts } from '../server/accounts.js';
import { closeDatabases } from '../server/db.js';

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email.includes('@')) {
  console.error('Usage: npm run make-owner -- you@example.com');
  process.exit(1);
}
const accounts = connectAccounts();
if (!accounts) {
  console.error('MONGODB_URI and GOOGLE_CLIENT_ID must be set in .env');
  process.exit(1);
}
const { applied } = await accounts.grantByEmail(email, { roles: ['owner'] }, { email: 'make-owner script' });
console.log(applied ? `${email} is now an owner.` : `${email} will be an owner from their first sign-in.`);
await closeDatabases();
