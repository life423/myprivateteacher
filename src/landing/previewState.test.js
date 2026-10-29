import { describe, expect, it } from 'vitest';
import { movePreviewLetter, SOUND_WORDS } from './previewState.js';

describe('isolated lesson preview letter movement', () => {
  it('places a tray letter without mutating the original board', () => {
    const original = [null, null, null];
    expect(movePreviewLetter(original, { kind: 'tray', letter: 'c' }, 0)).toEqual(['c', null, null]);
    expect(original).toEqual([null, null, null]);
  });
  it('swaps occupied boxes instead of duplicating or losing a letter', () => {
    expect(movePreviewLetter(['c', 'a', 't'], { kind: 'box', index: 0 }, 2)).toEqual(['t', 'a', 'c']);
  });
  it('moves an existing tray letter rather than copying it', () => {
    expect(movePreviewLetter(['c', null, null], { kind: 'tray', letter: 'c' }, 1)).toEqual([null, 'c', null]);
  });
  it('returns a replaced letter to the tray and rejects invalid drops', () => {
    expect(movePreviewLetter(['c', null, null], { kind: 'tray', letter: 'a' }, 0)).toEqual(['a', null, null]);
    const original = ['c', null, null];
    expect(movePreviewLetter(original, { kind: 'tray', letter: 'b' }, 0)).toBe(original);
    expect(movePreviewLetter(original, { kind: 'tray', letter: 'a' }, -1)).toBe(original);
  });
  it('counts sounds rather than letters in the digraph example', () => {
    expect(SOUND_WORDS.find(({ word }) => word === 'ship').sounds).toEqual(['sh', 'i', 'p']);
    expect(SOUND_WORDS.find(({ word }) => word === 'stop').sounds).toHaveLength(4);
  });
});
