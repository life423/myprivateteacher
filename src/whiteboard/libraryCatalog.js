// Keep search independent of optional metadata so legacy mouth-family cards still work.
const normalized = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replaceAll('/', '').trim();
const soundsOf = (card) => [...(Array.isArray(card.sounds) ? card.sounds : []), card.ipa].map(normalized).filter(Boolean);

export const collectionLabel = (name) => name === 'Mouth Pictures' ? 'Articulation cards' : name;

export function catalogCollections(cards) {
  const priority = ['Phoneme Articulation', 'Mouth Pictures'];
  return [...new Set(cards.map((card) => card.collection).filter(Boolean))].sort((a, b) => {
    const rank = (name) => priority.includes(name) ? priority.indexOf(name) : priority.length;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}

export function filterLibraryCards(cards, { collection = '', query = '' } = {}) {
  const wanted = normalized(query);
  // A sound search such as /p/ or sh must not match every instruction containing that letter.
  const exactSound = wanted && !wanted.includes(' ') && cards.some((card) => soundsOf(card).includes(wanted));
  const terms = wanted.split(/\s+/).filter(Boolean);
  return cards.filter((card) => {
    if (collection && card.collection !== collection) return false;
    if (!wanted) return true;
    if (exactSound) return soundsOf(card).includes(wanted);
    const text = normalized([card.title, ...(card.sounds || []), card.note, card.keyword, card.ipa, card.category, card.kind].filter(Boolean).join(' '));
    return terms.every((term) => text.includes(term));
  });
}
