import { expect, it } from 'vitest';
import { cleanPictureMetadata } from './pictureMetadata.js';
it('keeps only the explicit worksheet classification and bounded plain-text filenames', () => {
  expect(cleanPictureMetadata({ material: 'worksheet', title: ' <Lesson>\n1.png ' })).toEqual({ material: 'worksheet', title: 'Lesson1.png' });
  expect(cleanPictureMetadata({ material: 'private', title: 'a'.repeat(200) }).title).toHaveLength(120);
  expect(cleanPictureMetadata({ material: ['worksheet'], title: 12 })).toEqual({});
});
