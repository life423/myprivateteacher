import { BOX_COUNTS, MAX_TILES, cleanTileText } from './tiles.js';

export const MAX_LESSON_ACTIVITIES = 24;
export const MAX_LESSON_ASSETS = 8;
export const MAX_LESSONS = 100;
export const LESSON_TYPES = ['review', 'build', 'dictation', 'read'];
export const isLessonId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
function text(value, limit, label) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > limit) invalid(`${label} is too long or is not text.`);
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}
function ids(value, limit, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limit || value.some(id => !isLessonId(id)) || new Set(value).size !== value.length) invalid(`Choose valid ${label}.`);
  return [...value];
}
export function cleanLessonInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('A lesson needs a title and activities.');
  const title = text(value.title, 120, 'Lesson title') || 'Untitled lesson';
  if (!Array.isArray(value.activities) || value.activities.length > MAX_LESSON_ACTIVITIES) invalid(`Choose up to ${MAX_LESSON_ACTIVITIES} activities.`);
  const seen = new Set();
  const activities = value.activities.map(activity => {
    if (!activity || typeof activity !== 'object' || !isLessonId(activity.id) || seen.has(activity.id) || !LESSON_TYPES.includes(activity.type)) invalid('Each activity needs a unique ID and a supported type.');
    seen.add(activity.id);
    const letters = text(activity.letters, 2000, 'Letter tiles');
    const tokens = letters ? letters.split(/\s+/) : [];
    if (tokens.length > MAX_TILES || tokens.some(token => cleanTileText(token) !== token)) invalid(`Use up to ${MAX_TILES} space-separated letter tiles.`);
    if (activity.boxes !== undefined && !BOX_COUNTS.includes(activity.boxes)) invalid('Choose no sound boxes, or two to five boxes.');
    if (activity.reviewNextTime !== undefined && typeof activity.reviewNextTime !== 'boolean') invalid('Review next time must be on or off.');
    return {
      id: activity.id, type: activity.type,
      title: text(activity.title, 120, 'Activity title'),
      directions: text(activity.directions, 2000, 'Tutor directions'),
      targets: text(activity.targets, 10000, 'Practice targets'),
      letters: tokens.join(' '), cardIds: ids(activity.cardIds, 32, 'cards'), assetIds: ids(activity.assetIds, MAX_LESSON_ASSETS, 'worksheet pages'),
      boxes: activity.boxes ?? 0, reviewNextTime: activity.reviewNextTime === true,
      reviewNote: text(activity.reviewNote, 1000, 'Review note'),
    };
  });
  return { title, activities };
}

// This is the complete allowlist for public activity material. Never spread the
// private lesson/activity document into a room, page title, cache or student UI.
export function studentProjection(activity) {
  const clean = cleanLessonInput({ title: '', activities: [activity] }).activities[0];
  const projection = { type: clean.type, letters: '', cardIds: [], assetIds: [], boxes: 0 };
  if (clean.type === 'review') Object.assign(projection, { letters: clean.letters, cardIds: clean.cardIds, boxes: clean.boxes });
  else if (clean.type === 'build') Object.assign(projection, { letters: clean.letters, boxes: clean.boxes });
  else if (clean.type === 'dictation') projection.boxes = clean.boxes;
  else if (clean.type === 'read') projection.assetIds = clean.assetIds;
  return projection;
}
