// Preparation documents and worksheet bytes are tutor-private, same-origin requests.
export class LessonError extends Error {
  constructor(message, status = 0, code = null) { super(message); this.name = 'LessonError'; this.status = status; this.code = code; }
}
const required = (data, key, valid) => { if (!valid(data?.[key])) throw new LessonError('The server returned an incomplete reply. Please try again.'); return data[key]; };
const documentReply = (data) => required(data, 'lesson', (lesson) => lesson && typeof lesson.id === 'string');
const segment = (value) => encodeURIComponent(String(value));
async function requestJson(url, { signal, headers, ...options } = {}) {
  let response;
  try { response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, signal, headers }); }
  catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new LessonError('Could not connect. Your changes are still here. Please try again.');
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message = response.status === 401 ? 'Sign in again to continue. Your changes are still here.'
      : response.status === 404 ? 'This lesson could not be found, or it belongs to another account.'
        : response.status === 409 ? data?.error || 'This lesson changed elsewhere. Reload the latest version before saving.'
          : response.status === 503 ? 'Lesson storage is temporarily unavailable. Your changes are still here. Please try again.'
            : data?.error || 'This request could not be completed. Please try again.';
    throw new LessonError(message, response.status, data?.code || data?.reason || null);
  }
  if (data === null && response.status !== 204) throw new LessonError('The server returned an incomplete reply. Please try again.', response.status);
  return data;
}
export const lessonRequest = (path = '', options) => requestJson(`/api/lessons${path}`, options);
export const listLessonTemplates = async (options) => required(await requestJson('/api/lesson-templates', options), 'templates', Array.isArray);
export const createLessonFromTemplate = async (id, options) => documentReply(await lessonRequest(`/from-template/${segment(id)}`, { ...options, method: 'POST' }));
const json = (method, body, options) => ({ ...options, method, headers: { 'Content-Type': 'application/json', ...options?.headers }, body: JSON.stringify(body) });
export const listLessons = async (options) => required(await lessonRequest('', options), 'lessons', Array.isArray);
export const getLesson = async (id, options) => documentReply(await lessonRequest(`/${segment(id)}`, options));
export const createLesson = async (document, options) => documentReply(await lessonRequest('', json('POST', document, options)));
export const saveLesson = async (id, document, options) => documentReply(await lessonRequest(`/${segment(id)}`, json('PUT', document, options)));
export const deleteLesson = (id, revision, options) => lessonRequest(`/${segment(id)}`, json('DELETE', { revision }, options));
export const getLessonCatalog = async (options) => required(await lessonRequest('/catalog', options), 'cards', Array.isArray);
export const lessonCardUrl = (id) => `/api/lessons/catalog/${segment(id)}/image`;
export const lessonAssetUrl = (lessonId, assetId) => `/api/lessons/${segment(lessonId)}/assets/${segment(assetId)}`;
export const deleteLessonAsset = (lessonId, assetId, options) => lessonRequest(`/${segment(lessonId)}/assets/${segment(assetId)}`, { ...options, method: 'DELETE' });
export const uploadLessonAsset = async (lessonId, assetId, { blob, w, h }, options) => required(await lessonRequest(`/${segment(lessonId)}/assets/${segment(assetId)}?w=${w}&h=${h}`, {
  ...options, method: 'POST', headers: { 'Content-Type': blob.type, ...options?.headers }, body: blob,
}), 'asset', (asset) => asset && typeof asset.id === 'string' && Number.isInteger(asset.w) && Number.isInteger(asset.h));
