import { describe, expect, it } from 'vitest';
import { publicationReducer, reducer } from './useGameState.js';

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


describe('page publication context', () => {
  it('retains the source activation when a delayed state is published', () => {
    const first = { pageId: 'page-1', pageEpoch: 2 };
    const reopened = { pageId: 'page-1', pageEpoch: 4 };
    const entry = { state: { phase: 'tiles', selected: [], feedback: 'incomplete' }, context: first };
    const pending = publicationReducer(entry, { type: 'clearFeedback', publicationContext: first });
    expect(pending.context).toEqual(first);
    expect(pending.context).not.toEqual(reopened);
    expect(pending.state.feedback).toBeNull();
  });
  it('adopts the new board context with its restored game, including a blank game', () => {
    const second = { pageId: 'page-2', pageEpoch: 3 };
    const previous = { state: { phase: 'celebrating' }, context: { pageId: 'page-1', pageEpoch: 2 } };
    const next = publicationReducer(previous, { type: 'restore', state: { phase: 'word' }, publicationContext: second });
    expect(next).toEqual({ state: { phase: 'word' }, context: second });
    expect(publicationReducer(next, { type: 'unknown', publicationContext: previous.context })).toBe(next);
  });
});
