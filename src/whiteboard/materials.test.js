import { describe, expect, it } from 'vitest';
import { cleanMaterialsView, emptyMaterialsView, matchingLetters, matchingMaterials, materialKind } from './materials.js';
describe('materials browsing', () => {
  it('keeps independent tab queries and scroll when sanitizing saved state', () => {
    const view = cleanMaterialsView({ active: 'worksheets', letters: { query: 'sh', scrollTop: 80 }, pictures: { query: 'vowel', scrollTop: 1000 }, worksheets: { query: 'lesson 2', scrollTop: 400 } });
    expect(view.letters).toEqual({ query: 'sh', scrollTop: 80 });
    expect(view.pictures).toEqual({ query: 'vowel', scrollTop: 1000 });
    expect(view.worksheets).toEqual({ query: 'lesson 2', scrollTop: 400 });
    expect(view.active).toBe('worksheets');
    expect(cleanMaterialsView({ active: 'games', letters: { query: false, scrollTop: Infinity } })).toEqual(emptyMaterialsView());
  });
  it('classifies only explicit worksheet assets and filters actual titles', () => {
    const pictures = [{ id: 'a', title: 'Lesson 2 worksheet.png', material: 'worksheet' }, { id: 'b', title: 'Lip Popper', library: 'card' }, { id: 'c', title: 'Lesson 3.png' }];
    expect(materialKind({ material: 'anything' })).toBe('picture');
    expect(matchingMaterials(pictures, 'worksheet', 'lesson 2').map((p) => p.id)).toEqual(['a']);
    expect(matchingMaterials(pictures, 'picture', '').map((p) => p.id)).toEqual(['b', 'c']);
    expect(matchingMaterials(pictures, 'worksheet', 'missing')).toEqual([]);
  });
  it('offers real letter/digraph choices without interpreting freeform words as new sounds', () => {
    expect(matchingLetters('sh')).toEqual(['sh']);
    expect(matchingLetters('c')).toEqual(['c', 'ch', 'ck']);
    expect(matchingLetters('ship')).toEqual([]);
    expect(matchingLetters()).toContain('igh');
  });
});
