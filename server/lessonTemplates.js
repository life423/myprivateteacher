import express from 'express';
import { createHash } from 'node:crypto';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { mongoClient } from './db.js';
import { DATABASE, CONTAINER } from './library.js';
import { cleanLessonInput, isLessonId } from '../shared/lessons.js';
import { validateStarterTemplate } from './starterLesson.js';

export const LESSON_TEMPLATES = 'lesson_templates';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw Object.assign(new Error(message), { templateMessage: true, status: 409 }); };
export function templateAssetPath(id, sourceHash) {
  if (!isLessonId(id) || !/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error('Invalid immutable template source.');
  return `lesson-templates/${id}/${sourceHash}`;
}
export function createTemplateAssets({ container }) {
  return {
    async put(id, sourceHash, bytes, type) {
      const blob = container.getBlockBlobClient(templateAssetPath(id, sourceHash));
      try { await blob.uploadData(bytes, { conditions: { ifNoneMatch: '*' }, metadata: { sha256: sourceHash }, blobHTTPHeaders: { blobContentType: type } }); }
      catch (error) {
        if (![409, 412].includes(error.statusCode)) throw error;
        const stored = await blob.downloadToBuffer();
        if ((await blob.getProperties()).metadata?.sha256 !== sourceHash || !Buffer.isBuffer(stored) || stored.length !== bytes.length || hash(stored) !== sourceHash) fail('An immutable template image differs; it was left unchanged.');
      }
    },
    get: (id, sourceHash) => container.getBlobClient(templateAssetPath(id, sourceHash)).downloadToBuffer(),
    // No deletion method: private-copy/account cleanup must not reach shared sources.
  };
}
const contentOf = doc => ({
  id: doc._id ?? doc.id, schemaVersion: doc.schemaVersion ?? 1,
  ...(doc.schemaVersion === 2 ? { familyId: doc.familyId, edition: doc.edition, supersedes: doc.supersedes } : {}),
  title: doc.title, description: doc.description, knownLetters: doc.knownLetters,
  wordChain: doc.wordChain, readingLines: doc.readingLines,
  activities: cleanLessonInput(doc).activities,
  assets: doc.assets.map(({ id, w, h, type, bytes, sha256, purpose, renderHash }) => ({ id, w, h, type, bytes, sha256, ...(doc.schemaVersion === 2 ? { purpose, renderHash } : {}) })),
});
const checkedContent = doc => {
  let content;
  try { content = contentOf(doc); } catch { throw new Error('Template metadata verification failed.'); }
  if (![1, 2].includes(doc.schemaVersion) || doc.schemaVersion === 2 && (doc._id !== 'starter-short-a-amstp-v2' || doc.familyId !== 'short-a-amstp' || doc.edition !== 2 || doc.supersedes !== 'starter-short-a-amstp-v1') || !/^[a-f0-9]{64}$/.test(doc.sourceHash) || hash(JSON.stringify(content)) !== doc.sourceHash) throw new Error('Template metadata verification failed.');
  return content;
};
const templateView = doc => ({ ...checkedContent(doc), sourceHash: doc.sourceHash });
const summary = doc => {
  const content = checkedContent(doc);
  return { id: content.id, title: content.title, description: content.description, knownLetters: [...content.knownLetters], activityCount: content.activities.length };
};

export function createLessonTemplates({ collection, assets, now = () => new Date() }) {
  const find = async id => isLessonId(id) ? collection.findOne({ _id: id }) : null;
  const readImage = async (id, asset) => {
    const bytes = await assets.get(id, asset.sha256);
    if (!Buffer.isBuffer(bytes) || bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) throw new Error('Template source verification failed.');
    return bytes;
  };
  const verify = async (doc, expected) => {
    try {
      if (hash(JSON.stringify(checkedContent(doc))) !== hash(JSON.stringify(expected))) return false;
      for (const asset of doc.assets) await readImage(doc._id, asset);
      return true;
    } catch { return false; }
  };
  return {
    async list() {
      // Resolve supersession before limiting visible cards; archived originals
      // remain addressable by old private copies, never edited or deleted.
      const docs = await collection.find({}).limit(1001).toArray();
      if (docs.length > 1000) throw new Error('Template catalog is too large.');
      const reviewed = docs.map(doc => ({ doc, content: checkedContent(doc) }));
      const superseded = new Set(reviewed.map(item => item.content.supersedes).filter(Boolean));
      return reviewed.filter(item => !superseded.has(item.content.id)).map(item => summary(item.doc)).sort((a, b) => a.title.localeCompare(b.title)).slice(0, 100);
    },
    async get(id) { const doc = await find(id); return doc ? templateView(doc) : null; },
    async image(id, assetId) {
      const doc = await find(id);
      if (!doc) return null;
      const asset = checkedContent(doc).assets.find(item => item.id === assetId);
      if (!asset) return null;
      const data = await readImage(id, asset);
      return { id: asset.id, w: asset.w, h: asset.h, type: asset.type, bytes: asset.bytes, sha256: asset.sha256, data };
    },
    async publish(template, imageBytes) {
      // This is called only by the explicit publisher CLI, never an HTTP route.
      const validated = validateStarterTemplate(template, imageBytes);
      if (typeof template.description !== 'string' || template.description.length > 1000) fail('The original template needs a bounded description.');
      const expected = contentOf({ id: template.id, schemaVersion: template.schemaVersion, ...(template.schemaVersion === 2 ? { familyId: template.familyId, edition: template.edition, supersedes: template.supersedes } : {}), ...validated.content, description: template.description.trim(), knownLetters: [...template.knownLetters], wordChain: [...template.wordChain], readingLines: [...template.readingLines], assets: validated.assets });
      const sourceHash = hash(JSON.stringify(expected));
      const existing = await find(template.id);
      if (existing) {
        if (!(await verify(existing, expected))) fail('An existing template version differs; publish a new version ID instead.');
        return { id: template.id, title: expected.title, status: 'existing' };
      }
      for (const asset of expected.assets) {
        await assets.put(template.id, asset.sha256, validated.assets.find(source => source.id === asset.id).data, asset.type);
        // Do not make a catalog entry/copy available until the immutable source
        // has been read back and verified, including an orphan left by a retry.
        await readImage(template.id, asset);
      }
      const doc = { ...expected, _id: template.id, sourceHash, createdAt: now() };
      delete doc.id;
      try { await collection.insertOne(doc); }
      catch (error) {
        if (error.code !== 11000) throw error;
        if (!(await verify(await find(template.id), expected))) fail('An existing template version differs; it was left unchanged.');
        return { id: template.id, title: expected.title, status: 'existing' };
      }
      if (!(await verify(await find(template.id), expected))) fail('The published template could not be verified.');
      return { id: template.id, title: expected.title, status: 'published' };
    },
  };
}
export function connectLessonTemplates({ uri = process.env.MONGODB_URI, account = process.env.AZURE_STORAGE_ACCOUNT } = {}) {
  if (!uri || !account) return null;
  const container = new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential()).getContainerClient(CONTAINER);
  return createLessonTemplates({ collection: mongoClient(uri).db(DATABASE).collection(LESSON_TEMPLATES), assets: createTemplateAssets({ container }) });
}
export function templateRoutes({ templates, currentTutor }) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return res.set('Allow', 'GET, HEAD').status(405).json({ error: 'Premade lessons are read only.' });
    if (!templates) return res.status(503).json({ error: 'Premade lessons are not available right now.' });
    res.set('Cache-Control', 'public, max-age=300');
    next();
  });
  const read = fn => async (req, res) => {
    try { await fn(req, res); }
    catch { res.set('Cache-Control', 'no-store').status(503).json({ error: 'Premade lessons are temporarily unavailable.' }); }
  };
  router.get('/', read(async (_req, res) => res.json({ templates: await templates.list() })));
  router.get('/:id/assets/:assetId/image', read(async (req, res) => {
    const image = await templates.image(req.params.id, req.params.assetId);
    if (!image) return res.status(404).json({ error: 'No such lesson image.' });
    res.set({ 'Content-Type': image.type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }).send(image.data);
  }));
  router.get('/:id', read(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!currentTutor || !(await currentTutor(req))) return res.status(401).json({ error: 'Sign in to read the teaching plan.' });
    const template = await templates.get(req.params.id);
    res.status(template ? 200 : 404).json(template ? { template } : { error: 'No such premade lesson.' });
  }));
  return router;
}
