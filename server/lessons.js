import { createHash } from 'node:crypto';
import { mongoClient } from './db.js';
import { DATABASE } from './library.js';
import { connectLessonAssets } from './lessonAssets.js';
import { MAX_LESSONS, MAX_LESSON_ASSETS, cleanLessonInput, isLessonId } from '../shared/lessons.js';
import { MAX_PICTURE_BYTES, MAX_PICTURE_SIDE } from '../shared/pieces.js';

export const LESSONS = 'lessons';
export const lessonTemplateCopyId = (owner, templateId) => createHash('sha256').update(`${templateId}\0${owner}`).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const assetView = ({ id, w, h, type, bytes }) => ({ id, w, h, type, bytes });
const milliseconds = value => value instanceof Date ? value.getTime() : value;
const lessonView = doc => ({ id: doc._id, title: doc.title, revision: doc.revision, activities: structuredClone(doc.activities), assets: doc.assets.filter(asset => asset.state === 'ready').map(assetView), createdAt: milliseconds(doc.createdAt), updatedAt: milliseconds(doc.updatedAt) });
// Updated editions keep the original family copy address. This mapping is
// deliberate: arbitrary templates cannot claim another saved lesson's identity.
const familyTemplateId = template => template.schemaVersion === 2 && template.id === 'starter-short-a-amstp-v2' && template.familyId === 'short-a-amstp' && template.edition === 2 && template.supersedes === 'starter-short-a-amstp-v1' ? template.supersedes : template.id;
const originalContent = value => {
  const clean = cleanLessonInput(value);
  return { title: clean.title, activities: clean.activities.map(({ reviewNextTime, reviewNote, ...activity }) => activity) };
};
const untouchedOriginal = (doc, original) => {
  if (!original || doc.sourceTemplate?.id !== original.id || doc.sourceTemplate.sourceHash !== original.sourceHash || JSON.stringify(originalContent(doc)) !== JSON.stringify(originalContent(original)) || doc.assets.length !== original.assets.length) return false;
  return original.assets.every(source => doc.assets.some(asset => asset.state === 'ready' && asset.id === source.id && asset.w === source.w && asset.h === source.h && asset.type === source.type && asset.bytes === source.bytes && asset.sha256 === source.sha256 && asset.origin?.templateId === original.id && asset.origin.assetId === source.id));
};
const readyReferences = (activities, assets) => {
  const ready = new Set(assets.filter(asset => asset.state === 'ready').map(asset => asset.id));
  if (activities.some(activity => activity.assetIds.some(id => !ready.has(id)))) fail(400, 'Choose worksheet pages already uploaded to this lesson.');
};

