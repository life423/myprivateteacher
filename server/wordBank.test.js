import { describe, expect, it } from 'vitest';
import { phonemeSymbols } from '../src/phoneme-pop/data/phonemeSymbols.js';
import { wordLists } from '../src/phoneme-pop/data/wordLists.js';
import { WORD_BANK, WORD_LEVELS } from './wordBank.js';
import { checkAnswer, makeTiles } from '../src/phoneme-pop/game/logic.js';
import { REVIEWED_WORD_CORRECTIONS } from './wordCorrections.js';

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

  it.each([
    [1, 'box', ['b', 'ŏ', 'k', 's'], 'bŏx'],
    [1, 'fox', ['f', 'ŏ', 'k', 's'], 'fŏx'],
    [2, 'pink', ['p', 'ĭ', 'ng', 'k'], 'pĭnk'],
    [2, 'bank', ['b', 'ă', 'ng', 'k'], 'bănk'],
    [3, 'think', ['th', 'ĭ', 'ng', 'k'], '[th]ĭnk'],
  ])('represents %s:%s with four ordered sounds while preserving its spelling', (level, word, phonemes, display) => {
    const entry = WORD_BANK.find((item) => item.level === level && item.word === word);
    expect(entry).toEqual({ level, word, phonemes, display });
    expect(plain(display)).toBe(word);
    const tiles = makeTiles(entry);
    expect(tiles).toHaveLength(4);
    expect(new Set(tiles.map((tile) => tile.id)).size).toBe(4);
    expect(checkAnswer(tiles.slice(0, 3), entry)).toBe('incomplete');
    expect(checkAnswer([tiles[0], tiles[1], tiles[3], tiles[2]], entry)).toBe('wrong-order');
    expect(checkAnswer(tiles, entry)).toBe('correct');
  });

  it('keeps one-phoneme digraphs whole and excludes reviewed composite tokens', () => {
    const ship = WORD_BANK.find((entry) => entry.word === 'ship');
    expect(ship.phonemes).toEqual(['sh', 'ĭ', 'p']);
    expect(makeTiles(ship)).toHaveLength(3);
    for (const { word, phonemes } of WORD_BANK) {
      expect(phonemes, word).not.toContain('x');
      expect(phonemes, word).not.toContain('nk');
    }
    for (const entries of Object.values(wordLists)) for (const { word, phonemes } of entries) {
      expect(phonemes, word).not.toContain('x');
      expect(phonemes, word).not.toContain('nk');
    }
  });

  it('keeps the reviewed database corrections in sync with the seed', () => {
    expect(REVIEWED_WORD_CORRECTIONS).toHaveLength(5);
    for (const { level, word, after } of REVIEWED_WORD_CORRECTIONS) {
      expect(WORD_BANK.find((entry) => entry.level === level && entry.word === word)).toEqual({ level, word, ...after });
    }
  });
});
