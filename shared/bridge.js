// Alphabet Bridge: a row of consecutive letters with some missing. The student fills the gaps
// (and may have to pick the right letter from a few distractors). Pure logic, shared by the
// solo game, the student's screen and the tutor's screen. The tutor's copy is the one that counts.

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const MIN_LENGTH = 3;
export const MAX_LENGTH = 8;
export const MAX_GAPS = 4;
export const MAX_DISTRACTORS = 2;
export const DEFAULT_SETTINGS = { length: 5, gaps: 2, distractors: 0 };

// A random integer in [min, max], from `random` (Math.random by default, a fixed one in tests).
const between = (min, max, random) => min + Math.floor(random() * (max - min + 1));

// Fisher-Yates, so the tray order is random but fixed once the round exists.
function shuffle(items, random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = between(0, i, random);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const clampInt = (n, min, max, fallback) =>
  Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;

// Settings the tutor can change, tidied up. Anything out of range is clamped, not rejected.
export function cleanSettings(s = {}) {
  const length = clampInt(s.length, MIN_LENGTH, MAX_LENGTH, DEFAULT_SETTINGS.length);
  return {
    length,
    gaps: clampInt(s.gaps, 1, Math.min(MAX_GAPS, length - 1), DEFAULT_SETTINGS.gaps),
    distractors: clampInt(s.distractors, 0, MAX_DISTRACTORS, DEFAULT_SETTINGS.distractors),
  };
}

// A new round: `length` consecutive letters, `gaps` of them missing, and the letters to pick from.
// The tray holds each missing letter once plus `distractors` letters that aren't in the row.
export function newRound(settings, random = Math.random) {
  const { length, gaps, distractors } = cleanSettings(settings);
  const start = between(0, ALPHABET.length - length, random);
  const letters = ALPHABET.slice(start, start + length);
  // Missing letters never sit at the very start, so the bridge always begins with solid ground
  const candidates = Array.from({ length: length - 1 }, (_, i) => i + 1);
  const slots = shuffle(candidates, random).slice(0, gaps).sort((a, b) => a - b);
  const others = [...ALPHABET].filter((c) => !letters.includes(c));
  const extra = shuffle(others, random).slice(0, distractors);
  const tray = shuffle([...slots.map((i) => letters[i]), ...extra], random);
  return { letters, slots, placed: {}, tray, miss: null, settings: { length, gaps, distractors } };
}

// Is every gap filled?
export const isComplete = (state) => state.slots.every((slot) => state.placed[slot] !== undefined);

// Applies one action and returns the new state (the old one is never changed).
//   { a: 'place', slot, letter }  the student puts a letter in a gap
//   { a: 'show', slot }           the tutor fills a gap to demonstrate
// A wrong letter is not placed: it's recorded in `miss` so the screen can say "not that one".
export function applyAct(state, act) {
  if (!state || !act) return state;
  if (act.a === 'show') {
    if (!state.slots.includes(act.slot) || state.placed[act.slot] !== undefined) return state;
    return placeLetter(state, act.slot, state.letters[act.slot]);
  }
  if (act.a === 'place') {
    if (!state.slots.includes(act.slot) || state.placed[act.slot] !== undefined) return state;
    if (!state.tray.includes(act.letter)) return state;
    if (act.letter !== state.letters[act.slot]) {
      const n = state.miss ? state.miss.n + 1 : 1;
      return { ...state, miss: { slot: act.slot, letter: act.letter, n } };
    }
    return placeLetter(state, act.slot, act.letter);
  }
  return state;
}

// Puts a correct letter in a gap and takes one copy of it off the tray.
function placeLetter(state, slot, letter) {
  const tray = [...state.tray];
  tray.splice(tray.indexOf(letter), 1);
  return { ...state, placed: { ...state.placed, [slot]: letter }, tray, miss: null };
}

// Is this a well-formed action? Used to check what a student sends before it's passed on.
export function cleanAct(act) {
  if (!act || typeof act !== 'object') return null;
  if (act.a !== 'place') return null;
  if (!Number.isInteger(act.slot) || act.slot < 0 || act.slot >= MAX_LENGTH) return null;
  if (typeof act.letter !== 'string' || act.letter.length !== 1 || !ALPHABET.includes(act.letter)) return null;
  return { a: 'place', slot: act.slot, letter: act.letter };
}
