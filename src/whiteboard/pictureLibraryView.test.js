import { describe, expect, it } from 'vitest';
import { cleanPictureLibraryView, emptyPictureLibraryView, keepPictureLibraryOpen, libraryFaceCrop, loadPictureLibraryView, savePictureLibraryView } from './pictureLibraryView.js';

const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
};

describe('picture library view memory', () => {
  it('preserves the search, collection, catalog scroll and touch preference across reopening', () => {
    const target = storage();
    const view = { query: 'short u', collection: 'Mouth Pictures', scrollTop: 1538, keepOpen: true };
    savePictureLibraryView(view, target);
    expect(loadPictureLibraryView(target)).toEqual(view);
  });

  it('recovers from malformed, unavailable or untrusted browser storage', () => {
    expect(loadPictureLibraryView({ getItem: () => '{oops' })).toEqual(emptyPictureLibraryView());
    expect(loadPictureLibraryView({ getItem: () => { throw new Error('blocked'); } })).toEqual(emptyPictureLibraryView());
    expect(() => savePictureLibraryView({}, { setItem: () => { throw new Error('blocked'); } })).not.toThrow();
    expect(cleanPictureLibraryView({ query: 3, collection: false, scrollTop: Infinity, keepOpen: 'false' })).toEqual(emptyPictureLibraryView());
    expect(cleanPictureLibraryView({ scrollTop: -8 }).scrollTop).toBe(0);
  });
});

describe('face-first library actions', () => {
  const picture = { w: 1200, h: 1200, regions: [{ id: 'mouth', label: 'Mouth', x: 48, y: 300, w: 744, h: 852, r: 36 }] };
  it('uses the exact curated mouth crop without turning the complete card into a session-only preview', () => {
    expect(libraryFaceCrop(picture)).toEqual({ x: 48, y: 300, w: 744, h: 852, r: 36 });
    expect(libraryFaceCrop({ w: 1200, h: 1200 })).toBeNull();
    expect(libraryFaceCrop({ ...picture, regions: [{ ...picture.regions[0], x: 1300 }] })).toBeNull();
  });
  it('keeps the library open for either platform modifier or the visible touch preference', () => {
    expect(keepPictureLibraryOpen({ ctrlKey: true })).toBe(true);
    expect(keepPictureLibraryOpen({ metaKey: true })).toBe(true);
    expect(keepPictureLibraryOpen({}, true)).toBe(true);
    expect(keepPictureLibraryOpen({})).toBe(false);
  });
});
