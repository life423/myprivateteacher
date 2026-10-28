import { COLUMN, INSTRUCTION, MOUTH_REGION, SOUND, fitText } from './cardLayout.js';

// Every complete card has the same single mouth photo. Curated student regions
// stay limited to that photo; other card parts are instructor selections.
export const phonemeMouthRegions = () => [{ ...MOUTH_REGION }];

export const PHONEME_SOUND_AREA = SOUND;
const textSizes = [48, 44, 40, 36, 32, 30, 28, 26];
export const phonemeInstructionFit = (card) => fitText(card.instruction, { width: COLUMN.width, height: INSTRUCTION.height, sizes: textSizes });
export const phonemeExampleText = (card) => card.id === 'schwa'
  ? `Makes the /${card.displaySound || card.ipa}/ sound: first a in about.`
  : `Makes the /${card.displaySound || card.ipa}/ sound${card.kind === 'sequence' ? ' sequence' : ''} as in ${card.keyword}.`;
export const phonemeExampleFit = (card) => fitText(phonemeExampleText(card), { width: COLUMN.width, height: SOUND.height, sizes: textSizes });
