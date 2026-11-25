import http from 'node:http';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './index.js';
import { memoryLessonTemplates, memoryLessons } from './lessonFixtures.js';

// Frozen metadata/hashes generated using the actual pre-marks normalizer at
// 7e147ba, not publish() or the evolving cleanLessonInput() under test.
const historical = JSON.parse(readFileSync(new URL('./fixtures/lesson-templates-before-teaching-marks.json', import.meta.url)));
const folders = { 1: 'short-a-first-practice', 2: 'short-a-teaching-pack' };
const file = (version, name) => new URL(`../content/lessons/${folders[version]}/${name}`, import.meta.url);
const source = version => JSON.parse(readFileSync(file(version, 'lesson.json')));
const sources = version => version === 1 ? readFileSync(file(version, 'reading.png')) : new Map(source(version).assets.map(asset => [asset.id, readFileSync(file(version, asset.file))]));
let fixture, server;

beforeEach(() => {
  fixture = memoryLessonTemplates();
  for (const doc of historical.templates) {
    fixture.collection.records.set(doc._id, structuredClone(doc));
    for (const asset of doc.assets) fixture.assets.records.set(`${doc._id}/${asset.sha256}`, readFileSync(file(doc.schemaVersion, `${asset.id}.png`)));
  }
});
afterEach(async () => {
  if (server) { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); server = null; }
});

describe('immutable premade lessons published before teaching marks', () => {
  it.each(historical.templates)('reads $schemaVersion metadata and image without rewriting its historical hash', async doc => {
    const before = structuredClone(fixture.collection.records.get(doc._id));
    const read = await fixture.templates.get(doc._id);
    expect(read.sourceHash).toBe(doc.sourceHash);
    expect(read.activities).toEqual(doc.activities);
    const image = await fixture.templates.image(doc._id, doc.assets[0].id);
    expect(image.sha256).toBe(doc.assets[0].sha256);
    expect(fixture.collection.records.get(doc._id)).toEqual(before);
  });

  it('lists the current edition with an authenticated plan over HTTP', async () => {
    const accounts = { tutorFor: async token => token === 'fixture' ? { id: 'historical-owner' } : null };
    server = http.createServer(createApp({ templates: fixture.templates, accounts }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const list = await fetch(`${base}/api/lesson-templates`);
    expect(list.status).toBe(200);
    expect((await list.json()).templates.map(template => template.id)).toEqual(['starter-short-a-amstp-v2']);
    for (const doc of historical.templates) {
      const read = await fetch(`${base}/api/lesson-templates/${doc._id}`, { headers: { cookie: 'mpt_session=fixture' } });
      expect(read.status).toBe(200);
      expect((await read.json()).template.sourceHash).toBe(doc.sourceHash);
      expect((await fetch(`${base}/api/lesson-templates/${doc._id}/assets/${doc.assets[0].id}/image`)).status).toBe(200);
    }
  });

  it.each(historical.templates)('keeps republishing edition $schemaVersion idempotent without changing reviewed sources', async doc => {
    const before = structuredClone(fixture.collection.records.get(doc._id));
    const put = vi.spyOn(fixture.assets, 'put');
    expect(await fixture.templates.publish(source(doc.schemaVersion), sources(doc.schemaVersion))).toMatchObject({ id: doc._id, status: 'existing' });
    expect(fixture.collection.records.get(doc._id)).toEqual(before);
    expect(put).not.toHaveBeenCalled();
  });

  it.each(historical.templates)('saves native marks on a private edition $schemaVersion copy while preserving its global source', async doc => {
    const { lessons } = memoryLessons({ templates: fixture.templates });
    const copy = await lessons.createFromTemplate('historical-owner', await fixture.templates.get(doc._id));
    const marked = await lessons.save('historical-owner', copy.id, { ...copy, activities: copy.activities.map((activity, index) => index === 0 ? { ...activity, marks: ['breve', 'syllable-scoop'] } : activity) });
    expect((await lessons.get('historical-owner', marked.id)).activities[0].marks).toEqual(['breve', 'syllable-scoop']);
    expect((await fixture.templates.get(doc._id)).sourceHash).toBe(doc.sourceHash);
    expect(fixture.collection.records.get(doc._id)).toEqual(doc);
  });

  it.each(historical.templates)('still rejects adding nonempty marks to reviewed edition $schemaVersion metadata', async doc => {
    fixture.collection.records.get(doc._id).activities[0].marks = ['breve'];
    const getBytes = vi.spyOn(fixture.assets, 'get');
    await expect(fixture.templates.get(doc._id)).rejects.toThrow('metadata verification');
    await expect(fixture.templates.list()).rejects.toThrow('metadata verification');
    await expect(fixture.templates.image(doc._id, doc.assets[0].id)).rejects.toThrow('metadata verification');
    expect(getBytes).not.toHaveBeenCalled();
  });

  it('includes nonempty marks in a newly published source hash instead of silently discarding them', async () => {
    const fresh = memoryLessonTemplates(), template = source(1);
    template.activities[0].marks = ['breve'];
    await fresh.templates.publish(template, sources(1));
    expect((await fresh.templates.get(template.id)).activities[0].marks).toEqual(['breve']);
    fresh.collection.records.get(template.id).activities[0].marks = ['macron'];
    await expect(fresh.templates.get(template.id)).rejects.toThrow('metadata verification');
  });
});
