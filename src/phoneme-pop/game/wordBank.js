import { useEffect, useState } from 'react';
import { wordLists } from '../data/wordLists.js';

// The game's own words and level names: played at once, and kept if the server's bank can't load.
export const BUILT_IN = {
  levels: [
    { level: 1, title: 'Short vowels', examples: ['cat', 'dog', 'sun'] },
    { level: 2, title: 'Blends and digraphs', examples: ['ship', 'frog', 'truck'] },
    { level: 3, title: 'Long vowels and vowel teams', examples: ['night', 'beach', 'phone'] },
  ].map((l) => ({ ...l, count: wordLists[l.level].length })),
  words: wordLists,
};

const usable = (bank) =>
  Array.isArray(bank?.levels) && bank.levels.length > 0 && bank.levels.every((l) => bank.words?.[l.level]?.length > 0);

// The word bank from the server (the database), once it arrives; the built-in words until then.
export function useWordBank() {
  const [bank, setBank] = useState(BUILT_IN);
  useEffect(() => {
    let live = true;
    fetch('/api/words')
      .then((res) => (res.ok ? res.json() : null))
      .then((next) => {
        if (live && usable(next)) setBank(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return bank;
}

const STORE = 'phonemePop.level';

// Where to start: a ?level= link, then the level last played on this device, then level 1.
export function wantedLevel() {
  const fromLink = Number(new URLSearchParams(window.location.search).get('level'));
  if (Number.isInteger(fromLink) && fromLink > 0) return fromLink;
  try {
    const kept = Number(window.localStorage.getItem(STORE));
    if (Number.isInteger(kept) && kept > 0) return kept;
  } catch {
    // storage blocked: start at level 1
  }
  return 1;
}

export function rememberLevel(level) {
  try {
    window.localStorage.setItem(STORE, String(level));
  } catch {
    // storage blocked: the level just isn't remembered
  }
}
