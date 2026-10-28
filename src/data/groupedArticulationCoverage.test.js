import { describe, expect, it } from 'vitest';
import { ARTICULATION_CARDS } from './articulationCards.js';
import { CORE_PHONEMES, phonemeArticulationById } from './phonemeArticulation.js';
import { GROUPED_ARTICULATION_ADDITION_IDS } from '../articulation/phonemeExport.js';

// The original family labels use phonics spellings. Normalize them to the
// reference IDs before checking sound coverage; ah and short o share /ɑ/.
const FAMILY_SOUND_IDS = {
  th: 'th-unvoiced', dh: 'th-voiced', i: 'short-i', e: 'short-e',
  a: 'short-a', ah: 'short-o', o: 'short-o', oh: 'long-o', oo: 'moon-oo',
};

describe('grouped articulation library coverage', () => {
  it('covers every core sound with the existing families and the 12 additions, without expanding to 47 cards', () => {
    const coreIds = new Set(CORE_PHONEMES.map((card) => card.id));
    const existingIds = new Set(ARTICULATION_CARDS.flatMap((card) => card.sounds)
      .map((sound) => FAMILY_SOUND_IDS[sound] || sound));
    expect(ARTICULATION_CARDS).toHaveLength(16);
    expect(existingIds.size).toBe(31);
    expect([...existingIds].filter((id) => !coreIds.has(id))).toEqual([]);

    const additions = GROUPED_ARTICULATION_ADDITION_IDS.map(phonemeArticulationById);
    expect(additions).toHaveLength(12);
    expect(additions.every(Boolean)).toBe(true);
    expect(new Set(additions.map((card) => card.id)).size).toBe(12);
    const addedCoreIds = additions.filter((card) => card.inventory === 'core').map((card) => card.id);
    expect(addedCoreIds).toHaveLength(9);
    expect(addedCoreIds.filter((id) => existingIds.has(id))).toEqual([]);

    const covered = new Set([...existingIds, ...addedCoreIds]);
    expect(coreIds.size).toBe(40);
    expect([...covered].sort()).toEqual([...coreIds].sort());
    expect(ARTICULATION_CARDS.length + additions.length).toBe(28);
  });
});
