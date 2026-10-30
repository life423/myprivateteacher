import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLessonTemplates, memoryLessons } from '../server/lessonFixtures.js';
import { MAX_PICTURE_BYTES } from '../shared/pieces.js';
import { cleanLessonInput, studentProjection } from '../shared/lessons.js';
import { preparedPng, validateStarterTemplate } from '../server/starterLesson.js';
import { loadTemplateSources, parsePublisherArguments, publishOriginalTemplate } from './publish-lesson-template.mjs';

const original = JSON.parse(readFileSync(new URL('../content/lessons/short-a-first-practice/lesson.json', import.meta.url), 'utf8'));
const pngBytes = readFileSync(new URL('../content/lessons/short-a-first-practice/reading.png', import.meta.url));
const source = () => structuredClone(original);
let templates, assets, collection;
beforeEach(() => ({ templates, assets, collection } = memoryLessonTemplates()));
const publish = (options = {}) => publishOriginalTemplate({ templates, template: source(), pngBytes, ...options });

describe('original premade lesson preflight', () => {
  it('validates the real four-activity source and complete bounded reading PNG', () => {
    const result = validateStarterTemplate(source(), pngBytes);
    expect(result.content.activities.map(activity => activity.type)).toEqual(['review', 'build', 'dictation', 'read']);
    expect(result.image).toMatchObject({ w: 1600, h: 1700, type: 'image/png', bytes: pngBytes.length });
    expect(result.image.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.content.activities.every(activity => !activity.reviewNextTime && !activity.reviewNote)).toBe(true);
    expect(studentProjection(result.content.activities[2])).toEqual({ type: 'dictation', letters: '', cardIds: [], assetIds: [], boxes: 3 });
  });
  it('rejects truncated, corrupt, oversized or incorrectly described reading images', () => {
    expect(() => preparedPng(Buffer.from('not an image'))).toThrow();
    expect(() => preparedPng(pngBytes.subarray(0, pngBytes.length - 8))).toThrow();
    expect(() => preparedPng(Buffer.alloc(MAX_PICTURE_BYTES + 1))).toThrow();
    const corrupt = Buffer.from(pngBytes); corrupt[20] ^= 1;
    expect(() => preparedPng(corrupt)).toThrow('integrity');
    const template = source(); template.asset.w--;
    expect(() => validateStarterTemplate(template, pngBytes)).toThrow('dimensions');
  });
  it.each([
    template => { template.knownLetters.push('i'); },
    template => { template.wordChain[1] = 'sap'; template.activities[1].targets = template.wordChain.join('\n'); },
    template => { template.wordChain[1] = 'mat'; template.activities[1].targets = template.wordChain.join('\n'); },
    template => { template.readingLines.push('The cat sat.'); },
    template => { template.activities[2].targets = 'cat'; },
    template => { template.activities[2].letters = 's a t'; },
    template => { template.activities[1].letters = 'm a t'; },
    template => { template.activities[1].boxes = 4; },
    template => { template.activities[0].cardIds = ['broad-family-card']; },
    template => { template.activities[0].reviewNote = 'A real learner observation'; },
    template => { template.activities[0].reviewNextTime = true; },
    template => { template.asset.file = '../reading.png'; },
  ])('rejects invalid teaching scope or private observations before any storage operation', async change => {
    const template = source(); change(template);
    const method = vi.spyOn(templates, 'publish');
    await expect(publish({ template })).rejects.toThrow();
    expect(method).not.toHaveBeenCalled(); expect(collection.records.size).toBe(0); expect(assets.records.size).toBe(0);
  });
  it('never accepts an owner selector or private-copy command line', () => {
    expect(parsePublisherArguments([])).toEqual({});
    expect(parsePublisherArguments(['--template', 'reviewed/lesson.json'])).toEqual({ template: 'reviewed/lesson.json' });
    expect(() => parsePublisherArguments(['--owner-id', 'a'.repeat(24)])).toThrow('never selects a private owner');
    expect(() => parsePublisherArguments(['--owner-email', 'tutor@example.test'])).toThrow();
    expect(() => parsePublisherArguments(['--overwrite'])).toThrow();
  });
});

