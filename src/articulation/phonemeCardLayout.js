import { COLUMN, INSTRUCTION, MOUTH_REGION, SOUND, fitText } from './cardLayout.js';

// The original card geometry stays unchanged. Moving sounds use two equally
// sized, separately selectable photo frames inside the existing photo window.
export function phonemeMouthRegions(card) {
  if (!card.movement) return [{ ...MOUTH_REGION }];
  const gap = 60;
  const height = (MOUTH_REGION.h - gap) / 2;
  return [
    { ...MOUTH_REGION, id: 'start', label: 'Start', h: height, r: 26 },
    { ...MOUTH_REGION, id: 'end', label: 'End', y: MOUTH_REGION.y + height + gap, h: height, r: 26 },
  ];
}

export const PHONEME_SOUND_AREA = { y: SOUND.y, height: 112 };
export const FEATURE_TOP = 1028;
export const FEATURE_HEIGHT = 48;
export const phonemeInstructionFit = (card) => fitText(card.instruction, { width: COLUMN.width, height: INSTRUCTION.height, sizes: [44, 40, 36, 32, 30, 28, 26] });
export const phonemeExampleText = (card) => card.id === 'schwa'
  ? `/${card.displaySound || card.ipa}/: first a in about`
  : `/${card.displaySound || card.ipa}/ as in ${card.keyword}`;
export const phonemeExampleFit = (card) => fitText(phonemeExampleText(card), { width: COLUMN.width, height: PHONEME_SOUND_AREA.height, sizes: [46, 42, 38, 34] });

export function phonemeFeatureLines(card) {
  const air = card.nasal ? 'Air: nose' : card.airflow === 'stop' ? 'Air: stop + release' : card.airflow === 'affricate' ? 'Air: stop + friction' : card.airflow === 'lateral' ? 'Air: tongue sides' : 'Air: mouth';
  return [card.voiced ? 'Voice on' : 'Voice off', air];
}
