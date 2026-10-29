// In-memory adapters for isolated API/browser regression fixtures. Production
// code imports the repository and Azure adapter directly, never this fixture.
import { createLessonRepository } from './lessons.js';
import { createLessonTemplates } from './lessonTemplates.js';
const clone = value => value === undefined ? undefined : structuredClone(value);
const matches = (doc, query) => Object.entries(query).every(([key, expected]) => expected && typeof expected === 'object' && '$exists' in expected ? Object.hasOwn(doc, key) === expected.$exists : doc[key] === expected);
export function memoryLessonCollection() {
  const records = new Map();
  const apply = (doc, update) => {
    Object.assign(doc, clone(update.$set || {}));
    for (const [key, value] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + value;
    return doc;
  };
  return {
    records,
    async findOne(query) { return clone([...records.values()].find(doc => matches(doc, query)) || null); },
    find(query) {
      let limit = Infinity;
      const cursor = { limit(value) { limit = value; return cursor; }, async toArray() { return [...records.values()].filter(doc => matches(doc, query)).slice(0, limit).map(clone); } };
      return cursor;
    },
    async countDocuments(query) { return [...records.values()].filter(doc => matches(doc, query)).length; },
    async insertOne(doc) { if (records.has(doc._id)) throw Object.assign(new Error('Duplicate id'), { code: 11000 }); records.set(doc._id, clone(doc)); return { insertedId: doc._id }; },
    async findOneAndUpdate(query, update) { const doc = [...records.values()].find(doc => matches(doc, query)); return doc ? clone(apply(doc, update)) : null; },
    async updateOne(query, update) { const doc = [...records.values()].find(doc => matches(doc, query)); if (doc) apply(doc, update); return { matchedCount: doc ? 1 : 0 }; },
    async updateMany(query, update) { const docs = [...records.values()].filter(doc => matches(doc, query)); docs.forEach(doc => apply(doc, update)); return { matchedCount: docs.length }; },
    async deleteOne(query) { const doc = [...records.values()].find(doc => matches(doc, query)); return { deletedCount: doc && records.delete(doc._id) ? 1 : 0 }; },
    async deleteMany(query) { const docs = [...records.values()].filter(doc => matches(doc, query)); docs.forEach(doc => records.delete(doc._id)); return { deletedCount: docs.length }; },
  };
}
export function memoryLessonAssets() {
  const records = new Map(), key = (owner, lesson, asset) => `${owner}/${lesson}/${asset}`;
  return {
    records,
    async put(owner, lesson, asset, bytes) { records.set(key(owner, lesson, asset), Buffer.from(bytes)); },
    async get(owner, lesson, asset) { const bytes = records.get(key(owner, lesson, asset)); if (!bytes) throw new Error('Missing fixture asset'); return Buffer.from(bytes); },
    async remove(owner, lesson, asset) { records.delete(key(owner, lesson, asset)); },
    async removeLesson(owner, lesson) { for (const path of records.keys()) if (path.startsWith(`${owner}/${lesson}/`)) records.delete(path); },
    async removeOwner(owner) { for (const path of records.keys()) if (path.startsWith(`${owner}/`)) records.delete(path); },
  };
}
export function memoryLessons(options = {}) {
  const collection = memoryLessonCollection(), assets = memoryLessonAssets();
  return { lessons: createLessonRepository({ collection, assets, ...options }), collection, assets };
}

export function memoryLessonTemplates() {
  const collection = memoryLessonCollection(), records = new Map();
  const assets = {
    records,
    async put(id, hash, bytes) { records.set(`${id}/${hash}`, Buffer.from(bytes)); },
    async get(id, hash) { const bytes = records.get(`${id}/${hash}`); if (!bytes) throw new Error('Missing fixture template asset'); return Buffer.from(bytes); },
  };
  return { templates: createLessonTemplates({ collection, assets }), collection, assets };
}