describe('immutable shared template publication', () => {
  it('publishes once and verifies exact content/references/bytes on a no-write retry', async () => {
    expect(await publish()).toEqual({ id: original.id, title: original.title, status: 'published' });
    expect(collection.records.size).toBe(1); expect(assets.records.size).toBe(1);
    const template = await templates.get(original.id);
    expect(template.assets).toMatchObject([{ id: 'reading', w: 1600, h: 1700, type: 'image/png' }]);
    expect((await templates.image(original.id, 'reading')).data).toEqual(pngBytes);
    const insert = vi.spyOn(collection, 'insertOne'), put = vi.spyOn(assets, 'put');
    expect(await publish()).toEqual({ id: original.id, title: original.title, status: 'existing' });
    expect(insert).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  });
  it('never overwrites a previously published version when source metadata changes', async () => {
    await publish();
    const originalRecord = structuredClone(collection.records.get(original.id));
    const template = source(); template.activities[0].directions += '\nA reviewed change needs another version.';
    const insert = vi.spyOn(collection, 'insertOne'), put = vi.spyOn(assets, 'put');
    await expect(publish({ template })).rejects.toThrow('new version ID');
    expect(collection.records.get(original.id)).toEqual(originalRecord); expect(insert).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  });
  it('detects database/source-byte corruption rather than silently replacing it', async () => {
    await publish();
    const [key] = assets.records.keys(), corrupt = Buffer.from(pngBytes); corrupt[corrupt.length - 1] ^= 1; assets.records.set(key, corrupt);
    const put = vi.spyOn(assets, 'put');
    await expect(publish()).rejects.toThrow('new version ID');
    await expect(templates.image(original.id, 'reading')).rejects.toThrow('verification');
    expect(put).not.toHaveBeenCalled();
  });
});


