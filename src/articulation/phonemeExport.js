import { PHONEME_ARTICULATION_CARDS, phonemeArticulationById } from '../data/phonemeArticulation.js';

// Complete the existing grouped mouth-picture library without turning it into
// a second catalog of one card per sound. Existing cards keep orders1–16.
export const GROUPED_ARTICULATION_ADDITION_IDS = [
  'short-u', 'long-i', 'long-u', 'book-oo', 'aw', 'schwa',
  'ar', 'r-vowel', 'or', 'oy', 'ow', 'long-a',
];

export function phonemeExportPlan({ allSounds = false } = {}) {
  const cards = allSounds ? PHONEME_ARTICULATION_CARDS : GROUPED_ARTICULATION_ADDITION_IDS.map((id) => {
    const card = phonemeArticulationById(id);
    if (!card) throw new Error(`Missing grouped articulation addition: ${id}`);
    return card;
  });
  return cards.map((card, i) => ({
    card,
    order: allSounds ? i + 1 : i + 17,
    collection: allSounds ? 'Phoneme Articulation Reference' : 'Mouth Pictures',
    cardId: `phoneme-${card.id}`,
  }));
}
