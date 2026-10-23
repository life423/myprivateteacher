import { describe, expect, it } from 'vitest';
import { wordLists } from '../data/wordLists.js';
import { checkAnswer, makeTiles, pickNextWord, shuffleTiles } from './logic.js';

const solvedAll = (level) => new Set(wordLists[level].map((w) => w.word));
const sounds = (tiles) => tiles.map((t) => t.sound).join('|');

describe('shuffleTiles', () => {
  it('never hands back the sounds already in order', () => {
    for (const word of Object.values(wordLists).flat()) {
      const tiles = makeTiles(word);
      for (let i = 0; i < 200; i += 1) {
        const out = shuffleTiles(tiles);
        expect(out).toHaveLength(tiles.length);
        expect(sounds(out)).not.toBe(sounds(tiles));
      }
    }
  });

  it('still scrambles when the random source is stuck', () => {
    const tiles = makeTiles(wordLists[1][0]);
    expect(sounds(shuffleTiles(tiles, () => 0.999))).not.toBe(sounds(tiles));
  });
});

describe('pickNextWord', () => {
  it('finishing a level moves straight to a word from the next level', () => {
    const next = pickNextWord({ level: 1, solved: solvedAll(1), currentWord: wordLists[1][0] });
    expect(next.levelUp).toBe(true);
    expect(next.level).toBe(2);
    expect(wordLists[2]).toContain(next.word);
    expect(next.solved.size).toBe(0);
  });

  it('wraps from the last level back to level 1', () => {
    const next = pickNextWord({ level: 3, solved: solvedAll(3), currentWord: wordLists[3][0] });
    expect(next.level).toBe(1);
  });

  it('brings skipped words back until they are solved', () => {
    const [a, b] = wordLists[1];
    const solved = new Set(wordLists[1].slice(2).map((w) => w.word));
    const next = pickNextWord({ level: 1, solved, currentWord: a });
    expect(next.levelUp).toBe(false);
    expect(next.word).toBe(b);
  });

  it('only repeats the current word when it is the last one left', () => {
    const [a] = wordLists[1];
    const solved = new Set(wordLists[1].slice(1).map((w) => w.word));
    expect(pickNextWord({ level: 1, solved, currentWord: a }).word).toBe(a);
  });
});

describe('checkAnswer', () => {
  const word = wordLists[1][0];
  const tiles = makeTiles(word);

  it('accepts the sounds in order', () => {
    expect(checkAnswer(tiles, word)).toBe('correct');
  });

  it('flags the right sounds in the wrong order', () => {
    expect(checkAnswer([...tiles].reverse(), word)).toBe('wrong-order');
  });

  it('waits for every sound before judging', () => {
    expect(checkAnswer(tiles.slice(0, 1), word)).toBe('incomplete');
  });
});

describe('a bigger word bank', () => {
  const lists = {
    1: [{ word: 'cat', phonemes: ['c', 'ă', 't'], display: 'căt' }],
    4: [{ word: 'car', phonemes: ['c', 'ar'], display: 'c[ar]' }],
  };
  it('plays from the lists it is given and moves through their levels', () => {
    const next = pickNextWord({ level: 1, solved: new Set(['cat']), currentWord: lists[1][0] }, Math.random, lists);
    expect(next).toMatchObject({ level: 4, levelUp: true, word: lists[4][0] });
    const wrap = pickNextWord({ level: 4, solved: new Set(['car']), currentWord: lists[4][0] }, Math.random, lists);
    expect(wrap).toMatchObject({ level: 1, levelUp: true });
  });
});
