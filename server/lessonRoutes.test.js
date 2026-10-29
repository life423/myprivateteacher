import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { memoryLessons } from './lessonFixtures.js';
import { createApp } from './index.js';
import { MAX_PICTURE_BYTES } from '../shared/pieces.js';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwsYAAAAASUVORK5CYII=', 'base64');
let server, origin, lessons, assets, library;
beforeEach(async () => {
  ({ lessons, assets } = memoryLessons());
  library = { list: vi.fn(async () => [{ id: 'card-1', title: 'Lip Biter' }]), image: vi.fn(async () => ({ bytes: PNG })) };
  const accounts = { tutorFor: async token => token === 'a' ? { id: 'owner-a' } : token === 'b' ? { id: 'owner-b' } : null };
  server = http.createServer(createApp({ lessons, library, accounts }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); });
function call(path = '', { method = 'GET', body, raw, as = 'a', headers = {} } = {}) {
  return fetch(`${origin}/api/lessons${path}`, { method, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), headers: { ...(as ? { cookie: `mpt_session=${as}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers } });
}
const create = () => call('', { method: 'POST', body: { id: 'lesson-1', title: 'Tutor preparation', activities: [] } });
const upload = (path = '/lesson-1/assets/image-1', options = {}) => call(path, { method: 'POST', raw: PNG, headers: { 'content-type': 'image/png', 'x-image-width': '1', 'x-image-height': '1' }, ...options });

describe('private saved lesson HTTP routes', () => {
  it('requires an account cookie even with a room key and rejects cross-site mutations', async () => {
    expect((await call('', { as: null, headers: { 'x-room-key': 'room-capability' } })).status).toBe(401);
    expect((await call('/catalog', { as: null })).status).toBe(401);
    expect((await call('', { method: 'POST', body: { id: 'l1', activities: [] }, headers: { origin: 'https://elsewhere.example' } })).status).toBe(403);
    expect(library.list).not.toHaveBeenCalled();
  });
  it('persists the four manual activities and exposes no internal owner/storage fields', async () => {
    expect((await create()).status).toBe(201);
    const activities = ['review', 'build', 'dictation', 'read'].map(type => ({ id: type, type, title: `Private ${type}`, targets: 'PRIVATE ANSWER', reviewNextTime: type === 'dictation', reviewNote: 'PRIVATE NOTE' }));
    const response = await call('/lesson-1', { method: 'PUT', body: { revision: 1, title: 'Practice', activities, ownerId: 'owner-b', assets: [{ id: 'forged' }] } });
    expect(response.status).toBe(200);
    const { lesson } = await response.json();
    expect(lesson.revision).toBe(2); expect(lesson.activities.map(activity => activity.type)).toEqual(['review', 'build', 'dictation', 'read']);
    expect(JSON.stringify(lesson)).not.toMatch(/ownerId|blobPath|sha256|forged/);
    expect((await call('/lesson-1', { method: 'PUT', body: { revision: 1, title: 'Old', activities: [] } })).status).toBe(409);
    const summary = await (await call()).json();
    expect(summary.lessons).toMatchObject([{ revision: 2, activityCount: 4, reviewCount: 1 }]);
    expect(JSON.stringify(summary)).not.toMatch(/PRIVATE ANSWER|PRIVATE NOTE/);
  });
  it('blocks other owners from reading, editing, deleting or uploading to a known lesson', async () => {
    await create(); await upload();
    const put = vi.spyOn(assets, 'put'), get = vi.spyOn(assets, 'get');
    for (const [path, options] of [
      ['/lesson-1', {}], ['/lesson-1', { method: 'PUT', body: { revision: 1, title: 'Taken', activities: [] } }],
      ['/lesson-1', { method: 'DELETE', body: { revision: 1 } }], ['/lesson-1/assets/image-1', {}],
      ['/lesson-1/assets/image-1', { method: 'DELETE' }],
    ]) expect((await call(path, { ...options, as: 'b' })).status).toBe(404);
    expect((await upload('/lesson-1/assets/image-2', { as: 'b' })).status).toBe(404);
    expect(put).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
    expect((await (await call('', { as: 'b' })).json()).lessons).toEqual([]);
  });
  it('serves the authenticated catalog before the lesson-id route and never supplies a public Blob URL', async () => {
    expect(await (await call('/catalog')).json()).toEqual({ cards: [{ id: 'card-1', title: 'Lip Biter' }] });
    const response = await call('/catalog/card-1/image');
    expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(library.image).toHaveBeenCalledExactlyOnceWith('card-1');
  });
  it('uploads prepared images, retains editable revision and protects image responses', async () => {
    await create();
    const result = await upload();
    expect(result.status).toBe(201); expect(await result.json()).toEqual({ asset: { id: 'image-1', w: 1, h: 1, type: 'image/png', bytes: PNG.length } });
    expect((await (await call('/lesson-1')).json()).lesson.revision).toBe(1);
    const response = await call('/lesson-1/assets/image-1');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await call('/lesson-1/assets/image-1', { method: 'DELETE' })).status).toBe(204);
    expect((await (await call('/lesson-1')).json()).lesson.revision).toBe(1);
  });
  it('rejects raw PDFs, oversized bytes, invalid dimensions and malformed JSON without storing assets', async () => {
    await create();
    expect((await upload('/lesson-1/assets/pdf', { raw: Buffer.from('%PDF-1.7 not a prepared image') })).status).toBe(415);
    expect((await upload('/lesson-1/assets/oversize', { raw: Buffer.alloc(MAX_PICTURE_BYTES + 1) })).status).toBe(413);
    expect((await upload('/lesson-1/assets/invalid', { headers: { 'x-image-width': '0', 'x-image-height': '1', 'content-type': 'image/png' } })).status).toBe(400);
    expect((await call('', { method: 'POST', raw: '{broken', headers: { 'content-type': 'application/json' } })).status).toBe(400);
    expect(assets.records.size).toBe(0);
  });
  it('deletes lesson assets only with the current revision and sanitizes storage failures', async () => {
    await create(); await upload();
    expect((await call('/lesson-1', { method: 'DELETE', body: { revision: 0 } })).status).toBe(409);
    expect((await call('/lesson-1', { method: 'DELETE', body: { revision: 1 } })).status).toBe(204);
    expect(assets.records.size).toBe(0); expect((await call('/lesson-1')).status).toBe(404);
    await create();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    assets.put = async () => { throw new Error('private blob path secret storage diagnostics'); };
    const response = await upload();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/secret|diagnostics|blob path/);
    warning.mockRestore();
  });
});
