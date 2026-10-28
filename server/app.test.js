import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './index.js';

// Needs a build in dist/ (npm run build) first.
let server;
let port;

beforeAll(async () => {
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});

afterAll(() => server.close());

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ port, path, headers: { host: 'localhost', ...headers } }, (res) => {
      let body = '';
      res.setEncoding('latin1');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
}

describe('web server', () => {
  it('sends other hosts to the canonical domain, keeping the path', async () => {
    const res = await get('/whiteboard/1234?x=1', { host: 'www.myprivateteacher.com' });
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('https://myprivateteacher.com/whiteboard/1234?x=1');
  });

  it('serves every app route with the shell, security headers and no-cache', async () => {
    for (const path of ['/', '/phoneme-pop', '/whiteboard', '/whiteboard/4827']) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.body).toContain('root');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['content-security-policy']).toContain(`default-src 'self'`);
      expect(res.headers['content-security-policy']).toContain("img-src 'self' data: blob:");
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('gzips and caches hashed assets forever, and 404s missing ones', async () => {
    const html = readFileSync(fileURLToPath(new URL('../dist/index.html', import.meta.url)), 'utf8');
    const script = html
      .split('/assets/')
      .slice(1)
      .map((s) => s.slice(0, s.search(/[^A-Za-z0-9._-]/)))
      .find((s) => s.endsWith('.js'));
    const res = await get(`/assets/${script}`, { 'accept-encoding': 'gzip' });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['cache-control']).toContain('immutable');
    expect((await get('/assets/nope.js')).status).toBe(404);
  });

  it('answers health checks on any host without redirecting', async () => {
    expect((await get('/healthz', { host: '10.0.0.5' })).status).toBe(200);
  });
});

describe('video calls', () => {
  it('lets this site, and only this site, use the camera and microphone', async () => {
    const policy = (await get('/')).headers['permissions-policy'];
    expect(policy).toContain('camera=(self)');
    expect(policy).toContain('microphone=(self)');
  });
});

