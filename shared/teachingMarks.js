// Reusable teaching ink, independent of worksheets and curriculum-specific coding.
// The tutor chooses which marks to use and what they mean in the lesson.
export const TEACHING_MARKS = Object.freeze([
  { id: 'breve', label: 'Breve', w: 64, h: 28, minWidth: 24, defaultWidth: 40 },
  { id: 'macron', label: 'Macron', w: 64, h: 16, minWidth: 24, defaultWidth: 40 },
  { id: 'schwa', label: 'Schwa', w: 58, h: 80, minWidth: 28, defaultWidth: 48 },
  { id: 'stress', label: 'Stress mark', w: 24, h: 40, minWidth: 12, defaultWidth: 20 },
  { id: 'cedilla', label: 'Cedilla', w: 32, h: 36, minWidth: 14, defaultWidth: 24 },
  { id: 'dot', label: 'Dot above', w: 20, h: 20, minWidth: 8, defaultWidth: 12 },
  { id: 'circumflex', label: 'Circumflex', w: 64, h: 28, minWidth: 24, defaultWidth: 40 },
  { id: 'diaeresis', label: 'Two dots', w: 48, h: 20, minWidth: 24, defaultWidth: 36 },
  { id: 'silent-letter', label: 'Silent-letter slash', w: 40, h: 72, minWidth: 18, defaultWidth: 36 },
  { id: 'underline', label: 'Underline', w: 96, h: 16, minWidth: 32, defaultWidth: 88 },
  { id: 'syllable-scoop', label: 'Syllable scoop', w: 96, h: 36, minWidth: 40, defaultWidth: 88 },
].map(mark => Object.freeze(mark)));

const marksById = new Map(TEACHING_MARKS.map(mark => [mark.id, mark]));
export const getTeachingMark = id => typeof id === 'string' ? marksById.get(id) || null : null;
