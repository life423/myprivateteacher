import { describe, expect, it } from 'vitest';
import { PHONEME_ARTICULATION_CARDS } from '../data/phonemeArticulation.js';
import { INSTRUCTION, MOUTH_REGION, SOUND, titleSize } from './cardLayout.js';
import { PHONEME_SOUND_AREA, phonemeExampleFit, phonemeExampleText, phonemeInstructionFit, phonemeMouthRegions } from './phonemeCardLayout.js';

describe('consistent articulation card layout', () => {
  it('uses one full-height mouth region on every card, including glides', () => {
    for (const card of PHONEME_ARTICULATION_CARDS) {
      expect(phonemeMouthRegions(card), card.id).toEqual([{ ...MOUTH_REGION }]);
      expect(phonemeMouthRegions(card)[0]).not.toBe(MOUTH_REGION);
    }
  });

  it('fits cues and examples in the same two text areas as the original cards', () => {
    expect(PHONEME_SOUND_AREA).toEqual(SOUND);
    for (const card of PHONEME_ARTICULATION_CARDS) {
      const cue = phonemeInstructionFit(card), example = phonemeExampleFit(card);
      expect(cue.lines.length * cue.size * 1.2, card.id).toBeLessThanOrEqual(INSTRUCTION.height);
      expect(example.lines.length * example.size * 1.2, card.id).toBeLessThanOrEqual(SOUND.height);
      expect(titleSize(card.title), card.id).toBeGreaterThanOrEqual(80);
    }
  });

  it('visibly distinguishes multi-phoneme teaching sequences without another layout element', () => {
    expect(phonemeExampleText({ id: 'long-u', kind: 'sequence', displaySound: 'yoo', keyword: 'cube' })).toBe('Makes the /yoo/ sound sequence as in cube.');
    expect(phonemeExampleText({ id: 'ar', kind: 'sequence', displaySound: 'ar', keyword: 'car' })).toBe('Makes the /ar/ sound sequence as in car.');
    expect(phonemeExampleText({ id: 'or', kind: 'sequence', displaySound: 'or', keyword: 'corn' })).toBe('Makes the /or/ sound sequence as in corn.');
  });

  it('uses the existing sound-line wording and identifies the unstressed schwa example', () => {
    expect(phonemeExampleText({ id: 'short-u', displaySound: 'ŭ', ipa: 'ʌ', keyword: 'cup' })).toBe('Makes the /ŭ/ sound as in cup.');
    expect(phonemeExampleText({ id: 'long-i', displaySound: 'ī', ipa: 'aɪ', keyword: 'pie' })).toBe('Makes the /ī/ sound as in pie.');
    expect(phonemeExampleText({ id: 'schwa', displaySound: 'ə', ipa: 'ə', keyword: 'about' })).toBe('Makes the /ə/ sound: first a in about.');
  });
});