export function createLessonRepository({ collection, assets, templates, ownerExists = async () => true, now = () => new Date() }) {
  // Live rooms already require one app replica. Serialize account-local persistence
  // here; single-document CAS also protects revisions/asset lists across processes.
  const queues = new Map();
  const serial = (owner, fn) => {
    if (!isLessonId(owner)) return Promise.reject(Object.assign(new Error('Sign in first.'), { status: 401 }));
    const pending = (queues.get(owner) || Promise.resolve()).catch(() => {}).then(fn);
    queues.set(owner, pending);
    return pending.finally(() => { if (queues.get(owner) === pending) queues.delete(owner); });
  };
  const activeOwner = async owner => { if (!(await ownerExists(owner))) fail(403, 'This account is unavailable or being deleted.'); };
  const owned = async (owner, id, deleting = false) => {
    if (!isLessonId(id)) fail(404, 'No such lesson.');
    const doc = await collection.findOne({ _id: id, ownerId: owner });
    if (!doc || (!deleting && doc.deletingAt)) fail(404, 'No such lesson.');
    return doc;
  };
  const updateAssets = async (doc, next) => {
    const result = await collection.findOneAndUpdate({ _id: doc._id, ownerId: doc.ownerId, assetVersion: doc.assetVersion, deletingAt: { $exists: false } }, { $set: { assets: next, updatedAt: now() }, $inc: { assetVersion: 1 } }, { returnDocument: 'after' });
    if (!result) fail(409, 'The lesson changed. Refresh and try again.');
    return result;
  };
  const cleanupUpload = async (owner, id, assetId, sha256, removeBytes) => {
    const doc = await collection.findOne({ _id: id, ownerId: owner });
    const current = doc?.assets.find(asset => asset.id === assetId);
    // A concurrent retry may already have committed this exact immutable source.
    if (current?.state === 'ready' && current.sha256 === sha256 && !doc.deletingAt) return assetView(current);
    if (removeBytes) await assets.remove(owner, id, assetId);
    if (doc && !doc.deletingAt && current?.state === 'pending' && current.sha256 === sha256) await updateAssets(doc, doc.assets.filter(asset => asset.id !== assetId));
    return null;
  };

  return {
    async list(owner) {
      await activeOwner(owner);
      const docs = await collection.find({ ownerId: owner }).limit(MAX_LESSONS).toArray();
      return docs.sort((a, b) => milliseconds(b.updatedAt) - milliseconds(a.updatedAt)).map(doc => ({ id: doc._id, title: doc.title, revision: doc.revision, updatedAt: milliseconds(doc.updatedAt), activityCount: doc.activities.length, reviewCount: doc.activities.filter(activity => activity.reviewNextTime).length, ...(doc.deletingAt ? { deletePending: true } : {}) }));
    },
    create(owner, input) {
      return serial(owner, async () => {
        await activeOwner(owner);
        if (!isLessonId(input?.id)) fail(400, 'A lesson needs a valid ID.');
        const existing = await collection.findOne({ _id: input.id });
        if (existing) { if (existing.ownerId !== owner || existing.deletingAt) fail(404, 'No such lesson.'); return lessonView(existing); }
        const clean = cleanLessonInput(input); readyReferences(clean.activities, []);
        if (await collection.countDocuments({ ownerId: owner }) >= MAX_LESSONS) fail(409, `Keep up to ${MAX_LESSONS} saved lessons. Delete one before adding another.`);
        const doc = { _id: input.id, ownerId: owner, schemaVersion: 1, ...clean, revision: 1, assets: [], assetVersion: 0, createdAt: now(), updatedAt: now() };
        try { await collection.insertOne(doc); }
        catch (error) {
          if (error.code !== 11000) throw error;
          const duplicate = await owned(owner, input.id);
          return lessonView(duplicate);
        }
        if (!(await ownerExists(owner))) { await collection.deleteOne({ _id: doc._id, ownerId: owner }); fail(403, 'This account is unavailable or being deleted.'); }
        return lessonView(doc);
      });
    },
    createFromTemplate(owner, template) {
      return serial(owner, async () => {
        await activeOwner(owner);
        if (!template || !isLessonId(template.id)) fail(404, 'No such premade lesson.');
        const family = familyTemplateId(template), id = lessonTemplateCopyId(owner, family);
        const existing = await collection.findOne({ _id: id });
        if (existing && (existing.ownerId !== owner || existing.deletingAt)) fail(404, 'No such lesson.');
        if (!existing && await collection.countDocuments({ ownerId: owner }) >= MAX_LESSONS) fail(409, `Keep up to ${MAX_LESSONS} saved lessons. Delete one before adding another.`);
        const clean = cleanLessonInput(template);
        if (!Array.isArray(template.assets) || template.assets.length > MAX_LESSON_ASSETS) fail(400, 'This premade lesson has unsupported materials.');
        // A changed edition must not reuse a private asset ID: live lesson
        // material signatures and source caches use these IDs across reloads.
        const privateIds = new Map(template.assets.map(asset => [asset.id, family !== template.id ? `${asset.id}-v2` : asset.id]));
        clean.activities = clean.activities.map(activity => ({ ...activity, assetIds: activity.assetIds.map(assetId => privateIds.get(assetId) || assetId) }));
        const references = template.assets.map(asset => {
          if (!isLessonId(asset.id) || !/^[a-f0-9]{64}$/.test(asset.sha256) || ![asset.w, asset.h].every(side => Number.isInteger(side) && side > 0 && side <= MAX_PICTURE_SIDE) || !Number.isInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > MAX_PICTURE_BYTES || !['image/jpeg', 'image/png', 'image/webp'].includes(asset.type)) fail(400, 'This premade lesson has unsupported materials.');
          return { id: privateIds.get(asset.id), w: asset.w, h: asset.h, type: asset.type, bytes: asset.bytes, sha256: asset.sha256, state: 'ready', origin: { templateId: template.id, assetId: asset.id } };
        });
        readyReferences(clean.activities, references);
        if (existing) {
          // Upgrade only a still-original previous edition. Review observations
          // are private user data, not customization, and follow their stable IDs.
          const previous = family !== template.id && existing.sourceTemplate?.id === family && templates?.get ? await templates.get(family) : null;
          if (!untouchedOriginal(existing, previous) || existing.activities.some(activity => !clean.activities.some(next => next.id === activity.id))) { await activeOwner(owner); return lessonView(existing); }
          const reviews = new Map(existing.activities.map(activity => [activity.id, activity]));
          clean.activities = clean.activities.map(activity => ({ ...activity, reviewNextTime: reviews.get(activity.id)?.reviewNextTime ?? activity.reviewNextTime, reviewNote: reviews.get(activity.id)?.reviewNote ?? activity.reviewNote }));
          await activeOwner(owner);
          const upgraded = await collection.findOneAndUpdate({ _id: id, ownerId: owner, revision: existing.revision, assetVersion: existing.assetVersion, deletingAt: { $exists: false } }, { $set: { ...clean, sourceTemplate: { id: template.id, sourceHash: template.sourceHash }, assets: references, updatedAt: now() }, $inc: { revision: 1, assetVersion: 1 } }, { returnDocument: 'after' });
          // Another process may have saved custom content or uploaded a page
          // while the original was being checked. Return that version untouched.
          const current = upgraded || await owned(owner, id);
          await activeOwner(owner);
          return lessonView(current);
        }
        const doc = { _id: id, ownerId: owner, schemaVersion: 1, ...clean, sourceTemplate: { id: template.id, sourceHash: template.sourceHash }, revision: 1, assets: references, assetVersion: 0, createdAt: now(), updatedAt: now() };
        try { await collection.insertOne(doc); }
        catch (error) { if (error.code !== 11000) throw error; return lessonView(await owned(owner, id)); }
        if (!(await ownerExists(owner))) { await collection.deleteOne({ _id: id, ownerId: owner }); fail(403, 'This account is unavailable or being deleted.'); }
        return lessonView(doc);
      });
    },
    async get(owner, id) { await activeOwner(owner); return lessonView(await owned(owner, id)); },
    save(owner, id, input) {
      return serial(owner, async () => {
        await activeOwner(owner);
        const doc = await owned(owner, id);
        if (!Number.isSafeInteger(input?.revision) || input.revision !== doc.revision) fail(409, 'The lesson changed in another tab. Refresh before saving.');
        const clean = cleanLessonInput(input); readyReferences(clean.activities, doc.assets);
        const saved = await collection.findOneAndUpdate({ _id: id, ownerId: owner, revision: input.revision, deletingAt: { $exists: false } }, { $set: { ...clean, updatedAt: now() }, $inc: { revision: 1 } }, { returnDocument: 'after' });
        if (!saved) fail(409, 'The lesson changed in another tab. Refresh before saving.');
        await activeOwner(owner);
        return lessonView(saved);
      });
    },
    remove(owner, id, revision) {
      return serial(owner, async () => {
        await activeOwner(owner);
        const doc = await owned(owner, id, true);
        if (!Number.isSafeInteger(revision) || revision !== doc.revision) fail(409, 'The lesson changed. Refresh before deleting it.');
        await collection.updateOne({ _id: id, ownerId: owner, revision }, { $set: { deletingAt: doc.deletingAt || now() } });
        await assets.removeLesson(owner, id);
        await collection.deleteOne({ _id: id, ownerId: owner });
      });
    },
    putAsset(owner, id, assetId, image) {
      return serial(owner, async () => {
        await activeOwner(owner);
        let doc = await owned(owner, id);
        if (!isLessonId(assetId)) fail(400, 'Choose a valid worksheet ID.');
        if (!Buffer.isBuffer(image?.bytes) || !image.bytes.length || image.bytes.length > MAX_PICTURE_BYTES) fail(413, 'This worksheet image is too large.');
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type)) fail(415, 'Upload a prepared picture, not the original document.');
        if (![image.w, image.h].every(side => Number.isInteger(side) && side > 0 && side <= MAX_PICTURE_SIDE)) fail(400, 'This worksheet image has an unsupported size.');
        const sha256 = createHash('sha256').update(image.bytes).digest('hex');
        const existing = doc.assets.find(asset => asset.id === assetId);
        if (existing && (existing.sha256 !== sha256 || existing.w !== image.w || existing.h !== image.h || existing.type !== image.type)) fail(409, 'That worksheet ID already contains a different image.');
        if (existing?.state === 'ready') return assetView(existing);
        if (existing?.state === 'deleting') fail(409, 'That worksheet is being removed. Try again shortly.');
        if (!existing && doc.assets.length >= MAX_LESSON_ASSETS) fail(409, `Use up to ${MAX_LESSON_ASSETS} worksheet pages per lesson.`);
        const pending = { id: assetId, w: image.w, h: image.h, type: image.type, bytes: image.bytes.length, sha256, state: 'pending' };
        if (!existing) doc = await updateAssets(doc, [...doc.assets, pending]);
        let uploaded = false;
        try {
          await assets.put(owner, id, assetId, image.bytes, image.type); uploaded = true;
          await activeOwner(owner);
          const current = await owned(owner, id);
          const entry = current.assets.find(asset => asset.id === assetId);
          if (!entry || entry.state === 'deleting' || entry.sha256 !== sha256) fail(409, 'The lesson changed while the worksheet was uploading.');
          if (entry.state === 'ready') return assetView(entry);
          const ready = { ...pending, state: 'ready' };
          await updateAssets(current, current.assets.map(asset => asset.id === assetId ? ready : asset));
          return assetView(ready);
        } catch (error) {
          const recovered = await cleanupUpload(owner, id, assetId, sha256, uploaded || error.status !== 409);
          if (recovered) return recovered;
          throw error;
        }
      });
    },
    async getAsset(owner, id, assetId) {
      await activeOwner(owner);
      const doc = await owned(owner, id);
      const asset = doc.assets.find(asset => asset.id === assetId && asset.state === 'ready');
      if (!asset) fail(404, 'No such worksheet page.');
      let bytes;
      if (asset.origin) {
        const image = templates && await templates.image(asset.origin.templateId, asset.origin.assetId);
        if (!image || image.sha256 !== asset.sha256) fail(503, 'The shared worksheet is temporarily unavailable.');
        bytes = image.data;
      } else bytes = await assets.get(owner, id, assetId);
      await activeOwner(owner);
      return { ...assetView(asset), data: bytes };
    },
    removeAsset(owner, id, assetId) {
      return serial(owner, async () => {
        await activeOwner(owner);
        let doc = await owned(owner, id);
        const asset = doc.assets.find(asset => asset.id === assetId);
        if (!asset) fail(404, 'No such worksheet page.');
        if (doc.activities.some(activity => activity.assetIds.includes(assetId))) fail(409, 'Remove this worksheet from the activities before deleting it.');
        doc = await updateAssets(doc, doc.assets.map(asset => asset.id === assetId ? { ...asset, state: 'deleting' } : asset));
        if (!asset.origin) await assets.remove(owner, id, assetId);
        await updateAssets(doc, doc.assets.filter(asset => asset.id !== assetId));
      });
    },
    deleteOwner(owner) {
      return serial(owner, async () => {
        await collection.updateMany({ ownerId: owner }, { $set: { deletingAt: now() } });
        await assets.removeOwner(owner);
        await collection.deleteMany({ ownerId: owner });
      });
    },
  };
}

export function connectLessons({ uri = process.env.MONGODB_URI, account = process.env.AZURE_STORAGE_ACCOUNT, ownerExists, templates } = {}) {
  if (!uri || !account) return null;
  return createLessonRepository({ collection: mongoClient(uri).db(DATABASE).collection(LESSONS), assets: connectLessonAssets({ account }), ownerExists, templates });
}
