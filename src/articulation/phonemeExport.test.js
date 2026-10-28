import { describe, expect, it } from 'vitest';
import { ARTICULATION_CARDS } from '../data/articulationCards.js';
import { PHONEME_ARTICULATION_CARDS } from '../data/phonemeArticulation.js';
import { GROUPED_ARTICULATION_ADDITION_IDS, phonemeExportPlan } from './phonemeExport.js';

describe('grouped articulation library additions', () => {
  it('exports only the12 requested additions into the existing library by default', () => {
    const plan = phonemeExportPlan();
    expect(plan.map(({ card }) => card.id)).toEqual([
      'short-u', 'long-i', 'long-u', 'book-oo', 'aw', 'schwa',
      'ar', 'r-vowel', 'or', 'oy', 'ow', 'long-a',
    ]);
    expect(new Set(GROUPED_ARTICULATION_ADDITION_IDS).size).toBe(12);
    expect(plan.map(({ order }) => order)).toEqual(Array.from({ length: 12 }, (_, i) => i + 17));
    expect(plan.every(({ collection }) => collection === 'Mouth Pictures')).toBe(true);
    expect(new Set(plan.map(({ cardId }) => cardId)).size).toBe(12);
    expect(ARTICULATION_CARDS).toHaveLength(16);
    expect(plan).toHaveLength(12);
    expect(ARTICULATION_CARDS.length + plan.length).toBe(28);
  });

  it('keeps WH and already represented sound cards out of the default import', () => {
    const ids = phonemeExportPlan().map(({ card }) => card.id);
    for (const id of ['wh', 'p', 'b', 'short-a', 'short-e', 'short-i', 'short-o', 'moon-oo', 'long-o', 'ee', 'r']) expect(ids).not.toContain(id);
  });

  it('requires an explicit opt-in for the47-card developer reference', () => {
    const plan = phonemeExportPlan({ allSounds: true });
    expect(plan).toHaveLength(PHONEME_ARTICULATION_CARDS.length);
    expect(plan).toHaveLength(47);
    expect(plan.every(({ collection }) => collection === 'Phoneme Articulation Reference')).toBe(true);
    expect(plan.at(0).order).toBe(1);
    expect(plan.at(-1).order).toBe(47);
  });
});
