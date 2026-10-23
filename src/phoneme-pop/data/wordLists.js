// display: vowels carry a breve (short) or macron (long). [Brackets] mark letters
// that team up to make one sound; they render underlined (see MarkedText).
export const wordLists = {
  1: [ // CVC words with short vowels
    { word: 'cat', phonemes: ['c', 'ă', 't'], display: 'căt' },
    { word: 'dog', phonemes: ['d', 'ŏ', 'g'], display: 'dŏg' },
    { word: 'sun', phonemes: ['s', 'ŭ', 'n'], display: 'sŭn' },
    { word: 'map', phonemes: ['m', 'ă', 'p'], display: 'măp' },
    { word: 'bed', phonemes: ['b', 'ĕ', 'd'], display: 'bĕd' }, // b/d distinction practice
    { word: 'pig', phonemes: ['p', 'ĭ', 'g'], display: 'pĭg' }, // p distinction
    { word: 'hot', phonemes: ['h', 'ŏ', 't'], display: 'hŏt' },
    { word: 'run', phonemes: ['r', 'ŭ', 'n'], display: 'rŭn' },
  ],
  2: [ // Blends and digraphs
    { word: 'ship', phonemes: ['sh', 'ĭ', 'p'], display: '[sh]ĭp' },
    { word: 'chat', phonemes: ['ch', 'ă', 't'], display: '[ch]ăt' },
    { word: 'stop', phonemes: ['s', 't', 'ŏ', 'p'], display: 'stŏp' },
    { word: 'frog', phonemes: ['f', 'r', 'ŏ', 'g'], display: 'frŏg' },
    { word: 'this', phonemes: ['th', 'ĭ', 's'], display: '[th]ĭs' },
    { word: 'plan', phonemes: ['p', 'l', 'ă', 'n'], display: 'plăn' },
    { word: 'truck', phonemes: ['t', 'r', 'ŭ', 'ck'], display: 'trŭ[ck]' },
    { word: 'black', phonemes: ['b', 'l', 'ă', 'ck'], display: 'blă[ck]' },
  ],
  3: [ // Long vowels and vowel teams
    { word: 'night', phonemes: ['n', 'ī', 't'], display: 'nīght' }, // igh = long i
    { word: 'beach', phonemes: ['b', 'ē', 'ch'], display: 'bēa[ch]' }, // ea = long e
    { word: 'phone', phonemes: ['f', 'ō', 'n'], display: '[ph]ōne' }, // ph digraph, silent e
    { word: 'light', phonemes: ['l', 'ī', 't'], display: 'līght' }, // igh = long i
    { word: 'dream', phonemes: ['d', 'r', 'ē', 'm'], display: 'drēam' }, // ea = long e
    { word: 'think', phonemes: ['th', 'ĭ', 'nk'], display: '[th]ĭ[nk]' }, // th digraph, nk welded sound
    { word: 'cloud', phonemes: ['c', 'l', 'ou', 'd'], display: 'cl[ou]d' }, // ou diphthong
    { word: 'sound', phonemes: ['s', 'ou', 'n', 'd'], display: 's[ou]nd' }, // ou diphthong
  ],
};
