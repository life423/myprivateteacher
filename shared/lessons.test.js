import { describe, expect, it } from 'vitest';
import { cleanLessonInput, studentProjection, MAX_LESSON_ACTIVITIES } from './lessons.js';
const activity = patch => ({ id: 'review-1', type: 'review', ...patch });
describe('manual lesson preparation', () => {
  it('keeps manual order and grapheme tiles without guessing sound counts', () => {
    const lesson = cleanLessonInput({ title: 'Practice', activities: [activity({ letters: 'sh  i p', boxes: 3 }), activity({ id: 'build-1', type: 'build', letters: 's t o p', boxes: 4 })] });
    expect(lesson.activities.map(item => [item.id, item.letters, item.boxes])).toEqual([['review-1', 'sh i p', 3], ['build-1', 's t o p', 4]]);
  });
  it('publishes only the explicit student material allowlist', () => {
    const projection = studentProjection(activity({ title: 'Private target', directions: 'Do not reveal', targets: 'answer\nsecret', reviewNote: 'Private observation', reviewNextTime: true, letters: 'm a p', cardIds: ['card-1'], assetIds: ['asset-1'], boxes: 3, ownerId: 'other', filename: 'Child-name.pdf' }));
    expect(projection).toEqual({ type: 'review', letters: 'm a p', cardIds: ['card-1'], assetIds: [], boxes: 3 });
    expect(JSON.stringify(projection)).not.toMatch(/Private|secret|answer|Child|ownerId/);
  });
  it.each([
    ['dictation', { type: 'dictation', letters: '', cardIds: [], assetIds: [], boxes: 3 }],
    ['read', { type: 'read', letters: '', cardIds: [], assetIds: ['asset-1'], boxes: 0 }],
    ['build', { type: 'build', letters: 's e c r e t', cardIds: [], assetIds: [], boxes: 3 }],
  ])('does not publish stale materials after switching to %s', (type, expected) => {
    expect(studentProjection(activity({ type, letters: 's e c r e t', cardIds: ['card-1'], assetIds: ['asset-1'], boxes: 3, targets: 'PRIVATE SECRET' }))).toEqual(expected);
  });
  it.each([
    [activity({ type: 'automatic' })], [activity(), activity()],
    [activity({ letters: 'a <script>' })], [activity({ boxes: 1 })],
    [activity({ directions: 'x'.repeat(2001) })], [activity({ targets: 'x'.repeat(10001) })],
    [activity({ assetIds: ['../private'] })], [activity({ reviewNextTime: 'yes' })],
    Array.from({ length: MAX_LESSON_ACTIVITIES + 1 }, (_, index) => activity({ id: `a-${index}` })),
  ])('rejects malformed or unbounded preparation: %j', activities => {
    expect(() => cleanLessonInput({ title: 'Practice', activities })).toThrow();
  });
});
