import { describe, expect, it } from 'vitest';
import { PHONEME_ARTICULATION_CARDS, ARTICULATION_POSE_KEYS, phonemeArticulationById } from '../data/phonemeArticulation.js';
import { SHARED_PATHS } from '../assets/articulation/anatomy.js';
import { PHONEME_POSES, phonemeDiagramSvg, phonemeDiagramUrl, phonemeMovementArrow } from './phonemeDiagrams.js';

describe('sound-specific articulation diagrams', () => {
  it('covers every explicit start and end pose without fallback substitutions', () => {
    for (const key of ARTICULATION_POSE_KEYS) expect(PHONEME_POSES[key], key).toBeTruthy();
    for (const card of PHONEME_ARTICULATION_CARDS) {
      expect(phonemeDiagramSvg(card), card.id).toContain('<svg');
      if (card.movement) {
        expect(phonemeDiagramSvg(card, 'end'), card.id).toContain('<svg');
        expect(phonemeDiagramSvg(card)).not.toBe(phonemeDiagramSvg(card, 'end'));
      }
    }
    expect(phonemeDiagramSvg({ poseKey: 'unknown' })).toBe(null);
  });

  it('keeps the established anatomy and separates nasal routes from oral releases', () => {
    for (const card of PHONEME_ARTICULATION_CARDS) {
      const svg = phonemeDiagramSvg(card);
      for (const name of ['SKIN', 'PROFILE', 'MOUTH', 'UPPER_TOOTH', 'JAW_FILL', 'FLOOR', 'CHIN', 'LOWER_TOOTH']) expect(svg, `${card.id}: ${name}`).toContain(SHARED_PATHS[name]);
      expect(svg).not.toMatch(/undefined|NaN/);
      expect(svg.includes("data-airflow='nasal'"), card.id).toBe(card.nasal);
      expect(svg.includes("data-airflow='release'"), card.id).toBe(card.airflow === 'stop');
    }
    for (const [nasal, stop] of [['m', 'b'], ['n', 'd'], ['ng', 'g']]) expect(phonemeDiagramSvg(phonemeArticulationById(nasal))).not.toBe(phonemeDiagramSvg(phonemeArticulationById(stop)));
  });

  it('keeps gliding-vowel movement in one anatomy diagram', () => {
    for (const id of ['long-a', 'long-o', 'long-i', 'oy', 'ow']) {
      const card = phonemeArticulationById(id);
      expect(phonemeMovementArrow(card), id).toMatch(/^M /);
      const svg = phonemeDiagramSvg(card);
      expect(svg.match(/<svg/g), id).toHaveLength(1);
      expect(svg.match(/id='tongue'/g), id).toHaveLength(1);
      expect(svg, id).toContain("data-movement='tongue'");
      expect(phonemeDiagramSvg(card, 'end'), id).not.toContain("data-movement='tongue'");
    }
    expect(phonemeMovementArrow(phonemeArticulationById('short-u'))).toBe(null);
    expect(phonemeMovementArrow(phonemeArticulationById('ar'))).toBe(null);
  });

  it('gives different vowel heights/backness different tongue shapes and valid SVG data URLs', () => {
    const keys = ['vowel-near-high-front', 'vowel-close-mid-front', 'vowel-mid-front', 'vowel-low-front', 'vowel-mid-central', 'vowel-open-mid-back', 'vowel-mid-back', 'vowel-near-high-back'];
    expect(new Set(keys.map((key) => PHONEME_POSES[key].tongue)).size).toBe(keys.length);
    expect(PHONEME_POSES['vowel-low-central'].tongue).not.toBe(PHONEME_POSES['vowel-open'].tongue);
    expect(phonemeArticulationById('long-i').poseKey).toBe('vowel-low-central');
    expect(phonemeArticulationById('ow').poseKey).toBe('vowel-low-central');
    const card = phonemeArticulationById('short-e');
    const url = phonemeDiagramUrl(card);
    expect(decodeURIComponent(url.split(',')[1])).toBe(phonemeDiagramSvg(card));
  });
});
