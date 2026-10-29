// These five reviewed corrections distinguish phonemes from spelling chunks.
// UFLI's scope identifies x as /ks/, ng as /ŋ/, and nk as /ŋk/:
// https://ufli.education.ufl.edu/wp-content/uploads/2022/06/UFLI-Scope2.pdf
// This is a focused correction, not a full review of the word bank or its sequence.
export const REVIEWED_WORD_CORRECTIONS = [
  { level: 1, word: 'box', before: { phonemes: ['b', 'ŏ', 'x'], display: 'bŏx' }, after: { phonemes: ['b', 'ŏ', 'k', 's'], display: 'bŏx' } },
  { level: 1, word: 'fox', before: { phonemes: ['f', 'ŏ', 'x'], display: 'fŏx' }, after: { phonemes: ['f', 'ŏ', 'k', 's'], display: 'fŏx' } },
  { level: 2, word: 'pink', before: { phonemes: ['p', 'ĭ', 'nk'], display: 'pĭ[nk]' }, after: { phonemes: ['p', 'ĭ', 'ng', 'k'], display: 'pĭnk' } },
  { level: 2, word: 'bank', before: { phonemes: ['b', 'ă', 'nk'], display: 'bă[nk]' }, after: { phonemes: ['b', 'ă', 'ng', 'k'], display: 'bănk' } },
  { level: 3, word: 'think', before: { phonemes: ['th', 'ĭ', 'nk'], display: '[th]ĭ[nk]' }, after: { phonemes: ['th', 'ĭ', 'ng', 'k'], display: '[th]ĭnk' } },
];

// Compare-and-set only exact, active copies of the old managed seeds. Custom
// IDs, edits, inactive entries and already corrected records never match. No
// upsert or replacement: order, notes and other tutor-maintained fields stay put.
export function reviewedWordCorrectionOperations() {
  return REVIEWED_WORD_CORRECTIONS.map(({ level, word, before, after }) => ({
    updateOne: {
      filter: { _id: `${level}:${word}`, level, word, phonemes: [...before.phonemes], display: before.display, active: true },
      update: { $set: { phonemes: [...after.phonemes], display: after.display } },
      upsert: false,
    },
  }));
}
