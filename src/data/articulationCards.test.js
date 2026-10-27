import { describe, expect, it } from 'vitest';
import { ARTICULATION_CARDS, articulationPoses, soundLabel } from './articulationCards.js';

describe('American English articulation examples', () => {
  it('keeps short o in hot separate from long o in go', () => {
    expect(articulationPoses.o.card).toBe('vowel-open');
    expect(articulationPoses.oh.card).toBe('vowel-rounded-back');
    expect(soundLabel('o')).toContain('hot');
    expect(soundLabel('oh')).toContain('go');
    expect(ARTICULATION_CARDS.find((c) => c.id === 'vowel-open').sounds).toContain('o');
    expect(ARTICULATION_CARDS.find((c) => c.id === 'vowel-rounded-back').sounds).not.toContain('o');
  });

  it('keeps sustained nasal sounds distinct from oral releases', () => {
    expect(articulationPoses.m).toMatchObject({ nasal: true, voiced: true, card: 'bilabial-closed' });
    expect(articulationPoses.n).toMatchObject({ nasal: true, voiced: true, card: 'alveolar-stop' });
    expect(articulationPoses.ng).toMatchObject({ nasal: true, voiced: true, card: 'velar' });
    for (const s of ['p', 'b', 't', 'd', 'k', 'g']) expect(articulationPoses[s].nasal).not.toBe(true);
  });
});
