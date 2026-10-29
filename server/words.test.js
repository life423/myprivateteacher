import { isDeepStrictEqual } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ mongoClient: vi.fn() }));
vi.mock('./db.js', () => ({ mongoClient: mocked.mongoClient }));

import { connectWords } from './words.js';

const OLD_SEEDS = [
  { _id: '1:box', level: 1, word: 'box', phonemes: ['b', 'ŏ', 'x'], display: 'bŏx', active: true },
  { _id: '1:fox', level: 1, word: 'fox', phonemes: ['f', 'ŏ', 'x'], display: 'fŏx', active: true },
  { _id: '2:pink', level: 2, word: 'pink', phonemes: ['p', 'ĭ', 'nk'], display: 'pĭ[nk]', active: true },
  { _id: '2:bank', level: 2, word: 'bank', phonemes: ['b', 'ă', 'nk'], display: 'bă[nk]', active: true },
  { _id: '3:think', level: 3, word: 'think', phonemes: ['th', 'ĭ', 'nk'], display: '[th]ĭ[nk]', active: true },
];

// A narrow Mongo fixture: equality filters include exact arrays (order and
// length), and $setOnInsert never changes an existing document.
const matches = (doc, filter) => Object.entries(filter).every(([key, value]) =>
  value && typeof value === 'object' && '$ne' in value ? !isDeepStrictEqual(doc[key], value.$ne) : isDeepStrictEqual(doc[key], value));

function collection(initial = []) {
  const docs = structuredClone(initial);
  return {
    docs,
    bulkWrite: vi.fn(async (operations) => {
      let matchedCount = 0, modifiedCount = 0, upsertedCount = 0;
      for (const { updateOne: { filter, update, upsert } } of operations) {
        const doc = docs.find((candidate) => matches(candidate, filter));
        if (doc) {
          matchedCount++;
          if (update.$set && !matches(doc, update.$set)) modifiedCount++;
          Object.assign(doc, structuredClone(update.$set || {}));
        } else if (upsert) {
          docs.push(structuredClone({ ...filter, ...update.$setOnInsert, ...update.$set }));
          upsertedCount++;
        }
      }
      return { matchedCount, modifiedCount, upsertedCount };
    }),
    find: (filter = {}) => ({ toArray: async () => structuredClone(docs.filter((doc) => matches(doc, filter))) }),
  };
}

function fixture(initial) {
  const words = collection(initial);
  const levels = collection();
  mocked.mongoClient.mockReturnValue({ db: () => ({ collection: (name) => name === 'words' ? words : levels }) });
  return { words, levels };
}

beforeEach(() => mocked.mongoClient.mockReset());

describe('reviewed legacy word corrections during seeding', () => {
  it('corrects the five exact active seeds before serving the bank, preserving unrelated metadata', async () => {
    const initial = OLD_SEEDS.map((doc, index) => ({ ...doc, order: 500 + index, note: 'Tutor note', addedAt: new Date('2025-01-01'), extra: { keep: true } }));
    const { words } = fixture(initial);
    const store = connectWords({ uri: 'mongodb://fixture' });
    await store.seeded;
    const bank = await store.bank();
    const expected = [
      { phonemes: ['b', 'ŏ', 'k', 's'], display: 'bŏx' },
      { phonemes: ['f', 'ŏ', 'k', 's'], display: 'fŏx' },
      { phonemes: ['p', 'ĭ', 'ng', 'k'], display: 'pĭnk' },
      { phonemes: ['b', 'ă', 'ng', 'k'], display: 'bănk' },
      { phonemes: ['th', 'ĭ', 'ng', 'k'], display: '[th]ĭnk' },
    ];
    for (const [index, before] of initial.entries()) {
      expect(words.docs.find((doc) => doc._id === before._id)).toEqual({ ...before, ...expected[index] });
      expect(bank.words[before.level].find((doc) => doc.word === before.word)).toEqual({ word: before.word, ...expected[index] });
    }
    expect(await words.bulkWrite.mock.results.at(-1).value).toMatchObject({ matchedCount: 5, modifiedCount: 5, upsertedCount: 0 });
  });

  it.each([
    ['custom id', { _id: 'tutor:box' }],
    ['changed level', { level: 7 }],
    ['changed word', { word: 'boxes' }],
    ['changed phonemes', { phonemes: ['b', 'ŏ', 'ks'] }],
    ['reordered phonemes', { phonemes: ['b', 'x', 'ŏ'] }],
    ['longer phoneme array', { phonemes: ['b', 'ŏ', 'x', 's'] }],
    ['changed display', { display: 'box' }],
    ['inactive record', { active: false }],
    ['missing active state', { active: undefined }],
  ])('preserves a %s', async (_label, changes) => {
    const before = { ...structuredClone(OLD_SEEDS[0]), ...changes, order: 999, note: 'Custom' };
    const { words } = fixture([before]);
    await connectWords({ uri: 'mongodb://fixture' }).seeded;
    expect(words.docs.find((doc) => doc._id === before._id)).toEqual(before);
    expect(await words.bulkWrite.mock.results.at(-1).value).toMatchObject({ matchedCount: 0, modifiedCount: 0, upsertedCount: 0 });
  });

  it('is idempotent and never creates missing records during the correction pass', async () => {
    const { words } = fixture(OLD_SEEDS);
    await connectWords({ uri: 'mongodb://fixture' }).seeded;
    const after = structuredClone(words.docs);
    await connectWords({ uri: 'mongodb://fixture' }).seeded;
    expect(words.docs).toEqual(after);
    expect(await words.bulkWrite.mock.results.at(-1).value).toEqual({ matchedCount: 0, modifiedCount: 0, upsertedCount: 0 });
    const correctionPass = words.bulkWrite.mock.calls.at(-1)[0];
    expect(correctionPass).toHaveLength(5);
    for (const { updateOne } of correctionPass) expect(updateOne.upsert).toBe(false);
  });

  it('leaves an unconfigured word bank disabled', () => {
    expect(connectWords({ uri: '' })).toBeNull();
    expect(mocked.mongoClient).not.toHaveBeenCalled();
  });
});
