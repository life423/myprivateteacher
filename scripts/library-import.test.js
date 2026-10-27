import { describe, expect, it } from 'vitest';
import { planLibraryImport, readCsv, readRegions } from './library-import.js';

const hash = (letter) => letter.repeat(64);
const card = (fields = {}) => ({
  collection: 'Mouth Pictures', file: '01-lip.jpg', title: 'Lip Popper', order: 1,
  sounds: ['p', 'b', 'm'], note: '', regions: [], sha256: hash('a'), ...fields,
});
const stored = (fields = {}) => {
  const { sha256, ...metadata } = card();
  return { _id: 'one', ...metadata, image: { path: 'pictures/one/original.jpg', sha256 }, ...fields };
};

describe('picture library import plan', () => {
  it('updates a renamed legacy card by collection and title, preserving its identity', () => {
    const existing = stored({ file: 'legacy.png', image: { path: 'legacy/location.png' }, computedSha256: hash('a') });
    const [item] = planLibraryImport([card({ cardId: 'bilabial-closed' })], [existing]);
    expect(item).toMatchObject({ action: 'update', upload: false, existing: { _id: 'one', image: { path: 'legacy/location.png' } }, metadata: { cardId: 'bilabial-closed' } });
  });

  it('skips unchanged records and updates metadata without uploading unchanged bytes', () => {
    expect(planLibraryImport([card()], [stored()])[0]).toMatchObject({ action: 'skip', upload: false });
    expect(planLibraryImport([card({ note: 'Updated instruction' })], [stored()])[0]).toMatchObject({ action: 'update', upload: false });
    expect(planLibraryImport([card({ sha256: hash('b') })], [stored()])[0]).toMatchObject({ action: 'update', upload: true });
  });

  it('matches stable IDs after both file and title change', () => {
    const existing = stored({ cardId: 'bilabial-closed' });
    expect(planLibraryImport([card({ cardId: 'bilabial-closed', file: 'renamed.jpg', title: 'Lips Together' })], [existing])[0].existing).toBe(existing);
  });

  it('refuses duplicate input titles, filenames, stable IDs and image bytes', () => {
    for (const variant of [
      { file: 'other.jpg' },
      { title: 'Other title' },
      { file: 'other.jpg', title: 'Other title', cardId: 'first' },
    ]) {
      expect(() => planLibraryImport([card({ cardId: 'first' }), card({ sha256: hash('b'), ...variant })], [])).toThrow(/Duplicate CSV/);
    }
    expect(() => planLibraryImport([card(), card({ file: 'other.jpg', title: 'Other title' })], [])).toThrow(/Duplicate image bytes/);
  });

  it('refuses ambiguous database matches before choosing a record to overwrite', () => {
    expect(() => planLibraryImport([card()], [stored(), stored({ _id: 'two', file: 'different.jpg' })])).toThrow(/Ambiguous/);
    expect(() => planLibraryImport([card()], [stored({ title: 'Different title' }), stored({ _id: 'two', file: 'different.jpg' })])).toThrow(/Ambiguous/);
    expect(() => planLibraryImport([card({ cardId: 'new' })], [stored({ cardId: 'old' })])).toThrow(/Conflicting stable/);
  });

  it('refuses renamed image duplicates already stored under another identity', () => {
    expect(() => planLibraryImport([card({ title: 'New name', file: 'new.jpg' })], [stored()])).toThrow(/already belong/);
    expect(() => planLibraryImport([card()], [stored(), stored({ _id: 'two', title: 'Other title', file: 'other.jpg', collection: 'Other collection' })])).toThrow(/already belong/);
  });

  it('refuses two rows targeting the same legacy record through different identities', () => {
    const rows = [card({ title: 'New title' }), card({ file: 'new.jpg', sha256: hash('b') })];
    expect(() => planLibraryImport(rows, [stored()])).toThrow(/same existing card/);
  });
});

describe('import preflight fields', () => {
  it('reads quoted CSV and rejects malformed or empty input', () => {
    expect(readCsv('\uFEFFfile,title\r\nphoto.jpg,"Lip, \"\"Popper\"\""\r\n')).toEqual([{ file: 'photo.jpg', title: 'Lip, "Popper"' }]);
    expect(() => readCsv('file,title\na.jpg,"unfinished')).toThrow(/unclosed/);
    expect(() => readCsv('file,file\na.jpg,a.jpg')).toThrow(/unique/);
    expect(() => readCsv('file,title')).toThrow(/at least one/);
  });

  it('validates crop bounds, dimensions, radius and duplicate region IDs', () => {
    const size = { width: 1200, height: 1200 };
    expect(readRegions('mouth:48,300,744,852,36', size)[0]).toMatchObject({ id: 'mouth', x: 48, y: 300, w: 744, h: 852, r: 36 });
    for (const text of ['mouth:0,0,1201,50', 'mouth:0,0,50,50,26', 'mouth:,0,50,50', 'mouth:0,0,50,50;mouth:50,50,50,50']) {
      expect(() => readRegions(text, size)).toThrow(/Invalid/);
    }
  });
});
