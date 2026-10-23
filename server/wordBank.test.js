import { describe, expect, it } from 'vitest';
import { phonemeSymbols } from '../src/data/phonemeSymbols.js';
import { wordLists } from '../src/data/wordLists.js';
import { WORD_BANK, WORD_LEVELS } from './wordBank.js';

// The display without its reading marks: no brackets, breves or macrons.
const plain = (display) => display.replace(/[[\]]/g, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

describe('the word bank', () => {
  it('spells every word back from its display, using only sounds with pictures', () => {
    for (const { word, phonemes, display } of WORD_BANK) {
      expect(plain(display), word).toBe(word);
      expect(phonemes.length, word).toBeGreaterThan(1);
      for (const sound of phonemes) expect(Object.hasOwn(phonemeSymbols, sound), `${word}: ${sound}`).toBe(true);
    }
  });

  it('has each word once per level, a name for every level, and plenty of words in each', () => {
    const keys = WORD_BANK.map((x) => `${x.level}:${x.word}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const { level, title, examples } of WORD_LEVELS) {
      const words = WORD_BANK.filter((x) => x.level === level).map((x) => x.word);
      expect(title).toBeTruthy();
      expect(words.length).toBeGreaterThanOrEqual(20);
      for (const e of examples) expect(words).toContain(e);
    }
  });

  it('keeps every built-in word as it is, so the game plays the same without the database', () => {
    for (const [level, list] of Object.entries(wordLists)) {
      for (const x of list) expect(WORD_BANK).toContainEqual({ level: Number(level), ...x });
    }
  });
});
