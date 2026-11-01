import { expect, it, vi } from 'vitest';
import { cleanPictureMetadata } from './pictureMetadata.js';
import { createPictureUploads } from '../src/whiteboard/pictureUploads.js';

it('keeps only the explicit material classifications and bounded plain-text filenames', () => {
  expect(cleanPictureMetadata({ material: 'worksheet', title: ' <Lesson>\n1.png ' })).toEqual({ material: 'worksheet', title: 'Lesson1.png' });
  expect(cleanPictureMetadata({ material: 'lesson-source', title: ' <Sound cue>\n.png ' })).toEqual({ material: 'lesson-source', title: 'Sound cue.png' });
  expect(cleanPictureMetadata({ material: 'private', title: 'a'.repeat(200) }).title).toHaveLength(120);
  expect(cleanPictureMetadata({ material: 'private', title: 'Other image', hidden: true })).toEqual({ title: 'Other image' });
  expect(cleanPictureMetadata({ material: ['worksheet'], title: 12 })).toEqual({});
});

it('retains lesson-source classification through prepared upload and an acknowledged retry', async () => {
  const records = new Map(), copies = [];
  const id = '1234567890abcdef1234567890abcdef';
  const upload = vi.fn(async () => ({ ok: true, status: 201 }));
  const uploads = createPictureUploads({
    role: 'tutor', getPictures: () => records, createId: () => id,
    onAdded: (picture, copy) => { records.set(picture.id, picture); copies.push(copy); },
    upload,
  });
  const image = { blob: new Blob(['prepared image'], { type: 'image/png' }), w: 1600, h: 1700 };
  const room = { code: '1234', key: 'room-key' };
  const first = await uploads.addPrepared(image, room, { id, material: 'lesson-source', title: 'Sound cue' });
  expect(first).toMatchObject({ id, material: 'lesson-source', title: 'Sound cue' });
  expect(upload.mock.calls[0][2]).toMatchObject({ material: 'lesson-source', title: 'Sound cue' });
  // A lost response/retry must retain the existing source category, rather than
  // letting a second import reclassify it into the ordinary worksheet browser.
  const retry = await uploads.addPrepared(image, room, { id, material: 'worksheet', title: 'Replacement label' });
  expect(retry).toMatchObject({ existing: true, material: 'lesson-source', title: 'Sound cue' });
  expect(copies).toHaveLength(2);
  expect(copies.every(copy => copy.material === 'lesson-source' && copy.title === 'Sound cue')).toBe(true);
  expect(upload).toHaveBeenCalledOnce();
});
