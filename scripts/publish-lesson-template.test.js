import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLessonTemplates } from '../server/lessonFixtures.js';
import { MAX_PICTURE_BYTES } from '../shared/pieces.js';
import { studentProjection } from '../shared/lessons.js';
import { preparedPng, validateStarterTemplate } from '../server/starterLesson.js';
import { parsePublisherArguments, publishOriginalTemplate } from './publish-lesson-template.mjs';

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
