import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createLessonRepository, lessonTemplateCopyId } from './lessons.js';
import { memoryLessons } from './lessonFixtures.js';
import { MAX_LESSONS, MAX_LESSON_ASSETS } from '../shared/lessons.js';
const owner = 'owner-a', other = 'owner-b';
const blank = (id = 'lesson-1') => ({ id, title: 'Short a practice', activities: [] });
const read = assetIds => ({ id: 'read-1', type: 'read', assetIds });
const image = { bytes: Buffer.from([255, 216, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8]), type: 'image/jpeg', w: 400, h: 300 };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let lessons, collection, assets;
beforeEach(() => ({ lessons, collection, assets } = memoryLessons()));

describe('owner-scoped saved lesson persistence', () => {
  it('makes retried creates idempotent without allowing another owner to take over the id', async () => {
    const original = await lessons.create(owner, blank());
    expect(await lessons.create(owner, { ...blank(), title: 'Retry must not overwrite' })).toEqual(original);
    await expect(lessons.create(other, blank())).rejects.toMatchObject({ status: 404 });
    expect((await lessons.list(other))).toEqual([]);
    expect(collection.records.size).toBe(1);
  });
  it('checks ownership for every read, save, removal and asset operation', async () => {
    await lessons.create(owner, blank());
    await lessons.putAsset(owner, 'lesson-1', 'image-1', image);
    const get = vi.spyOn(assets, 'get'), put = vi.spyOn(assets, 'put'), remove = vi.spyOn(assets, 'remove');
    for (const action of [
      () => lessons.get(other, 'lesson-1'), () => lessons.save(other, 'lesson-1', { ...blank(), revision: 1 }),
      () => lessons.remove(other, 'lesson-1', 1), () => lessons.putAsset(other, 'lesson-1', 'image-2', image),
      () => lessons.getAsset(other, 'lesson-1', 'image-1'), () => lessons.removeAsset(other, 'lesson-1', 'image-1'),
    ]) await expect(action()).rejects.toMatchObject({ status: 404 });
    expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it('detects stale saves and retains manual activity order and private review notes', async () => {
    await lessons.create(owner, blank());
    const activities = [{ id: 'dictation', type: 'dictation', targets: 'map\nmat', directions: 'Say one at a time', reviewNextTime: true, reviewNote: 'Revisit ending sounds' }, { id: 'review', type: 'review', letters: 'm a t' }];
    const saved = await lessons.save(owner, 'lesson-1', { title: 'New title', activities, revision: 1 });
    expect(saved.revision).toBe(2); expect(saved.activities.map(item => item.id)).toEqual(['dictation', 'review']);
    expect((await lessons.get(owner, 'lesson-1')).activities[0].reviewNote).toBe('Revisit ending sounds');
    await expect(lessons.save(owner, 'lesson-1', { ...blank(), revision: 1 })).rejects.toMatchObject({ status: 409 });
    expect(await lessons.list(owner)).toMatchObject([{ activityCount: 2, reviewCount: 1, revision: 2 }]);
  });
  it('keeps worksheet writes out of the editable revision and validates ready asset references', async () => {
    await lessons.create(owner, blank());
    await expect(lessons.save(owner, 'lesson-1', { ...blank(), revision: 1, activities: [read(['missing'])] })).rejects.toMatchObject({ status: 400 });
    const asset = await lessons.putAsset(owner, 'lesson-1', 'image-1', image);
    expect(asset).toEqual({ id: 'image-1', w: 400, h: 300, type: 'image/jpeg', bytes: image.bytes.length });
    expect(await lessons.putAsset(owner, 'lesson-1', 'image-1', image)).toEqual(asset);
    await expect(lessons.putAsset(owner, 'lesson-1', 'image-1', { ...image, bytes: Buffer.from('different') })).rejects.toMatchObject({ status: 409 });
    expect((await lessons.get(owner, 'lesson-1')).revision).toBe(1);
    await lessons.save(owner, 'lesson-1', { ...blank(), revision: 1, activities: [read(['image-1'])] });
    await expect(lessons.removeAsset(owner, 'lesson-1', 'image-1')).rejects.toMatchObject({ status: 409 });
    await lessons.save(owner, 'lesson-1', { ...blank(), revision: 2 });
    await lessons.removeAsset(owner, 'lesson-1', 'image-1');
    expect((await lessons.get(owner, 'lesson-1')).revision).toBe(3);
    expect(assets.records.size).toBe(0);
  });
  it('bounds lesson and worksheet counts including parallel same-owner requests', async () => {
    await lessons.create(owner, blank());
    for (let index = 0; index < MAX_LESSON_ASSETS; index++) await lessons.putAsset(owner, 'lesson-1', `image-${index}`, image);
    await expect(lessons.putAsset(owner, 'lesson-1', 'overflow', image)).rejects.toMatchObject({ status: 409 });
    await Promise.all(Array.from({ length: MAX_LESSONS - 1 }, (_, index) => lessons.create(owner, blank(`lesson-${index + 2}`))));
    await expect(lessons.create(owner, blank('overflow'))).rejects.toMatchObject({ status: 409 });
    expect((await lessons.list(owner))).toHaveLength(MAX_LESSONS);
  });
  it('removes a failed upload reservation so a stable retry can succeed', async () => {
    await lessons.create(owner, blank());
    const original = assets.put;
    assets.put = vi.fn(async (...args) => { await original(...args); throw new Error('response lost'); });
    await expect(lessons.putAsset(owner, 'lesson-1', 'image-1', image)).rejects.toThrow('response lost');
    expect((await lessons.get(owner, 'lesson-1')).assets).toEqual([]); expect(assets.records.size).toBe(0);
    assets.put = original;
    expect(await lessons.putAsset(owner, 'lesson-1', 'image-1', image)).toMatchObject({ id: 'image-1' });
  });
  it('cleans a late upload when another process deletes the lesson while Blob is writing', async () => {
    await lessons.create(owner, blank());
    const writing = deferred(), release = deferred(), original = assets.put;
    assets.put = async (...args) => { writing.resolve(); await release.promise; await original(...args); };
    const upload = lessons.putAsset(owner, 'lesson-1', 'image-1', image);
    await writing.promise;
    const otherProcess = createLessonRepository({ collection, assets });
    await otherProcess.remove(owner, 'lesson-1', 1);
    release.resolve();
    await expect(upload).rejects.toMatchObject({ status: 404 });
    expect(collection.records.size).toBe(0); expect(assets.records.size).toBe(0);
  });
  it('denies deleted accounts and serializes cleanup behind an in-flight upload', async () => {
    let active = true;
    lessons = createLessonRepository({ collection, assets, ownerExists: async () => active });
    await lessons.create(owner, blank());
    const writing = deferred(), release = deferred(), original = assets.put;
    assets.put = async (...args) => { writing.resolve(); await release.promise; await original(...args); };
    const upload = lessons.putAsset(owner, 'lesson-1', 'image-1', image);
    await writing.promise; active = false;
    const cleanup = lessons.deleteOwner(owner);
    release.resolve();
    await expect(upload).rejects.toMatchObject({ status: 403 }); await cleanup;
    await expect(lessons.create(owner, blank('new-lesson'))).rejects.toMatchObject({ status: 403 });
    expect(collection.records.size).toBe(0); expect(assets.records.size).toBe(0);
  });
  it('retains a deletion tombstone for safe cleanup retry after storage failure', async () => {
    await lessons.create(owner, blank()); await lessons.putAsset(owner, 'lesson-1', 'image-1', image);
    const original = assets.removeLesson;
    assets.removeLesson = vi.fn(async () => { throw new Error('storage unavailable'); });
    await expect(lessons.remove(owner, 'lesson-1', 1)).rejects.toThrow('storage unavailable');
    expect((await lessons.list(owner))[0].deletePending).toBe(true);
    await expect(lessons.get(owner, 'lesson-1')).rejects.toMatchObject({ status: 404 });
    assets.removeLesson = original;
    await lessons.remove(owner, 'lesson-1', 1);
    expect(collection.records.size).toBe(0); expect(assets.records.size).toBe(0);
  });
});


const originalTemplateId = 'starter-short-a-amstp-v1';
function familyTemplates() {
  const bytes = image.bytes, sha256 = createHash('sha256').update(bytes).digest('hex');
  const metadata = id => ({ id, w: image.w, h: image.h, type: image.type, bytes: bytes.length, sha256 });
  const original = { id: originalTemplateId, schemaVersion: 1, sourceHash: '1'.repeat(64), title: 'Short a practice', assets: [metadata('reading')], activities: [
    { id: 'review-sounds', type: 'review', title: 'Sound review', directions: 'Model known sounds', letters: 'a m s t p' },
    { id: 'build-short-a', type: 'build', title: 'Build words', targets: 'mat\npat', letters: 'm a t p s', boxes: 3 },
    { id: 'dictation-short-a', type: 'dictation', title: 'Spell words', targets: 'sat', boxes: 3 },
    { id: 'read-sam-pat', type: 'read', title: 'Read Sam and Pat', assetIds: ['reading'] },
  ] };
  const sheet = id => ({ id: `view-${id}`, type: 'read', title: `Read ${id}`, assetIds: [id] });
  const newer = { ...original, id: 'starter-short-a-amstp-v2', schemaVersion: 2, sourceHash: '2'.repeat(64), familyId: 'short-a-amstp', edition: 2, supersedes: original.id, assets: ['sound-cue', 'word-work', 'reading', 'meaning'].map(metadata), activities: [
    { ...original.activities[0], directions: 'New professional teaching directions' }, sheet('sound-cue'), sheet('word-work'), original.activities[1], original.activities[2], { ...original.activities[3], title: 'Read about Pat' }, sheet('meaning'),
  ] };
  const documents = new Map([[original.id, original], [newer.id, newer]]);
  const shared = new Map([...documents.values()].flatMap(template => template.assets.map(asset => [`${template.id}/${asset.id}`, Buffer.from(bytes)])));
  const templates = { get: vi.fn(async id => structuredClone(documents.get(id) || null)), image: vi.fn(async (id, assetId) => { const data = shared.get(`${id}/${assetId}`); return data ? { ...metadata(assetId), data: Buffer.from(data) } : null; }) };
  return { original, newer, templates, shared };
}

describe('same-lesson immutable edition upgrades', () => {
  let original, newer, templates, shared;
  beforeEach(() => {
    ({ original, newer, templates, shared } = familyTemplates());
    ({ lessons, assets, collection } = memoryLessons({ templates }));
  });
  it('upgrades an original copy at the same ID and preserves all four activity observations by stable ID', async () => {
    const first = await lessons.createFromTemplate(owner, original);
    const observed = await lessons.save(owner, first.id, { ...first, activities: first.activities.map((item, index) => ({ ...item, reviewNextTime: index % 2 === 0, reviewNote: `Actual observation ${index}` })) });
    const upgraded = await lessons.createFromTemplate(owner, newer);
    expect(upgraded.id).toBe(first.id); expect(upgraded.revision).toBe(observed.revision + 1); expect(upgraded.assets).toHaveLength(4); expect(upgraded.activities).toHaveLength(7);
    for (const item of observed.activities) expect(upgraded.activities.find(next => next.id === item.id)).toMatchObject({ reviewNextTime: item.reviewNextTime, reviewNote: item.reviewNote });
    expect(upgraded.activities.find(item => item.id === 'review-sounds').directions).toBe('New professional teaching directions');
    expect(upgraded.activities.find(item => item.id === 'read-sam-pat').title).toBe('Read about Pat');
    expect(collection.records.size).toBe(1); expect(collection.records.get(first.id).sourceTemplate).toEqual({ id: newer.id, sourceHash: newer.sourceHash });
    expect(collection.records.get(first.id).assets.every(asset => asset.origin.templateId === newer.id && asset.id === `${asset.origin.assetId}-v2`)).toBe(true);
    const oldReading = observed.activities.find(item => item.id === 'read-sam-pat'), newReading = upgraded.activities.find(item => item.id === 'read-sam-pat');
    expect(oldReading.assetIds).toEqual(['reading']); expect(newReading.assetIds).toEqual(['reading-v2']);
    expect(JSON.stringify(newReading.assetIds)).not.toBe(JSON.stringify(oldReading.assetIds));
    expect((await lessons.getAsset(owner, first.id, 'reading-v2')).data).toEqual(image.bytes);
    await expect(lessons.getAsset(owner, first.id, 'reading')).rejects.toMatchObject({ status: 404 });
    expect(await lessons.createFromTemplate(owner, newer)).toEqual(upgraded);
    expect(await lessons.createFromTemplate(owner, original)).toEqual(upgraded); // never downgrade
    const edited = await lessons.save(owner, upgraded.id, { ...upgraded, title: 'My new edition edits' });
    expect(await lessons.createFromTemplate(owner, newer)).toEqual(edited);
  });
  it.each([
    ['title', input => { input.title = 'My customized plan'; }],
    ['directions', input => { input.activities[0].directions += ' with my additional prompt'; }],
    ['targets', input => { input.activities[1].targets = 'map'; }],
    ['letters', input => { input.activities[0].letters = 'm s'; }],
    ['activity order', input => { input.activities.reverse(); }],
    ['extra activity', input => { input.activities.push({ id: 'my-extra', type: 'review', letters: 'a' }); }],
    ['worksheet choice', input => { input.activities[3].assetIds = []; }],
  ])('keeps customized %s unchanged rather than duplicating or resetting the plan', async (_field, customize) => {
    const first = await lessons.createFromTemplate(owner, original), input = structuredClone(first); customize(input);
    const custom = await lessons.save(owner, first.id, input);
    expect(await lessons.createFromTemplate(owner, newer)).toEqual(custom);
    expect(collection.records.size).toBe(1); expect(collection.records.get(first.id).sourceTemplate.id).toBe(original.id);
  });
  it('declines an edition that removed a stable activity ID instead of losing its observation', async () => {
    const first = await lessons.createFromTemplate(owner, original);
    const observed = await lessons.save(owner, first.id, { ...first, activities: first.activities.map(item => ({ ...item, reviewNote: 'An actual observation' })) });
    newer.activities.find(item => item.id === 'read-sam-pat').id = 'incompatible-new-reading-id';
    expect(await lessons.createFromTemplate(owner, newer)).toEqual(observed);
    expect(collection.records.size).toBe(1);
  });
  it('retains even an unused tutor-uploaded image and declines the automatic upgrade', async () => {
    const first = await lessons.createFromTemplate(owner, original);
    await lessons.putAsset(owner, first.id, 'my-own-worksheet', image);
    const custom = await lessons.get(owner, first.id);
    expect(await lessons.createFromTemplate(owner, newer)).toEqual(custom);
    expect((await lessons.getAsset(owner, first.id, 'my-own-worksheet')).data).toEqual(image.bytes);
    expect(assets.records.size).toBe(1); expect(collection.records.size).toBe(1);
  });
  it('creates fresh enriched copies at stable family IDs for two isolated tutors without copying shared bytes', async () => {
    const first = await lessons.createFromTemplate(owner, newer), second = await lessons.createFromTemplate(other, newer);
    expect(first.id).toBe(lessonTemplateCopyId(owner, originalTemplateId)); expect(second.id).toBe(lessonTemplateCopyId(other, originalTemplateId));
    expect(first.id).not.toBe(second.id); expect(first.revision).toBe(1); expect(first.activities).toHaveLength(7);
    expect(first.assets.map(asset => asset.id)).toEqual(['sound-cue-v2', 'word-work-v2', 'reading-v2', 'meaning-v2']);
    expect(first.activities.filter(item => item.type === 'read').map(item => item.assetIds)).toEqual([['sound-cue-v2'], ['word-work-v2'], ['reading-v2'], ['meaning-v2']]);
    expect(await lessons.createFromTemplate(owner, newer)).toEqual(first);
    expect(collection.records.size).toBe(2); expect(assets.records.size).toBe(0);
    await expect(lessons.get(other, first.id)).rejects.toMatchObject({ status: 404 });
    const sources = new Map(shared);
    await lessons.remove(owner, first.id, first.revision); await lessons.deleteOwner(other);
    expect(collection.records.size).toBe(0); expect(shared).toEqual(sources);
    expect((await templates.image(original.id, 'reading')).data).toEqual(image.bytes);
    expect((await templates.image(newer.id, 'reading')).data).toEqual(image.bytes);
  });
  it.each(['content', 'asset'])('uses revision and asset-version CAS to preserve a simultaneous %s edit from another process', async kind => {
    const first = await lessons.createFromTemplate(owner, original), checking = deferred(), release = deferred(), readOriginal = templates.get;
    templates.get = vi.fn(async id => { checking.resolve(); await release.promise; return readOriginal(id); });
    const upgrade = lessons.createFromTemplate(owner, newer); await checking.promise;
    const peer = createLessonRepository({ collection, assets, templates });
    if (kind === 'content') await peer.save(owner, first.id, { ...first, title: 'Saved by another tab' });
    else await peer.putAsset(owner, first.id, 'concurrent-upload', image);
    const current = await peer.get(owner, first.id); release.resolve();
    expect(await upgrade).toEqual(current); expect(collection.records.get(first.id).sourceTemplate.id).toBe(original.id);
    expect(collection.records.size).toBe(1);
  });
  it('rechecks the active owner before upgrading after an asynchronous original lookup', async () => {
    let active = true; lessons = createLessonRepository({ collection, assets, templates, ownerExists: async () => active });
    const first = await lessons.createFromTemplate(owner, original), checking = deferred(), release = deferred(), readOriginal = templates.get;
    templates.get = vi.fn(async id => { checking.resolve(); await release.promise; return readOriginal(id); });
    const upgrade = lessons.createFromTemplate(owner, newer); await checking.promise; active = false; release.resolve();
    await expect(upgrade).rejects.toMatchObject({ status: 403 });
    expect(collection.records.get(first.id).revision).toBe(first.revision); expect(collection.records.get(first.id).sourceTemplate.id).toBe(original.id);
  });
});
