import { describe, expect, it } from 'vitest';
import { ALPHABET, applyAct, cleanAct, cleanSettings, isComplete, newRound } from './bridge.js';

// A random source that always returns the same value, so each round is the same every time.
const fixed = (x) => () => x;

describe('a round', () => {
  it('is consecutive letters of the alphabet with the chosen number of gaps', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const random = () => ((seed * 9301 + 49297) % 233280) / 233280;
      const round = newRound({ length: 6, gaps: 3, distractors: 0 }, random);
      expect(round.letters).toHaveLength(6);
      expect(ALPHABET.includes(round.letters)).toBe(true);
      expect(round.slots).toHaveLength(3);
    }
  });

  it('never leaves the first letter missing', () => {
    for (let seed = 1; seed < 100; seed += 1) {
      const random = () => (seed * 0.137) % 1;
      expect(newRound({ length: 4, gaps: 3 }, random).slots).not.toContain(0);
    }
  });

  it('tray has each missing letter once, plus the requested distractors that are not in the row', () => {
    const round = newRound({ length: 5, gaps: 2, distractors: 2 }, fixed(0.37));
    const missing = round.slots.map((i) => round.letters[i]);
    expect([...round.tray].sort()).toHaveLength(4);
    for (const letter of missing) expect(round.tray).toContain(letter);
    const extra = round.tray.filter((c) => !missing.includes(c));
    expect(extra).toHaveLength(2);
    for (const letter of extra) expect(round.letters.includes(letter)).toBe(false);
  });

  it('keeps the settings inside their limits', () => {
    expect(cleanSettings({ length: 99, gaps: 99, distractors: 99 })).toEqual({ length: 8, gaps: 4, distractors: 2 });
    expect(cleanSettings({ length: 3, gaps: 9 })).toEqual({ length: 3, gaps: 2, distractors: 0 });
    expect(cleanSettings({ length: 'x' })).toEqual({ length: 5, gaps: 2, distractors: 0 });
  });
});

describe('placing letters', () => {
  const round = () => ({ ...newRound({ length: 5, gaps: 2 }, fixed(0.5)) });

  it('places the right letter and takes it off the tray', () => {
    const state = round();
    const slot = state.slots[0];
    const next = applyAct(state, { a: 'place', slot, letter: state.letters[slot] });
    expect(next.placed[slot]).toBe(state.letters[slot]);
    expect(next.tray).not.toContain(state.letters[slot]);
    expect(state.placed[slot]).toBeUndefined(); // the old state is untouched
  });

  it('records a wrong letter without placing it', () => {
    const state = round();
    const slot = state.slots[0];
    const wrong = state.tray.find((c) => c !== state.letters[slot]);
    const next = applyAct(state, { a: 'place', slot, letter: wrong });
    expect(next.placed[slot]).toBeUndefined();
    expect(next.miss).toEqual({ slot, letter: wrong, n: 1 });
    expect(applyAct(next, { a: 'place', slot, letter: wrong }).miss.n).toBe(2);
  });

  it('ignores letters that are not on the tray, gaps that are not gaps, and gaps already filled', () => {
    const state = round();
    const slot = state.slots[0];
    const notOnTray = ALPHABET.split('').find((c) => !state.tray.includes(c));
    expect(applyAct(state, { a: 'place', slot, letter: notOnTray })).toBe(state);
    expect(applyAct(state, { a: 'place', slot: 0, letter: state.letters[0] })).toBe(state);
    const filled = applyAct(state, { a: 'place', slot, letter: state.letters[slot] });
    expect(applyAct(filled, { a: 'place', slot, letter: state.letters[slot] })).toBe(filled);
  });

  it('a tutor "show" fills a gap with the right letter', () => {
    const state = round();
    const next = applyAct(state, { a: 'show', slot: state.slots[1] });
    expect(next.placed[state.slots[1]]).toBe(state.letters[state.slots[1]]);
  });

  it('is complete once every gap is filled', () => {
    let state = round();
    expect(isComplete(state)).toBe(false);
    for (const slot of state.slots) state = applyAct(state, { a: 'place', slot, letter: state.letters[slot] });
    expect(isComplete(state)).toBe(true);
  });
});

describe('what a student may send', () => {
  it('accepts a well-formed place action only', () => {
    expect(cleanAct({ a: 'place', slot: 2, letter: 'M' })).toEqual({ a: 'place', slot: 2, letter: 'M' });
    expect(cleanAct({ a: 'show', slot: 2 })).toBeNull(); // only the tutor demonstrates
    expect(cleanAct({ a: 'place', slot: -1, letter: 'M' })).toBeNull();
    expect(cleanAct({ a: 'place', slot: 2, letter: 'mm' })).toBeNull();
    expect(cleanAct({ a: 'place', slot: 2, letter: '1' })).toBeNull();
    expect(cleanAct(null)).toBeNull();
  });
});
