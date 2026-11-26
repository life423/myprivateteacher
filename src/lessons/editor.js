import { MAX_LESSON_ACTIVITIES, MAX_LESSON_ASSETS } from '../../shared/lessons.js';
export const ACTIVITY_TYPES = {
  review: { title: 'Review', description: 'Practise familiar sounds with letter tiles and optional mouth pictures.' },
  build: { title: 'Build words', description: 'Let your student move letter tiles into sound boxes to build words you say.' },
  dictation: { title: 'Dictation', description: 'Read a word or sentence aloud while your student writes it on the board.' },
  read: { title: 'Read', description: 'Choose words or pictures from your worksheet to share on the board.' },
};
export const MAX_ACTIVITIES = MAX_LESSON_ACTIVITIES;
export const MAX_ASSETS = MAX_LESSON_ASSETS;
const copy = (value) => JSON.parse(JSON.stringify(value));
export function activity(type, id = crypto.randomUUID()) {
  return { id, type, title: ACTIVITY_TYPES[type].title, directions: '', targets: '', letters: '', cardIds: [], assetIds: [], marks: [], boxes: 0, reviewNextTime: false, reviewNote: '' };
}
export const editableLesson = (lesson) => ({ title: lesson.title, activities: copy(lesson.activities || []).map(item => ({ ...item, marks: item.marks || [] })) });
export const fingerprint = (document) => JSON.stringify(editableLesson(document));
export function loadedEditor(lesson) {
  const draft = editableLesson(lesson);
  return { lesson, draft, baseline: fingerprint(draft), version: 0 };
}
export function editDraft(state, transform) {
  return { ...state, draft: transform(state.draft), version: state.version + 1 };
}
// A save acknowledges its own snapshot, not edits typed while the request was in flight.
export function acknowledgeSave(state, sent, saved) {
  const unchanged = state.version === sent.version;
  const assets = new Map((saved.assets || []).map((asset) => [asset.id, asset]));
  for (const asset of state.lesson.assets || []) if (!assets.has(asset.id)) assets.set(asset.id, asset);
  return { ...state, lesson: { ...saved, assets: [...assets.values()] },
    draft: unchanged ? editableLesson(saved) : state.draft,
    baseline: unchanged ? fingerprint(saved) : fingerprint(sent.draft) };
}
export const isDirty = (state) => Boolean(state && fingerprint(state.draft) !== state.baseline);
export function moveActivity(activities, id, direction) {
  const from = activities.findIndex((item) => item.id === id), to = from + direction;
  if (from < 0 || to < 0 || to >= activities.length) return activities;
  const next = [...activities]; [next[from], next[to]] = [next[to], next[from]]; return next;
}
export function attachAsset(state, activityId, asset) {
  if (!state.draft.activities.some((item) => item.id === activityId)) return state;
  const assets = [...(state.lesson.assets || []).filter((item) => item.id !== asset.id), asset];
  return { ...editDraft(state, (draft) => ({ ...draft, activities: draft.activities.map((item) => item.id === activityId
    ? { ...item, assetIds: [...new Set([...item.assetIds, asset.id])] } : item) })), lesson: { ...state.lesson, assets } };
}
