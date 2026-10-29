import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './index.js';
import { createLessonTemplates, createTemplateAssets, templateAssetPath } from './lessonTemplates.js';
import { memoryLessonCollection, memoryLessonTemplates, memoryLessons } from './lessonFixtures.js';
import { lessonTemplateCopyId } from './lessons.js';

const original = JSON.parse(readFileSync(new URL('../content/lessons/short-a-first-practice/lesson.json', import.meta.url), 'utf8'));
const pngBytes = readFileSync(new URL('../content/lessons/short-a-first-practice/reading.png', import.meta.url));
const owner = 'owner-a', other = 'owner-b';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let templates, globalAssets, globalCollection, lessons, assets, collection;
beforeEach(async () => {
  const global = memoryLessonTemplates();
  templates = global.templates; globalAssets = global.assets; globalCollection = global.collection;
  await templates.publish(original, pngBytes);
  ({ lessons, assets, collection } = memoryLessons({ templates }));
});

describe('editable private copies of shared originals', () => {
  it('creates owner-isolated copies while storing exactly one immutable global image', async () => {
    const template = await templates.get(original.id);
    const first = await lessons.createFromTemplate(owner, template), second = await lessons.createFromTemplate(other, template);
    expect(first.id).toBe(lessonTemplateCopyId(owner, original.id)); expect(first.id).not.toBe(second.id);
    expect(collection.records.size).toBe(2); expect(globalCollection.records.size).toBe(1);
    expect(globalAssets.records.size).toBe(1); expect(assets.records.size).toBe(0);
    expect(collection.records.get(first.id).assets[0].origin).toEqual({ templateId: original.id, assetId: 'reading' });
    expect(first.assets).toMatchObject([{ id: 'reading', w: 1600, h: 1700, type: 'image/png' }]);
    expect(JSON.stringify(first)).not.toMatch(/"(?:origin|blobPath|sha256|ownerId)":/);
    for (const [id, tutor] of [[first.id, owner], [second.id, other]]) expect(hash((await lessons.getAsset(tutor, id, 'reading')).data)).toBe(hash(pngBytes));
  });
  it('reuses the same tutor copy without resetting private edits or changing the original/another tutor', async () => {
    const template = await templates.get(original.id);
    const first = await lessons.createFromTemplate(owner, template), second = await lessons.createFromTemplate(other, template);
    const changed = await lessons.save(owner, first.id, { ...first, title: 'My edited practice', activities: first.activities.map((activity, index) => index ? activity : { ...activity, reviewNextTime: true, reviewNote: 'Private actual observation' }) });
    expect(await lessons.createFromTemplate(owner, template)).toEqual(changed);
    expect((await lessons.get(other, second.id)).title).toBe(original.title);
    expect((await templates.get(original.id)).activities[0].reviewNote).toBe('');
    await expect(lessons.get(other, first.id)).rejects.toMatchObject({ status: 404 });
    await expect(lessons.getAsset(other, first.id, 'reading')).rejects.toMatchObject({ status: 404 });
  });
  it('never deletes global bytes when a copy asset, copy lesson or account is deleted', async () => {
    const template = await templates.get(original.id);
    const first = await lessons.createFromTemplate(owner, template), second = await lessons.createFromTemplate(other, template);
    const detach = await lessons.save(owner, first.id, { ...first, activities: first.activities.map(activity => ({ ...activity, assetIds: [] })) });
    const privateDelete = vi.spyOn(assets, 'remove');
    await lessons.removeAsset(owner, first.id, 'reading');
    expect(privateDelete).not.toHaveBeenCalled();
    await lessons.remove(owner, first.id, detach.revision);
    await lessons.deleteOwner(other);
    expect(collection.records.size).toBe(0); expect(assets.records.size).toBe(0);
    expect(globalAssets.records.size).toBe(1); expect(globalCollection.records.size).toBe(1);
    expect(hash((await templates.image(original.id, 'reading')).data)).toBe(hash(pngBytes));
    expect(second.assets).toHaveLength(1);
  });
});

