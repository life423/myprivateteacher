import { describe, expect, it } from 'vitest';
import { reducer } from './useGameState.js';

const tile = { id: 'sun-0', sound: 's', index: 0 };

describe('the feedback after a wrong order', () => {
  it('fades the message but keeps the sounds the student chose, so they can change them', () => {
    const state = { phase: 'tiles', tiles: [tile], selected: [tile], feedback: 'wrong-order', streak: 0 };
    const next = reducer(state, { type: 'clearFeedback' });
    expect(next.feedback).toBeNull();
    expect(next.selected).toEqual([tile]);
  });

  it('a tap on a chosen sound still undoes it and everything after it', () => {
    const second = { id: 'sun-1', sound: 'u', index: 1 };
    const state = { phase: 'tiles', tiles: [tile, second], selected: [tile, second], feedback: 'wrong-order' };
    expect(reducer(state, { type: 'toggleTile', tile }).selected).toEqual([]);
  });
});
