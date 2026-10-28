import { describe, expect, it } from 'vitest';
import {
  AIRFLOW_LABELS, ARTICULATION_INVENTORY, ARTICULATION_PHOTO_KEYS,
  ARTICULATION_POSE_KEYS, CORE_PHONEMES, PHONEME_ARTICULATION_CARDS,
  SUPPLEMENTAL_ARTICULATION, phonemeArticulationById,
} from './phonemeArticulation.js';
import { ARTICULATION_CARDS } from './articulationCards.js';

describe('original General American articulation inventory', () => {
  it('separates the 40 core sound targets from 6 sequences and 1 dialect target', () => {
    expect(PHONEME_ARTICULATION_CARDS).toHaveLength(47);
    expect(CORE_PHONEMES).toHaveLength(40);
    expect(CORE_PHONEMES.filter((c) => c.category === 'consonant')).toHaveLength(24);
    expect(CORE_PHONEMES.filter((c) => c.category === 'vowel')).toHaveLength(16);
    expect(SUPPLEMENTAL_ARTICULATION.filter((c) => c.kind === 'sequence')).toHaveLength(6);
    expect(SUPPLEMENTAL_ARTICULATION.filter((c) => c.kind === 'dialect')).toHaveLength(1);
    expect(ARTICULATION_INVENTORY.affiliation).toMatch(/not an official Take Flight/);
    expect(ARTICULATION_CARDS).toHaveLength(16);
  });

  it('gives every target a unique identity and its own example, cue and feature metadata', () => {
    expect(new Set(PHONEME_ARTICULATION_CARDS.map((c) => c.id)).size).toBe(47);
    expect(new Set(CORE_PHONEMES.map((c) => c.ipa)).size).toBe(40);
    for (const card of PHONEME_ARTICULATION_CARDS) {
      for (const field of ['title', 'ipa', 'keyword', 'instruction', 'place', 'manner', 'photoKey', 'poseKey']) {
        expect(typeof card[field], `${card.id}.${field}`).toBe('string');
        expect(card[field].trim().length, `${card.id}.${field}`).toBeGreaterThan(0);
      }
      expect(typeof card.voiced, card.id).toBe('boolean');
      expect(typeof card.nasal, card.id).toBe('boolean');
      expect(AIRFLOW_LABELS[card.airflow], card.id).toBeTruthy();
      expect(card.graphemes.length, card.id).toBeGreaterThan(0);
    }
    expect(phonemeArticulationById('unknown')).toBe(null);
  });

  it('keeps nasals distinct from oral stops even where the visible front photo is shared', () => {
    for (const [nasal, stop] of [['m', 'b'], ['n', 'd'], ['ng', 'g']]) {
      const n = phonemeArticulationById(nasal), s = phonemeArticulationById(stop);
      expect(n).toMatchObject({ voiced: true, nasal: true, airflow: 'nasal' });
      expect(s).toMatchObject({ voiced: true, nasal: false, airflow: 'stop' });
      expect(n.poseKey).not.toBe(s.poseKey);
    }
  });

  it('keeps voiced pairs separate while sharing appropriate placement assets', () => {
    for (const [off, on] of [['p', 'b'], ['t', 'd'], ['k', 'g'], ['f', 'v'], ['th-unvoiced', 'th-voiced'], ['s', 'z'], ['sh', 'zh'], ['ch', 'j']]) {
      const a = phonemeArticulationById(off), b = phonemeArticulationById(on);
      expect(a.voiced).toBe(false);
      expect(b.voiced).toBe(true);
      expect(a.poseKey).toBe(b.poseKey);
      expect(a.ipa).not.toBe(b.ipa);
    }
  });

  it('represents gliding vowels with explicit near-high endpoints rather than tense ee/oo substitutions', () => {
    const targets = [
      ['long-a', 'long-a-start', 'short-i'],
      ['long-o', 'long-o-start', 'book-oo'],
      ['long-i', 'open-vowel', 'short-i'],
      ['ow', 'open-vowel', 'book-oo'],
      ['oy', 'aw-rounded', 'short-i'],
    ];
    for (const [id, start, end] of targets) {
      const card = phonemeArticulationById(id);
      expect(card).toMatchObject({ movement: true, photoKey: start, endPhotoKey: end });
      expect(card.endPoseKey).toBeTruthy();
      expect(card.poseKey).not.toBe(card.endPoseKey);
    }
  });

  it('labels vowel/r sequences honestly and preserves accent and stress variants', () => {
    for (const card of SUPPLEMENTAL_ARTICULATION.filter((c) => c.kind === 'sequence')) {
      expect(card.componentIds).toHaveLength(2);
      expect(card.componentIds.every((id) => phonemeArticulationById(id)?.inventory === 'core')).toBe(true);
    }
    expect(phonemeArticulationById('long-u')).toMatchObject({ kind: 'sequence', ipa: 'ju', componentIds: ['y', 'moon-oo'] });
    expect(phonemeArticulationById('wh')).toMatchObject({ kind: 'dialect', dialectDependent: true, voiced: false });
    expect(phonemeArticulationById('aw')).toMatchObject({ dialectDependent: true });
    expect(phonemeArticulationById('r-vowel').variants).toContainEqual(expect.objectContaining({ ipa: 'ɚ', stress: 'unstressed' }));
    expect(phonemeArticulationById('ah')).toBe(null);
    expect(phonemeArticulationById('qu')).toBe(null);
    expect(phonemeArticulationById('x')).toBe(null);
  });

  it('exports all required photo and pose keys so renderers can detect missing assets', () => {
    expect(ARTICULATION_PHOTO_KEYS).toContain('long-a-start');
    expect(ARTICULATION_PHOTO_KEYS).toContain('book-oo');
    expect(ARTICULATION_POSE_KEYS).toContain('bilabial-nasal');
    expect(ARTICULATION_POSE_KEYS).toContain('vowel-close-mid-front');
    expect(ARTICULATION_PHOTO_KEYS).not.toContain(undefined);
    expect(ARTICULATION_POSE_KEYS).not.toContain(undefined);
  });

  it('uses phonics display labels while retaining precise IPA and separate target identities', () => {
    for (const card of PHONEME_ARTICULATION_CARDS) {
      expect(typeof card.displaySound, card.id).toBe('string');
      expect(card.displaySound.length, card.id).toBeGreaterThan(0);
      expect(card.soundAliases, card.id).toContain(card.displaySound);
      expect(card.soundAliases, card.id).toContain(card.ipa);
      expect(new Set(card.soundAliases).size, card.id).toBe(card.soundAliases.length);
      expect(card.soundAliases.every((alias) => typeof alias === 'string' && alias.length > 0), card.id).toBe(true);
    }
    expect(phonemeArticulationById('short-u')).toMatchObject({ displaySound: 'ŭ', ipa: 'ʌ' });
    expect(phonemeArticulationById('short-u').soundAliases).toContain('short u');
    expect(phonemeArticulationById('long-i')).toMatchObject({ displaySound: 'ī', ipa: 'aɪ' });
    expect(phonemeArticulationById('long-i').soundAliases).toContain('long i');
    expect(phonemeArticulationById('ee').soundAliases).toContain('ee');
    expect(phonemeArticulationById('long-u')).toMatchObject({ displaySound: 'yoo', ipa: 'ju', kind: 'sequence' });
    expect(phonemeArticulationById('y')).toMatchObject({ displaySound: 'y', ipa: 'j' });
    expect(phonemeArticulationById('j')).toMatchObject({ displaySound: 'j', ipa: 'dʒ' });
    expect(phonemeArticulationById('r')).toMatchObject({ displaySound: 'r', ipa: 'ɹ' });
    for (const pair of [['th-unvoiced', 'th-voiced'], ['book-oo', 'moon-oo']]) {
      const [a, b] = pair.map(phonemeArticulationById);
      expect(a.displaySound).toBe(b.displaySound);
      expect(a.id).not.toBe(b.id);
      expect(a.ipa).not.toBe(b.ipa);
    }
    expect(new Set(PHONEME_ARTICULATION_CARDS.map((card) => card.id)).size).toBe(47);
  });
});
