import { describe, expect, it } from 'vitest';
import { cleanIntent, fromWire, toWire } from './phoneme.js';

const state = {
  level: 1,
  solved: new Set(['cat', 'dog']),
  word: { word: 'sun', phonemes: ['s', 'u', 'n'] },
  phase: 'tiles',
  tiles: [{ id: 'sun-0', sound: 's', index: 0 }],
  selected: [],
  feedback: null,
  score: 20,
  streak: 2,
};

describe('the game state on the wire', () => {
  it('turns solved words into a list and back into a set, keeping everything else', () => {
    const wire = toWire(state, 5);
    expect(wire.solved).toEqual(['cat', 'dog']);
    expect(wire.total).toBe(5);
    expect(JSON.parse(JSON.stringify(wire))).toEqual(wire); // it survives JSON
    const back = fromWire({ kind: 'phoneme', ...wire });
    expect(back.solved).toEqual(new Set(['cat', 'dog']));
    expect(back.word).toEqual(state.word);
    expect(back).not.toHaveProperty('total');
    expect(back).not.toHaveProperty('kind');
  });
});

describe('what a student may send', () => {
  it('accepts the taps the game knows', () => {
    expect(cleanIntent({ type: 'toggleTile', id: 'sun-0' })).toEqual({ type: 'toggleTile', id: 'sun-0' });
    expect(cleanIntent({ type: 'split' })).toEqual({ type: 'split' });
    expect(cleanIntent({ type: 'check' })).toEqual({ type: 'check' });
    expect(cleanIntent({ type: 'showNext' })).toEqual({ type: 'showNext' });
    expect(cleanIntent({ type: 'chooseLevel', level: 2 })).toEqual({ type: 'chooseLevel', level: 2 });
  });

  it('refuses unknown kinds and bad fields', () => {
    expect(cleanIntent({ type: 'delete-everything' })).toBeNull();
    expect(cleanIntent({ type: 'toggleTile', id: '' })).toBeNull();
    expect(cleanIntent({ type: 'toggleTile', id: 'x'.repeat(81) })).toBeNull();
    expect(cleanIntent({ type: 'chooseLevel', level: 0 })).toBeNull();
    expect(cleanIntent({ type: 'chooseLevel', level: '2' })).toBeNull();
    expect(cleanIntent({ a: 'place', slot: 1, letter: 'K' })).toBeNull(); // a bridge move, not this game
    expect(cleanIntent(null)).toBeNull();
  });
});
