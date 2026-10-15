import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './index.js';

// Google is stood in for: 'good' is a valid credential, anything else isn't.
const tutor = { id: 't1', email: 'tutor@example.com', name: 'Ada Tutor', picture: '' };
const sessions = new Set();
const accounts = {
  clientId: 'client-123',
  verify: async (credential) => (credential === 'good' ? { googleSub: 'g1', email: tutor.email, name: tutor.name, picture: '' } : null),
  signIn: async () => {
    sessions.add('token-abc');
    return { token: 'token-abc', tutor };
  },
  tutorFor: async (token) => (sessions.has(token) ? tutor : null),
  signOut: async (token) => {
    sessions.delete(token);
  },
};

let server;
let port;
beforeAll(async () => {
  server = http.createServer(createApp({ accounts }));
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});
afterAll(() => server.close());

function call(method, path, { body, cookie, origin } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: `localhost:${port}` };
    if (body) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    if (origin) headers.origin = origin;
    const req = http.request({ port, method, path, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null; // a plain-text reply, like Forbidden
        }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

describe('tutor sign-in with Google', () => {
  it('says nobody is signed in, and that Google sign-in is available', async () => {
    const me = await call('GET', '/api/me');
    expect(me.json).toEqual({ tutor: null, signIn: { google: 'client-123' } });
  });

  it('refuses a credential Google would not accept', async () => {
    expect((await call('POST', '/auth/google', { body: { credential: 'forged' } })).status).toBe(401);
    expect((await call('POST', '/auth/google', { body: {} })).status).toBe(401);
  });

  it('refuses a sign-in posted from another website', async () => {
    expect((await call('POST', '/auth/google', { body: { credential: 'good' }, origin: 'https://evil.example' })).status).toBe(403);
  });

  it('signs in with a cookie scripts cannot read, and signs out on the server', async () => {
    const res = await call('POST', '/auth/google', { body: { credential: 'good' }, origin: `http://localhost:${port}` });
    expect(res.status).toBe(200);
    expect(res.json.tutor.email).toBe('tutor@example.com');
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^mpt_session=token-abc;/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const me = await call('GET', '/api/me', { cookie: 'mpt_session=token-abc' });
    expect(me.json.tutor.name).toBe('Ada Tutor');
    const out = await call('POST', '/auth/logout', { cookie: 'mpt_session=token-abc' });
    expect(out.status).toBe(204);
    expect(out.headers['set-cookie'][0]).toMatch(/^mpt_session=;/);
    expect((await call('GET', '/api/me', { cookie: 'mpt_session=token-abc' })).json.tutor).toBeNull();
  });
});
