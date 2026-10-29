import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { createApp } from './index.js';

const profile = { googleSub: 'verified-sub', email: 'tutor@example.test', name: 'Tutor', picture: '' };
const tutor = { id: 'tutor-id', email: profile.email, name: profile.name, picture: '' };
let server, origin, accounts;
beforeEach(async () => {
  accounts = {
    clientId: 'fixture-client-id',
    verify: vi.fn(async () => profile),
    signIn: vi.fn(async () => ({ token: 'fixture-session-token', tutor })),
  };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  server = http.createServer(createApp({ accounts }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  server.closeIdleConnections();
  await new Promise((resolve) => server.close(resolve));
  vi.restoreAllMocks();
});
const signIn = (credential, requestOrigin = origin) => fetch(`${origin}/auth/google`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: requestOrigin, 'user-agent': 'fixture browser' },
  body: JSON.stringify({ credential }),
});

describe('Google sign-in failure classification', () => {
  it('creates the protected session only after identity verification and persistence succeed', async () => {
    const response = await signIn('verified-credential');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ tutor: { id: tutor.id, email: tutor.email } });
    expect(accounts.verify).toHaveBeenCalledWith('verified-credential');
    expect(accounts.signIn).toHaveBeenCalledExactlyOnceWith(profile, { userAgent: 'fixture browser' });
    expect(response.headers.get('set-cookie')).toMatch(/mpt_session=fixture-session-token;.*HttpOnly;.*SameSite=Lax/);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['Topology is closed', 'database unavailable'])('returns a temporary 503 after verified identity when persistence fails: %s', async (message) => {
    accounts.signIn.mockRejectedValue(new Error(message));
    const response = await signIn('verified-credential');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Sign-in is temporarily unavailable. Please try again in a moment.' });
    expect(response.headers.get('retry-after')).toBe('5');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(accounts.verify).toHaveBeenCalledTimes(1);
    expect(accounts.signIn).toHaveBeenCalledTimes(1); // Never blindly retry account writes.
  });

  it('keeps rejected credentials at 401 without calling session persistence', async () => {
    accounts.verify.mockRejectedValue(new Error('invalid token'));
    const response = await signIn('invalid-credential');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'That Google account could not be used.' });
    expect(accounts.signIn).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects profiles that verification will not accept', async () => {
    accounts.verify.mockResolvedValue(null);
    expect((await signIn('unverified-email')).status).toBe(401);
    expect(accounts.signIn).not.toHaveBeenCalled();
  });

  it('rejects missing credentials without attempting verification or persistence', async () => {
    expect((await signIn(undefined)).status).toBe(401);
    expect(accounts.verify).not.toHaveBeenCalled();
    expect(accounts.signIn).not.toHaveBeenCalled();
  });

  it('preserves the same-site restriction before either authentication step', async () => {
    expect((await signIn('verified-credential', 'https://unrelated.example')).status).toBe(403);
    expect(accounts.verify).not.toHaveBeenCalled();
    expect(accounts.signIn).not.toHaveBeenCalled();
  });
});
