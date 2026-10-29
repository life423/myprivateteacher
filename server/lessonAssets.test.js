import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createLessonAssets, lessonAssetPath } from './lessonAssets.js';

describe('private lesson Blob adapter', () => {
  it('computes isolated paths and refuses path traversal', () => {
    expect(lessonAssetPath('owner-1', 'lesson-1', 'asset-1')).toBe('private-lessons/owner-1/lesson-1/asset-1');
    expect(() => lessonAssetPath('../owner', 'lesson-1', 'asset-1')).toThrow();
    expect(() => lessonAssetPath('owner-1', 'lesson-1', '../../pictures')).toThrow();
  });
  it('uploads immutably and accepts only identical bytes after an uncertain retry', async () => {
    const bytes = Buffer.from('prepared image'), hash = createHash('sha256').update(bytes).digest('hex');
    const blob = { uploadData: vi.fn(async () => { throw { statusCode: 412 }; }), getProperties: vi.fn(async () => ({ metadata: { sha256: hash } })) };
    const container = { getBlockBlobClient: vi.fn(() => blob) };
    const store = createLessonAssets({ container });
    await store.put('owner-1', 'lesson-1', 'asset-1', bytes, 'image/png');
    expect(blob.uploadData).toHaveBeenCalledWith(bytes, expect.objectContaining({ conditions: { ifNoneMatch: '*' }, metadata: { sha256: hash }, blobHTTPHeaders: { blobContentType: 'image/png' } }));
    blob.getProperties.mockResolvedValue({ metadata: { sha256: 'other' } });
    await expect(store.put('owner-1', 'lesson-1', 'asset-1', bytes, 'image/png')).rejects.toMatchObject({ status: 409 });
  });
  it('deletes only the selected owner or lesson prefix, leaving the shared card catalog alone', async () => {
    const removed = [];
    const container = {
      listBlobsFlat: vi.fn(({ prefix }) => (async function* () { for (const name of ['pictures/shared/original.jpg', 'private-lessons/owner-1/lesson-1/a', 'private-lessons/owner-1/lesson-2/b', 'private-lessons/owner-2/lesson-1/c']) if (name.startsWith(prefix)) yield { name }; })()),
      getBlobClient: name => ({ deleteIfExists: async () => { removed.push(name); } }),
    };
    const store = createLessonAssets({ container });
    await store.removeLesson('owner-1', 'lesson-1');
    expect(removed).toEqual(['private-lessons/owner-1/lesson-1/a']);
    removed.length = 0;
    await store.removeOwner('owner-1');
    expect(removed).toEqual(['private-lessons/owner-1/lesson-1/a', 'private-lessons/owner-1/lesson-2/b']);
    expect(removed).not.toContain('pictures/shared/original.jpg');
  });
});
