import { beforeEach, describe, expect, it } from 'vitest';
import { createSchedulingRepository } from './scheduling.js';
import { memoryLessonCollection, memoryLessons } from './lessonFixtures.js';

const owner = 'owner-a', other = 'owner-b';
const input = changes => ({ id: 'schedule-a', studentName: 'Casey', localDate: '2026-11-24', localTime: '15:00', timeZone: 'America/Chicago', durationMinutes: 45, repeat: 'weekly', untilDate: null, lessonId: null, ...changes });
const range = { from: '2026-11-23', to: '2026-12-06', timeZone: 'America/Chicago' };
let collection, lessons, scheduling;
beforeEach(() => {
  collection = memoryLessonCollection(); lessons = memoryLessons().lessons;
  scheduling = createSchedulingRepository({ collection, lessons });
});

describe('private teacher schedule persistence', () => {
  it('creates idempotently and never returns another owner’s schedule', async () => {
    const created = await scheduling.create(owner, input());
    expect(await scheduling.create(owner, input({ studentName: 'Retry must not overwrite' }))).toEqual(created);
    expect((await scheduling.list(other, range)).occurrences).toEqual([]);
    for (const action of [() => scheduling.get(other, created.id), () => scheduling.create(other, input()), () => scheduling.occurrence(other, 'schedule-a~2026-11-24'), () => scheduling.save(other, created.id, { ...input(), revision: 1 }), () => scheduling.cancel(other, created.id, 1), () => scheduling.changeOccurrence(other, created.id, '2026-11-24', { revision: 1, cancelled: true })]) await expect(action()).rejects.toMatchObject({ status: 404 });
    expect(collection.records.size).toBe(1);
  });
  it('validates the owner of an attached preparation and permits blank whiteboards', async () => {
    await lessons.create(other, { id: 'other-prep', title: 'Private', activities: [] });
    await expect(scheduling.create(owner, input({ lessonId: 'other-prep' }))).rejects.toMatchObject({ status: 400 });
    await lessons.create(owner, { id: 'my-prep', title: 'Short a', activities: [] });
    const created = await scheduling.create(owner, input({ lessonId: 'my-prep' }));
    expect(created.lessonId).toBe('my-prep');
    expect(await scheduling.save(owner, created.id, { ...created, lessonId: null })).toMatchObject({ lessonId: null, revision: 2 });
  });
  it('detects stale updates across separate repository instances without losing either time', async () => {
    await scheduling.create(owner, input());
    const another = createSchedulingRepository({ collection, lessons });
    const results = await Promise.allSettled([scheduling.save(owner, 'schedule-a', input({ revision: 1, localTime: '16:00' })), another.save(owner, 'schedule-a', input({ revision: 1, localTime: '17:00' }))]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected').reason).toMatchObject({ status: 409 });
    expect((await scheduling.get(owner, 'schedule-a')).revision).toBe(2);
  });
  it('reschedules one occurrence, preserves its identity, cancels another, and restores defaults', async () => {
    await scheduling.create(owner, input());
    await scheduling.changeOccurrence(owner, 'schedule-a', '2026-11-24', { revision: 1, localDate: '2026-12-03', localTime: '16:30', durationMinutes: 60 });
    expect(await scheduling.occurrence(owner, 'schedule-a~2026-11-24')).toMatchObject({ id: 'schedule-a~2026-11-24', startsAt: '2026-12-03T22:30:00.000Z', durationMinutes: 60, rescheduled: true });
    await scheduling.changeOccurrence(owner, 'schedule-a', '2026-12-01', { revision: 2, cancelled: true });
    expect((await scheduling.list(owner, range)).occurrences.map(item => item.id)).toEqual(['schedule-a~2026-11-24']);
    await expect(scheduling.occurrence(owner, 'schedule-a~2026-12-01')).rejects.toMatchObject({ status: 404 });
    await scheduling.changeOccurrence(owner, 'schedule-a', '2026-11-24', { revision: 3, reset: true });
    expect(await scheduling.occurrence(owner, 'schedule-a~2026-11-24')).toMatchObject({ localDate: '2026-11-24', localTime: '15:00', rescheduled: false });
    await expect(scheduling.changeOccurrence(owner, 'schedule-a', '2026-11-25', { revision: 4, cancelled: true })).rejects.toMatchObject({ status: 404 });
  });
  it('keeps valid exceptions when editing the series time, clearing them only for an altered recurrence anchor', async () => {
    const created = await scheduling.create(owner, input());
    await scheduling.changeOccurrence(owner, created.id, '2026-11-24', { revision: 1, cancelled: true });
    const saved = await scheduling.save(owner, created.id, input({ revision: 2, localTime: '17:00' }));
    expect(saved.exceptions).toEqual([{ date: '2026-11-24', cancelled: true }]);
    const moved = await scheduling.save(owner, created.id, { ...saved, localDate: '2026-11-25' });
    expect(moved.exceptions).toEqual([]);
  });
  it('cancels a whole series safely and deletes all schedule data with its owner', async () => {
    await scheduling.create(owner, input());
    await scheduling.cancel(owner, 'schedule-a', 1);
    expect((await scheduling.list(owner, range)).appointments).toEqual([]);
    expect(await scheduling.cancel(owner, 'schedule-a', 1)).toMatchObject({ cancelled: true, revision: 2 });
    await expect(scheduling.occurrence(owner, 'schedule-a~2026-11-24')).rejects.toMatchObject({ status: 404 });
    await scheduling.create(other, input({ id: 'other-a' }));
    await scheduling.deleteOwner(owner);
    expect(collection.records.size).toBe(1); expect(collection.records.has('other-a')).toBe(true);
  });
  it('does not create or retain a schedule for an account being deleted', async () => {
    let calls = 0;
    scheduling = createSchedulingRepository({ collection, lessons, ownerExists: async () => ++calls < 2 });
    await expect(scheduling.create(owner, input())).rejects.toMatchObject({ status: 403 });
    expect(collection.records.size).toBe(0);
  });
  it('rejects a huge range and invalid reschedules before persistence', async () => {
    await scheduling.create(owner, input());
    await expect(scheduling.list(owner, { ...range, to: '2027-12-01' })).rejects.toMatchObject({ status: 400 });
    await expect(scheduling.changeOccurrence(owner, 'schedule-a', '2026-11-24', { revision: 1, localDate: '2027-03-14', localTime: '02:30', durationMinutes: 60 })).rejects.toMatchObject({ status: 400 });
    expect((await scheduling.get(owner, 'schedule-a')).revision).toBe(1);
  });
});
