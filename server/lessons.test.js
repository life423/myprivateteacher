import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLessonRepository } from './lessons.js';
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
