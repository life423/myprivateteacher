import { describe, expect, it } from 'vitest';
import { MAX_BOX_EPOCH, cleanBoxTap, cleanBoxTaps, cleanSoundBoxState, isBoxEpoch, nextBoxEpoch } from './soundBoxes.js';

describe('shared sound-box counters', () => {
  it('keeps unique sorted indices within the tutor-selected count without changing its input', () => {
    const input = [2, 0, 2, -1, 4, 1, '0', 1.5, null, true];
    expect(cleanBoxTaps(3, input)).toEqual([0, 1, 2]);
    expect(input).toEqual([2, 0, 2, -1, 4, 1, '0', 1.5, null, true]);
    expect(cleanBoxTaps(5, [4, 3, 2, 1, 0, 4])).toEqual([0, 1, 2, 3, 4]);
  });

  it('never keeps counters for Off, invalid counts or non-array input', () => {
    for (const count of [0, 1, 6, -1, 3.5, '3', undefined]) expect(cleanBoxTaps(count, [0, 1])).toEqual([]);
    for (const value of [null, undefined, {}, '01', 2]) expect(cleanBoxTaps(3, value)).toEqual([]);
  });

  it('bounds epochs to nonnegative safe integers and advances or wraps without overflow', () => {
    for (const value of [0, 1, MAX_BOX_EPOCH]) expect(isBoxEpoch(value)).toBe(true);
    for (const value of [-1, 0.5, '0', null, undefined, Infinity, NaN, MAX_BOX_EPOCH + 1]) expect(isBoxEpoch(value)).toBe(false);
    expect(nextBoxEpoch(0)).toBe(1);
    expect(nextBoxEpoch(15)).toBe(16);
    expect(nextBoxEpoch(MAX_BOX_EPOCH)).toBe(0);
    expect(nextBoxEpoch(Infinity)).toBe(0);
  });

  it('cleans snapshots and restores old count-only settings without trusting extra fields', () => {
    expect(cleanSoundBoxState()).toEqual({ boxes: 0, boxTaps: [], boxEpoch: 0 });
    expect(cleanSoundBoxState(null)).toEqual({ boxes: 0, boxTaps: [], boxEpoch: 0 });
    expect(cleanSoundBoxState({ boxes: 3 })).toEqual({ boxes: 3, boxTaps: [], boxEpoch: 0 });
    expect(cleanSoundBoxState({ boxes: 4, boxTaps: [3, 0, 3, 7], boxEpoch: 12, tools: true })).toEqual({ boxes: 4, boxTaps: [0, 3], boxEpoch: 12 });
    expect(cleanSoundBoxState({ boxes: 0, boxTaps: [0], boxEpoch: -1 })).toEqual({ boxes: 0, boxTaps: [], boxEpoch: 0 });
  });

  it('accepts only explicit boolean marks for the current exercise', () => {
    expect(cleanBoxTap({ index: 1, pressed: true, epoch: 4, extra: 'ignored' }, 3, 4)).toEqual({ index: 1, pressed: true, epoch: 4 });
    expect(cleanBoxTap({ index: 1, pressed: false, epoch: 4 }, 3, 4)).toEqual({ index: 1, pressed: false, epoch: 4 });
    for (const value of [
      null, {}, { index: 0, pressed: true }, { index: 0, pressed: true, epoch: 3 },
      { index: 0, pressed: true, epoch: '4' }, { index: 0, pressed: 1, epoch: 4 },
      { index: '0', pressed: true, epoch: 4 }, { index: -1, pressed: true, epoch: 4 },
      { index: 3, pressed: true, epoch: 4 }, { index: 0.5, pressed: true, epoch: 4 },
    ]) expect(cleanBoxTap(value, 3, 4)).toBeNull();
    expect(cleanBoxTap({ index: 0, pressed: true, epoch: 0 }, 0, 0)).toBeNull();
    expect(cleanBoxTap({ index: 0, pressed: true, epoch: -1 }, 3, -1)).toBeNull();
  });
});
