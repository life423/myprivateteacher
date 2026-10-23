import { mongoClient } from './db.js';
import { WORD_BANK, WORD_LEVELS } from './wordBank.js';

const CACHE_MS = 60 * 1000;

// The Phoneme Pop word bank, kept in the database so it can grow without a code change. At start
// the server adds any starting words (wordBank.js) the database lacks; words already there are
// left as they are. Words with active: false are kept but not played.
export function connectWords({ uri = process.env.MONGODB_URI } = {}) {
  if (!uri) return null;
  const db = mongoClient(uri).db('myprivateteacher');
  const words = db.collection('words');
  const levels = db.collection('word_levels');

  const seeded = (async () => {
    try {
      await levels.bulkWrite(
        WORD_LEVELS.map(({ level, title, examples }) => ({
          updateOne: { filter: { _id: level }, update: { $setOnInsert: { title, examples } }, upsert: true },
        })),
        { ordered: false },
      );
      await words.bulkWrite(
        WORD_BANK.map(({ level, word, phonemes, display }, order) => ({
          updateOne: {
            filter: { _id: `${level}:${word}` },
            update: { $setOnInsert: { level, word, phonemes, display, order, active: true, addedAt: new Date() } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    } catch (error) {
      console.error('Word bank seeding failed:', error.message);
    }
  })();

  let cache = null;
  return {
    seeded,
    // Every level with words, and its words in order: { levels: [{ level, title, examples, count }], words: { [level]: [...] } }.
    async bank() {
      if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
      await seeded;
      const [levelDocs, wordDocs] = await Promise.all([levels.find({}).toArray(), words.find({ active: { $ne: false } }).toArray()]);
      const lists = {};
      for (const x of wordDocs.sort((a, b) => a.level - b.level || (a.order ?? 0) - (b.order ?? 0))) {
        (lists[x.level] ||= []).push({ word: x.word, phonemes: x.phonemes, display: x.display });
      }
      const value = {
        levels: levelDocs
          .filter((l) => lists[l._id]?.length)
          .sort((a, b) => a._id - b._id)
          .map((l) => ({ level: l._id, title: l.title, examples: l.examples || [], count: lists[l._id].length })),
        words: lists,
      };
      cache = { at: Date.now(), value };
      return value;
    },
  };
}
