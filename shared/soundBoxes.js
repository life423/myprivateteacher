import { BOX_COUNTS } from './tiles.js';

// A bounded configuration generation, separate from individual taps. Different
// boxes can be marked concurrently; count changes and resets invalidate old taps.
export const MAX_BOX_EPOCH = Number.MAX_SAFE_INTEGER;
export const isBoxEpoch = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_BOX_EPOCH;
export const nextBoxEpoch = (value) => isBoxEpoch(value) && value < MAX_BOX_EPOCH ? value + 1 : 0;

// The teacher chooses the phoneme count. Never infer it from letter/tile count.
export function cleanBoxTaps(count, value) {
  if (!BOX_COUNTS.includes(count) || count === 0 || !Array.isArray(value)) return [];
  return [...new Set(value.filter((index) => Number.isInteger(index) && index >= 0 && index < count))].sort((a, b) => a - b);
}

// Old clients restore only the box count; their counters start empty at epoch 0.
export function cleanSoundBoxState(value) {
  const source = value && typeof value === 'object' ? value : {};
  const boxes = BOX_COUNTS.includes(source.boxes) ? source.boxes : 0;
  return { boxes, boxTaps: cleanBoxTaps(boxes, source.boxTaps), boxEpoch: isBoxEpoch(source.boxEpoch) ? source.boxEpoch : 0 };
}

// No coercion: legacy, malformed and stale requests cannot mark a new exercise.
export function cleanBoxTap(value, count, epoch) {
  if (!value || !BOX_COUNTS.includes(count) || count === 0 || !isBoxEpoch(epoch) || !isBoxEpoch(value.epoch) || value.epoch !== epoch) return null;
  if (!Number.isInteger(value.index) || value.index < 0 || value.index >= count || typeof value.pressed !== 'boolean') return null;
  return { index: value.index, pressed: value.pressed, epoch };
}
