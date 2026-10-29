import { afterEach, describe, expect, it, vi } from 'vitest';
import { LessonError, createLesson, deleteLesson, getLesson, lessonAssetUrl, listLessons, saveLesson, uploadLessonAsset } from './api.js';
afterEach(() => vi.unstubAllGlobals());
const reply = (data, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
describe('private saved lesson requests', () => {
  it('sends the captured document revision with explicit same-origin credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ lesson: { id: 'lesson-a', revision: 4 } })); vi.stubGlobal('fetch', fetcher);
    const document = { revision: 3, title: 'Private plan', activities: [] };
    expect(await saveLesson('lesson-a', document)).toEqual({ id: 'lesson-a', revision: 4 });
    expect(fetcher).toHaveBeenCalledWith('/api/lessons/lesson-a', expect.objectContaining({ credentials: 'same-origin', method: 'PUT', body: JSON.stringify(document) }));
  });
  it('preserves retry IDs on creation and sends revision-aware deletion', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ lesson: { id: 'stable-id' } })); vi.stubGlobal('fetch', fetcher);
    const draft = { id: 'stable-id', title: 'Plan', activities: [] };
    await createLesson(draft); await createLesson(draft); await deleteLesson('stable-id', 7);
    expect(fetcher.mock.calls.slice(0, 2).map(([, options]) => JSON.parse(options.body).id)).toEqual(['stable-id', 'stable-id']);
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ revision: 7 });
  });
  it('keeps raw image bytes separate from document revisions and encodes resource IDs', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ asset: { id: 'image-1', w: 20, h: 30 } })); vi.stubGlobal('fetch', fetcher);
    const blob = new Blob(['image'], { type: 'image/png' });
    expect(await uploadLessonAsset('lesson-a', 'image-1', { blob, w: 20, h: 30 })).toEqual({ id: 'image-1', w: 20, h: 30 });
    expect(fetcher).toHaveBeenCalledWith('/api/lessons/lesson-a/assets/image-1?w=20&h=30', expect.objectContaining({ body: blob, headers: { 'Content-Type': 'image/png' } }));
    expect(lessonAssetUrl('a/b', 'x?')).toBe('/api/lessons/a%2Fb/assets/x%3F');
  });
  it('returns typed 401/409 failures instead of treating them as empty saved lessons', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({}, 401)).mockResolvedValueOnce(reply({ error: 'Reload the latest revision.' }, 409)); vi.stubGlobal('fetch', fetcher);
    await expect(listLessons()).rejects.toMatchObject({ name: 'LessonError', status: 401 });
    await expect(getLesson('lesson-a')).rejects.toMatchObject({ status: 409, message: 'Reload the latest revision.' });
  });
  it('preserves cancellation and gives a recoverable error for network failures', async () => {
    const cancellation = new DOMException('Canceled', 'AbortError'); vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(cancellation).mockRejectedValueOnce(new Error('offline')));
    await expect(getLesson('lesson-a')).rejects.toBe(cancellation);
    await expect(getLesson('lesson-a')).rejects.toBeInstanceOf(LessonError);
  });
});
