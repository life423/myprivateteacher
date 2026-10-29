import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'vite';
import developmentConfig from '../vite.config.js';
import { createApp } from '../server/index.js';

// Exercise the real development proxy and Express auth routes. Only Google's
// identity provider and the account store are local stand-ins; no cloud is used.
const tutor = { id: 'dev-tutor', email: 'tutor@example.invalid', name: 'Local Tutor', picture: '' };
const profile = { googleSub: 'test-google-sub', email: tutor.email, name: tutor.name, picture: '' };
const credential = 'valid-google-test-credential';
const sessions = new Map();
const received = [];
let nextSession = 0;
const accounts = {
  clientId: 'local-test-client',
  verify: vi.fn(async (value) => value === credential ? profile : null),
  signIn: async () => {
    const token = `dev-session-${++nextSession}`;
    sessions.set(token, tutor);
    return { token, tutor };
  },
  tutorFor: async (token) => sessions.get(token) || null,
  signOut: async (token) => { sessions.delete(token); },
};

let backend;
let development;
let folder;
let frontendPort;
let backendPort;
let browserHost;
let browserOrigin;

beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'mpt-dev-auth-'));
  const app = createApp({ accounts });
  backend = http.createServer((req, res) => {
    received.push({ path: req.url, host: req.headers.host, origin: req.headers.origin });
    app(req, res);
  });
  await new Promise((resolve, reject) => {
    backend.once('error', reject);
    backend.listen(0, '127.0.0.1', resolve);
  });
  backendPort = backend.address().port;
  // Keep the actual route prefixes and options: removing /auth from vite.config
  // must reproduce the browser's 404 rather than being repaired by this fixture.
  const proxy = Object.fromEntries(Object.entries(developmentConfig.server.proxy).map(([prefix, options]) => [prefix, {
    ...options,
    target: `${options.ws ? 'ws' : 'http'}://127.0.0.1:${backendPort}`,
  }]));
  development = await createServer({
    configFile: false,
    envFile: false,
    plugins: [],
    appType: 'custom',
    root: folder,
    cacheDir: path.join(folder, 'cache'),
    publicDir: false,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      ...developmentConfig.server,
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      hmr: false,
      proxy,
    },
  });
  await development.listen();
  frontendPort = development.httpServer.address().port;
  browserHost = `localhost:${frontendPort}`;
  browserOrigin = `http://${browserHost}`;
}, 15_000);

beforeEach(() => {
  received.length = 0;
  sessions.clear();
  accounts.verify.mockClear();
});

afterAll(async () => {
  try {
    await development?.close();
  } finally {
    try {
      if (backend?.listening) await new Promise((resolve, reject) => backend.close((error) => error ? reject(error) : resolve()));
    } finally {
      if (folder) await rm(folder, { recursive: true, force: true });
    }
  }
});

function request(method, pathname, { body, cookie, origin = browserOrigin } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: browserHost, origin };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const req = http.request({ host: '127.0.0.1', port: frontendPort, method, path: pathname, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json;
        try { json = JSON.parse(text); } catch { /* Vite and 403 responses can be plain text. */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(5_000, () => req.destroy(new Error(`Timed out: ${method} ${pathname}`)));
    req.end(body !== undefined ? JSON.stringify(body) : undefined);
  });
}

const cookieFrom = (response) => response.headers['set-cookie']?.[0]?.split(';')[0];
const signIn = () => request('POST', '/auth/google', { body: { credential } });

describe('Google sign-in through the real Vite development proxy', () => {
  it('preserves the browser host and carries a private session through sign-in, account loading and sign-out', async () => {
    const anonymous = await request('GET', '/api/me');
    expect(anonymous.status).toBe(200);
    expect(anonymous.json).toMatchObject({ tutor: null, signIn: { google: accounts.clientId } });

    const signedIn = await signIn();
    expect(signedIn.status).toBe(200);
    expect(signedIn.json.tutor).toMatchObject({ id: tutor.id, email: tutor.email });
    expect(accounts.verify).toHaveBeenCalledWith(credential);
    const setCookie = signedIn.headers['set-cookie'][0];
    expect(setCookie).toMatch(/^mpt_session=dev-session-\d+;/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).not.toMatch(/; Secure(?:;|$)/);
    const cookie = cookieFrom(signedIn);

    const authenticated = await request('GET', '/api/me', { cookie });
    expect(authenticated.status).toBe(200);
    expect(authenticated.json.tutor).toMatchObject({ id: tutor.id, name: tutor.name });
    const signedOut = await request('POST', '/auth/logout', { cookie });
    expect(signedOut.status).toBe(204);
    expect(signedOut.headers['set-cookie'][0]).toMatch(/^mpt_session=;/);
    expect(signedOut.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(signedOut.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');
    expect((await request('GET', '/api/me', { cookie })).json.tutor).toBeNull();
    expect(sessions.size).toBe(0);

    expect(received.map(({ path }) => path)).toEqual(['/api/me', '/auth/google', '/api/me', '/auth/logout', '/api/me']);
    for (const forwarded of received) {
      expect(forwarded.host).toBe(browserHost);
      expect(forwarded.origin).toBe(browserOrigin);
      expect(forwarded.host).not.toBe(`127.0.0.1:${backendPort}`);
    }
  });

  it('forwards provider rejection as 401 without creating a session', async () => {
    const response = await request('POST', '/auth/google', { body: { credential: 'invalid-test-credential' } });
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(sessions.size).toBe(0);
  });

  it('rejects foreign-origin sign-in before provider verification', async () => {
    const response = await request('POST', '/auth/google', { body: { credential }, origin: 'https://foreign.example' });
    expect(response.status).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(accounts.verify).not.toHaveBeenCalled();
    expect(sessions.size).toBe(0);
  });

  it('rejects foreign-origin logout and keeps the existing session', async () => {
    const cookie = cookieFrom(await signIn());
    const response = await request('POST', '/auth/logout', { cookie, origin: 'https://foreign.example' });
    expect(response.status).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect((await request('GET', '/api/me', { cookie })).json.tutor.id).toBe(tutor.id);
  });

  it('serves development popup and referrer headers on the real Vite client response', async () => {
    const response = await request('GET', '/@vite/client');
    expect(response.status).toBe(200);
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
    expect(response.headers['referrer-policy']).toBe('no-referrer-when-downgrade');
  });
});
