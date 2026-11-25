import { describe, expect, it } from 'vitest';
import { cleanLessonInput, studentProjection, MAX_LESSON_ACTIVITIES } from './lessons.js';
import { TEACHING_MARKS } from './teachingMarks.js';
const activity = patch => ({ id: 'review-1', type: 'review', ...patch });
describe('manual lesson preparation', () => {
  it('keeps manual order and grapheme tiles without guessing sound counts', () => {
    const lesson = cleanLessonInput({ title: 'Practice', activities: [activity({ letters: 'sh  i p', boxes: 3 }), activity({ id: 'build-1', type: 'build', letters: 's t o p', boxes: 4 })] });
    expect(lesson.activities.map(item => [item.id, item.letters, item.boxes])).toEqual([['review-1', 'sh i p', 3], ['build-1', 's t o p', 4]]);
  });
  it('publishes only the explicit student material allowlist', () => {
    const projection = studentProjection(activity({ title: 'Private target', directions: 'Do not reveal', targets: 'answer\nsecret', reviewNote: 'Private observation', reviewNextTime: true, letters: 'm a p', cardIds: ['card-1'], assetIds: ['asset-1'], marks: ['breve', 'schwa'], boxes: 3, ownerId: 'other', filename: 'Child-name.pdf' }));
    expect(projection).toEqual({ type: 'review', letters: 'm a p', cardIds: ['card-1'], assetIds: [], boxes: 3 });
    expect(JSON.stringify(projection)).not.toMatch(/Private|secret|answer|Child|ownerId/);
    expect(projection).not.toHaveProperty('marks');
  });
  it('keeps bounded mark selections in every activity without requiring image assets', () => {
    const marks = TEACHING_MARKS.map(mark => mark.id);
    const lesson = cleanLessonInput({ title: 'Marks', activities: ['review', 'build', 'dictation', 'read'].map(type => activity({ id: type, type, marks })) });
    expect(lesson.activities.every(item => JSON.stringify(item.marks) === JSON.stringify(marks))).toBe(true);
    expect(lesson.activities.every(item => item.assetIds.length === 0)).toBe(true);
    marks.pop();
    expect(lesson.activities[0].marks).toHaveLength(TEACHING_MARKS.length);
  });
  it('reads earlier saved lessons with no mark selection and leaves their public material signature unchanged', () => {
    expect(cleanLessonInput({ title: 'Earlier', activities: [activity()] }).activities[0].marks).toEqual([]);
    expect(studentProjection(activity({ letters: 'm a t', marks: ['breve'] }))).toEqual(studentProjection(activity({ letters: 'm a t', marks: ['macron', 'syllable-scoop'] })));
  });
  it.each([null, 'breve', ['unknown'], ['breve', 'breve'], [{}], [...TEACHING_MARKS.map(mark => mark.id), 'breve']])('rejects invalid mark selections: %j', marks => {
    expect(() => cleanLessonInput({ title: 'Marks', activities: [activity({ marks })] })).toThrow('Choose valid teaching marks.');
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