describe('premade template HTTP ownership boundary', () => {
  let server, origin;
  beforeEach(async () => {
    const accounts = { tutorFor: async token => token === 'a' ? { id: owner } : token === 'b' ? { id: other } : null };
    server = http.createServer(createApp({ templates, lessons, accounts }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  afterEach(async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); });
  const request = (url, { method = 'GET', as, body, headers = {} } = {}) => fetch(`${origin}${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { ...(as ? { cookie: `mpt_session=${as}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers } });
  const copy = (as, options = {}) => request(`/api/lessons/from-template/${original.id}`, { method: 'POST', as, ...options });

  it('publicly serves safe summaries/reading images, but requires an account for the teaching plan', async () => {
    const list = await request('/api/lesson-templates');
    expect(list.status).toBe(200);
    const catalog = await list.json();
    expect(catalog.templates).toEqual([{ id: original.id, title: original.title, description: original.description, knownLetters: original.knownLetters, activityCount: 4 }]);
    expect(JSON.stringify(catalog)).not.toMatch(/directions|targets|reviewNote|blobPath/);
    const unauthenticated = await request(`/api/lesson-templates/${original.id}`);
    expect(unauthenticated.status).toBe(401); expect(unauthenticated.headers.get('cache-control')).toBe('no-store');
    const plan = await request(`/api/lesson-templates/${original.id}`, { as: 'a' });
    expect(plan.status).toBe(200); expect((await plan.json()).template.activities).toHaveLength(4); expect(plan.headers.get('cache-control')).toBe('no-store');
    const image = await request(`/api/lesson-templates/${original.id}/assets/reading/image`);
    expect(image.status).toBe(200); expect(hash(Buffer.from(await image.arrayBuffer()))).toBe(hash(pngBytes));
    expect(image.headers.get('content-type')).toContain('image/png'); expect(image.headers.get('cache-control')).toContain('immutable');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('has no anonymous or authenticated public write route', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const as of [undefined, 'a']) expect((await request(`/api/lesson-templates/${original.id}`, { method, as, body: { title: 'Overwritten' } })).status).toBe(405);
    }
    expect((await templates.get(original.id)).title).toBe(original.title); expect(globalCollection.records.size).toBe(1);
  });
  it('fails closed at every HTTP read/copy boundary when reviewed metadata changes', async () => {
    const changedTitle = 'Changed after review';
    globalCollection.records.get(original.id).title = changedTitle;
    const errors = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const url of ['/api/lesson-templates', `/api/lesson-templates/${original.id}`, `/api/lesson-templates/${original.id}/assets/reading/image`]) {
        const response = await request(url, { as: 'a' });
        expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.text()).not.toContain(changedTitle);
      }
      expect((await copy('a')).status).toBe(503);
      expect(collection.records.size).toBe(0);
    } finally { errors.mockRestore(); }
  });
  it('lets every signed-in tutor use the original and preserves each owner’s editable copy', async () => {
    expect((await copy()).status).toBe(401);
    expect((await copy('a', { headers: { origin: 'https://elsewhere.example' } })).status).toBe(403);
    const first = await (await copy('a', { body: { ownerId: other } })).json(), second = await (await copy('b')).json();
    expect(first.lesson.id).not.toBe(second.lesson.id);
    const update = await request(`/api/lessons/${first.lesson.id}`, { method: 'PUT', as: 'a', body: { ...first.lesson, title: 'Private custom copy' } });
    expect(update.status).toBe(200);
    const again = await (await copy('a')).json(); expect(again.lesson.title).toBe('Private custom copy'); expect(again.lesson.revision).toBe(2);
    expect((await request(`/api/lessons/${first.lesson.id}`, { as: 'b' })).status).toBe(404);
    expect((await request(`/api/lessons/${first.lesson.id}/assets/reading`)).status).toBe(401);
    const ownImage = await request(`/api/lessons/${first.lesson.id}/assets/reading`, { as: 'a' });
    expect(hash(Buffer.from(await ownImage.arrayBuffer()))).toBe(hash(pngBytes));
    expect((await templates.get(original.id)).title).toBe(original.title); expect(globalAssets.records.size).toBe(1); expect(assets.records.size).toBe(0);
  });
});

describe('immutable source/read verification', () => {
  it('never inserts a catalog document for a corrupt orphan with matching Blob metadata', async () => {
    const corrupt = Buffer.from(pngBytes); corrupt[corrupt.length - 1] ^= 1;
    const blob = {
      uploadData: vi.fn(async () => { throw Object.assign(new Error('Exists'), { statusCode: 412 }); }),
      getProperties: vi.fn(async () => ({ metadata: { sha256: hash(pngBytes) } })),
      downloadToBuffer: vi.fn(async () => corrupt),
    };
    const global = memoryLessonCollection(), insert = vi.spyOn(global, 'insertOne');
    const source = createLessonTemplates({ collection: global, assets: createTemplateAssets({ container: { getBlockBlobClient: () => blob, getBlobClient: () => blob } }) });
    await expect(source.publish(original, pngBytes)).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled(); expect(global.records.size).toBe(0);
    expect(await source.list()).toEqual([]); expect(await source.get(original.id)).toBeNull();
    // An orphan source is never overwritten, repaired or exposed implicitly.
    expect(blob.uploadData).toHaveBeenCalledTimes(1);
  });
  it.each(['title', 'activities', 'schemaVersion'])('rejects modified %s at all metadata read boundaries before fetching bytes', async field => {
    const doc = globalCollection.records.get(original.id);
    if (field === 'title') doc.title = 'Changed after review';
    else if (field === 'activities') doc.activities[0].directions += '\nChanged after review';
    else doc.schemaVersion = 2;
    const getBytes = vi.spyOn(globalAssets, 'get');
    await expect(templates.get(original.id)).rejects.toThrow('metadata verification');
    await expect(templates.list()).rejects.toThrow('metadata verification');
    await expect(templates.image(original.id, 'reading')).rejects.toThrow('metadata verification');
    expect(getBytes).not.toHaveBeenCalled();
  });
});

describe('immutable global Blob namespace', () => {
  it('uses version/source-hash paths and exposes no destructive adapter method', async () => {
    const digest = hash(pngBytes), blob = { uploadData: vi.fn(async () => {}), downloadToBuffer: vi.fn(async () => pngBytes) };
    const container = { getBlockBlobClient: vi.fn(() => blob), getBlobClient: vi.fn(() => blob) };
    const store = createTemplateAssets({ container });
    expect(templateAssetPath(original.id, digest)).toBe(`lesson-templates/${original.id}/${digest}`);
    expect(() => templateAssetPath('../private', digest)).toThrow(); expect(() => templateAssetPath(original.id, 'bad')).toThrow();
    await store.put(original.id, digest, pngBytes, 'image/png');
    expect(blob.uploadData).toHaveBeenCalledWith(pngBytes, expect.objectContaining({ conditions: { ifNoneMatch: '*' } }));
    expect(Object.keys(store).sort()).toEqual(['get', 'put']);
  });
});
