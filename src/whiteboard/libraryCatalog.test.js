import { describe, expect, it } from 'vitest';
import { catalogCollections, collectionLabel, filterLibraryCards } from './libraryCatalog.js';

const cards = [
  { id: 'p', collection: 'Phoneme Articulation', title: 'P sound', sounds: ['p'], keyword: 'pig', ipa: 'p', category: 'consonant', note: 'Close your lips, then release air.' },
  { id: 'f', collection: 'Phoneme Articulation', title: 'F sound', sounds: ['f'], keyword: 'fan', ipa: 'f', note: 'Upper teeth touch the lower lip.' },
  { id: 'sh', collection: 'Phoneme Articulation', title: 'SH sound', sounds: ['sh'], keyword: 'ship', ipa: 'ʃ' },
  { id: 'long-e', collection: 'Phoneme Articulation', title: 'Long ē', sounds: ['ē'], keyword: 'feet', ipa: 'i' },
  { id: 'short-e', collection: 'Phoneme Articulation', title: 'Short ĕ', sounds: ['ĕ'], keyword: 'bed', ipa: 'ɛ' },
  { id: 'family', collection: 'Mouth Pictures', title: 'Lip Popper', sounds: ['p', 'b', 'm'], note: 'Lips close. Pop or hum.' },
  { id: 'old', title: 'Old worksheet', collection: 'Worksheets' },
];

describe('picture library catalog', () => {
  it('keeps phoneme and legacy family collections distinct with familiar display names', () => {
    expect(catalogCollections(cards)).toEqual(['Phoneme Articulation', 'Mouth Pictures', 'Worksheets']);
    expect(collectionLabel('Mouth Pictures')).toBe('Articulation cards');
    expect(collectionLabel('Phoneme Articulation')).toBe('Phoneme Articulation');
  });

  it('finds a phoneme without matching incidental letters in unrelated instructions', () => {
    expect(filterLibraryCards(cards, { query: '/P/' }).map((c) => c.id)).toEqual(['p', 'family']);
    expect(filterLibraryCards(cards, { query: 'ʃ' }).map((c) => c.id)).toEqual(['sh']);
    expect(filterLibraryCards(cards, { query: 'sh' }).map((c) => c.id)).toEqual(['sh']);
  });

  it('searches keywords, titles, instructions and optional category metadata', () => {
    expect(filterLibraryCards(cards, { query: 'SHIP' }).map((c) => c.id)).toEqual(['sh']);
    expect(filterLibraryCards(cards, { query: 'upper teeth' }).map((c) => c.id)).toEqual(['f']);
    expect(filterLibraryCards(cards, { query: 'Lip Popper' }).map((c) => c.id)).toEqual(['family']);
    expect(filterLibraryCards(cards, { query: 'consonant' }).map((c) => c.id)).toEqual(['p']);
  });

  it('preserves vowel diacritics so long and short vowels remain distinguishable', () => {
    expect(filterLibraryCards(cards, { query: 'ē' }).map((c) => c.id)).toEqual(['long-e']);
    expect(filterLibraryCards(cards, { query: 'ĕ' }).map((c) => c.id)).toEqual(['short-e']);
  });

  it('applies collection and sound filters together without modifying the source list', () => {
    expect(filterLibraryCards(cards, { collection: 'Phoneme Articulation', query: 'p' }).map((c) => c.id)).toEqual(['p']);
    expect(filterLibraryCards(cards, { collection: 'Mouth Pictures', query: 'p' }).map((c) => c.id)).toEqual(['family']);
    expect(cards).toHaveLength(7);
  });

  it('handles old records without sounds or optional teaching metadata', () => {
    expect(filterLibraryCards(cards, { query: 'worksheet' }).map((c) => c.id)).toEqual(['old']);
    expect(filterLibraryCards(cards)).toEqual(cards);
    expect(filterLibraryCards(cards, { query: 'not-in-the-catalog' })).toEqual([]);
  });
});
