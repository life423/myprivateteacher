import { createHash } from 'node:crypto';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { isLessonId } from '../shared/lessons.js';
import { CONTAINER } from './library.js';

const prefix = (owner, lesson) => {
  if (!isLessonId(owner) || (lesson !== undefined && !isLessonId(lesson))) throw new Error('Invalid private lesson identity.');
  return `private-lessons/${owner}/${lesson === undefined ? '' : `${lesson}/`}`;
};
export function lessonAssetPath(owner, lesson, asset) {
  if (!isLessonId(asset)) throw new Error('Invalid private lesson asset.');
  return `${prefix(owner, lesson)}${asset}`;
}
export function createLessonAssets({ container }) {
  const removePrefix = async path => {
    for await (const blob of container.listBlobsFlat({ prefix: path })) await container.getBlobClient(blob.name).deleteIfExists({ deleteSnapshots: 'include' });
  };
  return {
    async put(owner, lesson, asset, bytes, type) {
      const blob = container.getBlockBlobClient(lessonAssetPath(owner, lesson, asset));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      try {
        await blob.uploadData(bytes, { conditions: { ifNoneMatch: '*' }, metadata: { sha256 }, blobHTTPHeaders: { blobContentType: type } });
      } catch (error) {
        if (![409, 412].includes(error.statusCode)) throw error;
        const existing = await blob.getProperties();
        if (existing.metadata?.sha256 !== sha256) throw Object.assign(new Error('That asset ID already has different image bytes.'), { status: 409 });
      }
    },
    get: (owner, lesson, asset) => container.getBlobClient(lessonAssetPath(owner, lesson, asset)).downloadToBuffer(),
    remove: (owner, lesson, asset) => container.getBlobClient(lessonAssetPath(owner, lesson, asset)).deleteIfExists({ deleteSnapshots: 'include' }),
    removeLesson: (owner, lesson) => removePrefix(prefix(owner, lesson)),
    removeOwner: owner => removePrefix(prefix(owner)),
  };
}
export function connectLessonAssets({ account = process.env.AZURE_STORAGE_ACCOUNT } = {}) {
  if (!account) return null;
  const storage = new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential());
  return createLessonAssets({ container: storage.getContainerClient(CONTAINER) });
}