const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sheetIds = ['sound-cue', 'word-work', 'reading', 'meaning'];
function packSource() {
  const template = source();
  Object.assign(template, { schemaVersion: 2, id: 'starter-short-a-amstp-v2', familyId: 'short-a-amstp', edition: 2, supersedes: original.id });
  delete template.asset;
  template.assets = sheetIds.map(id => ({ id, file: `${id}.png`, source: `${id}.svg`, w: 1600, h: 1700, purpose: `Original ${id} sheet` }));
  const [review, build, dictation, read] = template.activities;
  const sheet = id => ({ ...structuredClone(read), id: id === 'reading' ? read.id : `view-${id}`, assetIds: [id] });
  template.activities = [review, sheet('sound-cue'), sheet('word-work'), build, dictation, sheet('reading'), sheet('meaning')];
  return template;
}
function chunk(type, data) {
  const output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length); output.write(type, 4); data.copy(output, 8);
  let crc = 0xffffffff;
  for (const byte of output.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; }
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4);
  return output;
}
function solidSheet(red, green, blue, filter = 0) {
  const header = Buffer.alloc(13); header.writeUInt32BE(1600); header.writeUInt32BE(1700, 4); header[8] = 8; header[9] = 6;
  const row = Buffer.alloc(1600 * 4 + 1);
  for (let x = 0; x < 1600; x++) { const at = x * 4 + 1; row[at] = red; row[at + 1] = green; row[at + 2] = blue; row[at + 3] = 255; }
  if (filter === 1) { for (let at = row.length - 1; at >= 5; at--) row[at] = (row[at] - row[at - 4]) & 255; row[0] = 1; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array(1700).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
const packImages = new Map(sheetIds.map((id, index) => [id, solidSheet(index * 50, 100, 200)]));
const packBytes = () => new Map(packImages);
const publishPack = (options = {}) => publishOriginalTemplate({ templates, template: packSource(), assetBytes: packBytes(), ...options });

describe('four-sheet original teaching pack', () => {
  it('validates seven deliberate activities and four distinct prepared sources while keeping dictation private', () => {
    const validated = validateStarterTemplate(packSource(), packBytes());
    expect(validated.content.activities.map(item => item.type)).toEqual(['review', 'read', 'read', 'build', 'dictation', 'read', 'read']);
    expect(validated.assets.map(item => item.id)).toEqual(sheetIds);
    expect(new Set(validated.assets.map(item => item.renderHash)).size).toBe(4);
    expect(studentProjection(validated.content.activities[4])).toEqual({ type: 'dictation', letters: '', cardIds: [], assetIds: [], boxes: 3 });
  });
  it.each([
    template => { template.assets[0].id = 'reading'; },
    template => { template.assets[0].file = '../sound-cue.png'; },
    template => { template.assets[0].source = '../sound-cue.svg'; },
    template => { template.assets[0].purpose = ''; },
    template => { template.assets[0].w = 1200; },
    template => { template.supersedes = template.id; },
    template => { template.familyId = 'another-family'; },
    template => { template.activities[1].assetIds = ['reading', 'meaning']; },
    template => { template.activities[4].assetIds = ['word-work']; },
    template => { template.activities[4].boxes = 0; },
    template => { template.activities[3].letters = 'm a t'; },
    template => { template.readingLines = ['A cat sat.']; },
  ])('rejects unsafe manifests, teaching scope, invalid sequence or answer exposure before publication', async change => {
    const template = packSource(); change(template); const method = vi.spyOn(templates, 'publish');
    await expect(publishPack({ template })).rejects.toThrow();
    expect(method).not.toHaveBeenCalled(); expect(collection.records.size).toBe(0); expect(assets.records.size).toBe(0);
  });
  it('requires exact source IDs and rejects duplicate raster images even when metadata/file hashes differ', async () => {
    const missing = packBytes(); missing.delete('meaning');
    await expect(publishPack({ assetBytes: missing })).rejects.toThrow('exact PNG byte map');
    const extra = packBytes(); extra.set('unused', pngBytes);
    await expect(publishPack({ assetBytes: extra })).rejects.toThrow('exact PNG byte map');
    const duplicate = packBytes(), sameImage = duplicate.get('reading');
    const tagged = Buffer.concat([sameImage.subarray(0, -12), chunk('tEXt', Buffer.from('comment\0different metadata')), sameImage.subarray(-12)]);
    expect(digest(tagged)).not.toBe(digest(sameImage));
    duplicate.set('meaning', tagged);
    await expect(publishPack({ assetBytes: duplicate })).rejects.toThrow('duplicated rendered');
    expect(collection.records.size).toBe(0); expect(assets.records.size).toBe(0);
  });
  it('normalizes PNG filter choices when identifying duplicated rendered sheets', () => {
    const plain = solidSheet(20, 80, 160), filtered = solidSheet(20, 80, 160, 1);
    expect(digest(plain)).not.toBe(digest(filtered));
    expect(preparedPng(plain).renderHash).toBe(preparedPng(filtered).renderHash);
  });
  it('loads all declared bounded local files before publication, retains v1 --template compatibility, and rejects missing sources', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'original-template-'));
    try {
      const filename = path.join(directory, 'lesson.json');
      await writeFile(filename, JSON.stringify(packSource()));
      for (const [id, bytes] of packBytes()) await writeFile(path.join(directory, `${id}.png`), bytes);
      const loaded = await loadTemplateSources(filename);
      expect([...loaded.assetBytes.keys()]).toEqual(sheetIds);
      expect(loaded.assetBytes.get('meaning')).toEqual(packImages.get('meaning'));
      await rm(path.join(directory, 'meaning.png'));
      await expect(loadTemplateSources(filename)).rejects.toThrow();
      await writeFile(filename, JSON.stringify(source())); await writeFile(path.join(directory, 'reading.png'), pngBytes);
      expect((await loadTemplateSources(filename)).assetBytes.get('reading')).toEqual(pngBytes);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('preserves the exact immutable v1 canonical digest and asset contract', async () => {
    await publish();
    const clean = cleanLessonInput(original), legacy = { id: original.id, schemaVersion: 1, title: clean.title, description: original.description.trim(), knownLetters: original.knownLetters, wordChain: original.wordChain, readingLines: original.readingLines, activities: clean.activities, assets: [{ id: 'reading', w: 1600, h: 1700, type: 'image/png', bytes: pngBytes.length, sha256: digest(pngBytes) }] };
    const stored = await templates.get(original.id);
    expect(stored.sourceHash).toBe(digest(JSON.stringify(legacy)));
    expect(Object.keys(stored.assets[0]).sort()).toEqual(['bytes', 'h', 'id', 'sha256', 'type', 'w']);
  });
  it('publishes each exact source, hides only the superseded catalog entry, and leaves old copies/notes/images intact', async () => {
    await publish();
    const privateStore = memoryLessons({ templates }), old = await privateStore.lessons.createFromTemplate('tutor', await templates.get(original.id));
    const edited = await privateStore.lessons.save('tutor', old.id, { ...old, activities: old.activities.map((item, index) => index ? item : { ...item, reviewNextTime: true, reviewNote: 'An actual private observation' }) });
    expect(await publishPack()).toMatchObject({ id: 'starter-short-a-amstp-v2', status: 'published' });
    expect((await templates.list()).map(item => item.id)).toEqual(['starter-short-a-amstp-v2']);
    const newer = await templates.get('starter-short-a-amstp-v2');
    expect(newer).toMatchObject({ familyId: 'short-a-amstp', edition: 2, supersedes: original.id });
    for (const [id, bytes] of packBytes()) expect((await templates.image(newer.id, id)).data).toEqual(bytes);
    const copy = await privateStore.lessons.createFromTemplate('tutor', newer);
    expect(copy.id).toBe(old.id); expect(copy.activities).toHaveLength(7); expect(copy.assets).toHaveLength(4);
    expect(copy.revision).toBe(edited.revision + 1);
    expect(copy.assets.map(asset => asset.id)).toEqual(sheetIds.map(id => `${id}-v2`));
    expect(copy.activities.find(item => item.id === 'read-sam-pat').assetIds).toEqual(['reading-v2']);
    expect(copy.activities.find(item => item.id === edited.activities[0].id)).toMatchObject({ reviewNextTime: true, reviewNote: 'An actual private observation' });
    expect((await templates.image(original.id, 'reading')).data).toEqual(pngBytes);
    expect(privateStore.collection.records.size).toBe(1);
    for (const [id, bytes] of packBytes()) expect((await privateStore.lessons.getAsset('tutor', copy.id, `${id}-v2`)).data).toEqual(bytes);
    expect(privateStore.assets.records.size).toBe(0);
    const put = vi.spyOn(assets, 'put');
    expect(await publishPack()).toMatchObject({ status: 'existing' }); expect(put).not.toHaveBeenCalled();
  });
  it('keeps v1 discoverable after a partial v2 upload, then retries without a partial catalog or duplicate sources', async () => {
    await publish();
    const write = assets.put.bind(assets); let calls = 0;
    const put = vi.spyOn(assets, 'put').mockImplementation(async (...args) => { if (++calls === 3) throw new Error('Upload interrupted'); return write(...args); });
    await expect(publishPack()).rejects.toThrow('Upload interrupted');
    expect(await templates.get('starter-short-a-amstp-v2')).toBeNull();
    expect((await templates.list()).map(item => item.id)).toEqual([original.id]); expect(collection.records.size).toBe(1);
    put.mockRestore();
    expect(await publishPack()).toMatchObject({ status: 'published' });
    expect(collection.records.size).toBe(2); expect(assets.records.size).toBe(5);
    expect((await templates.list()).map(item => item.id)).toEqual(['starter-short-a-amstp-v2']);
  });
});
