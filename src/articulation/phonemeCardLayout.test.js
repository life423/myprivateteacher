import { describe, expect, it } from 'vitest';
import { PHONEME_ARTICULATION_CARDS } from '../data/phonemeArticulation.js';
import { COLUMN, INSTRUCTION, MOUTH_REGION, CARD, titleSize } from './cardLayout.js';
import { FEATURE_HEIGHT, FEATURE_TOP, PHONEME_SOUND_AREA, phonemeExampleFit, phonemeExampleText, phonemeFeatureLines, phonemeInstructionFit, phonemeMouthRegions } from './phonemeCardLayout.js';

describe('sound-specific articulation card layout', () => {
  it('keeps every mouth region inside the original photo window and separates glide phases', () => {
    for (const card of PHONEME_ARTICULATION_CARDS) {
      const regions = phonemeMouthRegions(card);
      expect(regions.length, card.id).toBe(card.movement ? 2 : 1);
      for (const r of regions) {
        expect(r.x).toBeGreaterThanOrEqual(MOUTH_REGION.x);
        expect(r.y).toBeGreaterThanOrEqual(MOUTH_REGION.y);
        expect(r.x + r.w).toBeLessThanOrEqual(MOUTH_REGION.x + MOUTH_REGION.w);
        expect(r.y + r.h).toBeLessThanOrEqual(MOUTH_REGION.y + MOUTH_REGION.h);
        expect(r.r).toBeLessThanOrEqual(Math.min(r.w, r.h) / 2);
      }
      if (card.movement) {
        expect(regions.map((r) => r.id)).toEqual(['start', 'end']);
        expect(regions[0].y + regions[0].h).toBeLessThan(regions[1].y);
      }
    }
  });

  it('fits all student cues, examples and distinct sound features', () => {
    for (const card of PHONEME_ARTICULATION_CARDS) {
      const cue = phonemeInstructionFit(card), example = phonemeExampleFit(card);
      expect(cue.lines.length * cue.size * 1.2, card.id).toBeLessThanOrEqual(INSTRUCTION.height);
      expect(example.lines.length * example.size * 1.2, card.id).toBeLessThanOrEqual(PHONEME_SOUND_AREA.height);
      expect(titleSize(card.title), card.id).toBeGreaterThanOrEqual(80);
      const featureLines = phonemeFeatureLines(card);
      expect(featureLines[0]).toBe(card.voiced ? 'Voice on' : 'Voice off');
      expect(featureLines[1], card.id).toMatch(/^Air:/);
      expect(FEATURE_TOP + 58 + FEATURE_HEIGHT).toBeLessThan(CARD.height - 45);
      expect(featureLines.every((line) => line.length * 27 * 0.56 < COLUMN.width)).toBe(true);
    }
  });

  it('uses the student sound notation and identifies the unstressed schwa example', () => {
    expect(phonemeExampleText({ id: 'short-u', displaySound: 'ŭ', ipa: 'ʌ', keyword: 'cup' })).toBe('/ŭ/ as in cup');
    expect(phonemeExampleText({ id: 'long-i', displaySound: 'ī', ipa: 'aɪ', keyword: 'pie' })).toBe('/ī/ as in pie');
    expect(phonemeExampleText({ id: 'schwa', displaySound: 'ə', ipa: 'ə', keyword: 'about' })).toBe('/ə/: first a in about');
  });
});
