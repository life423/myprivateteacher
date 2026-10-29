import { describe, expect, it } from 'vitest';
import { missingPreparedTiles } from './useLessonRunner.js';

describe('retrying prepared material after reconnect', () => {
  it('keeps an already acknowledged word instead of adding duplicate tiles', () => {
    expect(missingPreparedTiles('c a t', [{ text: 'c' }, { text: 'a' }, { text: 't' }])).toEqual([]);
  });
  it('fills a partial acknowledgement, preserving multiletter graphemes and repeated sounds', () => {
    expect(missingPreparedTiles('sh i p', [{ text: 'sh' }, { text: 'i' }])).toEqual(['p']);
    expect(missingPreparedTiles('p o p', [{ text: 'p' }, { text: 'o' }])).toEqual(['p']);
    expect(missingPreparedTiles('c a t', [{ text: 's' }, { text: 'h' }])).toEqual(['c', 'a', 't']);
  });
});
