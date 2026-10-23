import { wordLists } from '../data/wordLists.js';

export const LEVELS = Object.keys(wordLists).map(Number).sort((a, b) => a - b);
export const POINTS_PER_WORD = 10;

export function randomItem(list, rng = Math.random) {
  return list[Math.floor(rng() * list.length)];
}

export function makeTiles(word) {
  return word.phonemes.map((sound, index) => ({ id: `${word.word}-${index}`, sound, index }));
}

const soundsOf = (tiles) => tiles.map((t) => t.sound).join('|');

// Fisher-Yates, re-rolled so the tiles never come out already in order.
export function shuffleTiles(tiles, rng = Math.random) {
  if (tiles.length < 2) return [...tiles];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const out = [...tiles];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    if (soundsOf(out) !== soundsOf(tiles)) return out;
  }
  return [...tiles.slice(1), tiles[0]]; // rotation fallback: always out of order
}

// A level is finished once every word in it is solved; skipped words come back
// around. Finishing a level moves straight into the next one, wrapping to the first.
// lists: the words by level (the server's word bank, or the built-in words).
export function pickNextWord({ level, solved, currentWord }, rng = Math.random, lists = wordLists) {
  const levels = Object.keys(lists).map(Number).sort((a, b) => a - b);
  const unsolved = (lists[level] || []).filter((w) => !solved.has(w.word));
  if (unsolved.length === 0) {
    const nextLevel = levels.find((l) => l > level) ?? levels[0]; // the next level up, whatever its number
    return { level: nextLevel, solved: new Set(), word: randomItem(lists[nextLevel], rng), levelUp: true };
  }
  const fresh = unsolved.filter((w) => w.word !== currentWord?.word);
  return { level, solved, word: randomItem(fresh.length ? fresh : unsolved, rng), levelUp: false };
}

// Compares sounds rather than tile identity, so a repeated sound still checks out.
export function checkAnswer(selected, word) {
  if (selected.length < word.phonemes.length) return 'incomplete';
  return soundsOf(selected) === word.phonemes.join('|') ? 'correct' : 'wrong-order';
}