describe('whiteboard picture routes', () => {
  const key = 'k'.repeat(32);
  const id = 'a'.repeat(32);
  const stored = new Map();
  const fakeRooms = {
    add: (upload) => {
      if (upload.key !== key) return { status: 403 };
      stored.set(upload.id, upload);
      return { status: 201 };
    },
    get: (code, pictureId) => stored.get(pictureId) || null,
  };
  let picServer;
  let picPort;
  beforeAll(async () => {
    picServer = http.createServer(createApp({ pictures: fakeRooms }));
    await new Promise((resolve) => picServer.listen(0, resolve));
    picPort = picServer.address().port;
  });
  afterAll(() => picServer.close());

  const request = (method, path, body, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ port: picPort, method, path, headers: { host: 'localhost', ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);

  it('accepts a real image from the room tutor and serves it back privately', async () => {
    const up = await request('POST', `/api/rooms/1234/pictures/${id}?w=10&h=10`, jpeg, { 'content-type': 'image/jpeg', 'x-room-key': key });
    expect(up.status).toBe(201);
    const down = await request('GET', `/api/rooms/1234/pictures/${id}`);
    expect(down.status).toBe(200);
    expect(down.headers['content-type']).toBe('image/jpeg');
    expect(down.headers['cache-control']).toContain('private');
    expect(down.body.equals(jpeg)).toBe(true);
  });

  it('refuses things that are not images, and anyone without the room key', async () => {
    const page = Buffer.from('<html><script>alert(1)</script></html>');
    expect((await request('POST', `/api/rooms/1234/pictures/${id}?w=10&h=10`, page, { 'content-type': 'image/png', 'x-room-key': key })).status).toBe(415);
    expect((await request('POST', `/api/rooms/1234/pictures/${id}?w=10&h=10`, jpeg, { 'content-type': 'image/jpeg', 'x-room-key': 'nope' })).status).toBe(403);
    expect((await request('GET', `/api/rooms/1234/pictures/${'b'.repeat(32)}`)).status).toBe(404);
  });
});

describe('the picture library routes', () => {
  const key = 'k'.repeat(32);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
  const added = [];
  const pictures = {
    add: (upload) => {
      added.push(upload);
      return { status: 201 };
    },
    get: () => null,
    isTutor: (code, k) => code === '1234' && k === key,
  };
  const library = {
    list: async () => [{ id: 'c1', title: 'Lip Biter', sounds: ['f', 'v'], collection: 'Mouth Pictures', order: 1, w: 10, h: 10 }],
    image: async (id) => (id === 'c1' ? { bytes: jpeg, w: 10, h: 10 } : null),
  };
  let libServer;
  let libPort;
  beforeAll(async () => {
    libServer = http.createServer(createApp({ pictures, library }));
    await new Promise((resolve) => libServer.listen(0, resolve));
    libPort = libServer.address().port;
  });
  afterAll(() => libServer.close());

  const call = (method, path, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ port: libPort, method, path, headers: { host: 'localhost', ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), bytes: Buffer.concat(chunks), headers: res.headers }));
      });
      req.on('error', reject);
      req.end();
    });
  const id = 'a'.repeat(32);

  it('shows the library only to the tutor of a live room', async () => {
    expect((await call('GET', '/api/rooms/1234/library')).status).toBe(403);
    expect((await call('GET', '/api/rooms/1234/library', { 'x-room-key': 'nope' })).status).toBe(403);
    const ok = await call('GET', '/api/rooms/1234/library', { 'x-room-key': key });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).cards[0].title).toBe('Lip Biter');
  });

  it('previews private card images for the live-room tutor without adding session pictures', async () => {
    const before = added.length;
    expect((await call('GET', '/api/rooms/1234/library/c1/image')).status).toBe(403);
    expect((await call('GET', '/api/rooms/1234/library/c1/image', { 'x-room-key': 'nope' })).status).toBe(403);
    expect((await call('GET', '/api/rooms/9999/library/c1/image', { 'x-room-key': key })).status).toBe(403);
    expect((await call('GET', '/api/rooms/1234/library/nope/image', { 'x-room-key': key })).status).toBe(404);
    const preview = await call('GET', '/api/rooms/1234/library/c1/image', { 'x-room-key': key });
    expect(preview.status).toBe(200);
    expect(preview.headers['content-type']).toContain('image/jpeg');
    expect(preview.headers['cache-control']).toBe('private, no-store');
    expect(preview.bytes.equals(jpeg)).toBe(true);
    expect(added.length).toBe(before);
  });

  it('copies a card into the room as one of its pictures, for its tutor only', async () => {
    expect((await call('POST', `/api/rooms/1234/pictures/${id}/from-library/c1`)).status).toBe(403);
    expect((await call('POST', `/api/rooms/1234/pictures/${id}/from-library/nope`, { 'x-room-key': key })).status).toBe(404);
    expect((await call('POST', `/api/rooms/1234/pictures/${id}/from-library/c1`, { 'x-room-key': key })).status).toBe(201);
    expect(added.at(-1)).toMatchObject({ code: '1234', id, w: 10, h: 10, type: 'image/jpeg' });
    expect(added.at(-1).bytes.equals(jpeg)).toBe(true);
  });
});

describe('old cached pages', () => {
  let oldServer;
  let oldPort;
  beforeAll(async () => {
    oldServer = http.createServer(createApp());
    await new Promise((resolve) => oldServer.listen(0, resolve));
    oldPort = oldServer.address().port;
  });
  afterAll(() => oldServer.close());
  const get = (path) =>
    new Promise((resolve, reject) => {
      http.get({ port: oldPort, path, headers: { host: 'localhost' } }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], cache: res.headers['cache-control'], body }));
      }).on('error', reject);
    });

  it('get a script that reloads them into the current site, not the app page', async () => {
    const js = await get('/static/js/main.dea4039c.js');
    expect(js.status).toBe(200);
    expect(js.type).toMatch(/javascript/);
    expect(js.cache).toBe('no-store');
    expect(js.body).toContain('location.reload');
    const css = await get('/static/css/main.0a1b2c3d.css');
    expect(css.type).toMatch(/text\/css/);
    expect(css.body).toBe('');
  });
});
