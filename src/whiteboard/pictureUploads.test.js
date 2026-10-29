import { describe, expect, it, vi } from 'vitest';
import { createPictureUploads, uploadPicture } from './pictureUploads.js';

const room = { code: '6106', key: 'private-tutor-key' };
const id = (n) => n.toString(16).padStart(32, '0');
const page = () => ({ blob: new Blob(['rendered page'], { type: 'image/png' }), w: 1800, h: 2400 });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture({ role = 'tutor', images = [], prepare = vi.fn(async () => page()), upload = vi.fn(async () => ({ ok: true, status: 201 })) } = {}) {
  const pictures = new Map(images.map((p) => [p.id, p]));
  const copies = new Map();
  let sequence = 100;
  const onAdded = vi.fn((picture, copy) => { pictures.set(picture.id, picture); copies.set(picture.id, copy); });
  const manager = createPictureUploads({ role, getPictures: () => pictures, prepare, createId: () => id(sequence++), onAdded, upload });
  return { manager, pictures, copies, prepare, upload, onAdded };
}

describe('prepared worksheet uploads', () => {
  it('posts the original encoded PNG with its dimensions and safe metadata', async () => {
    const image = page();
    const fetcher = vi.fn(async () => ({ ok: true, status: 201 }));
    expect(await uploadPicture(room, id(1), { ...image, material: 'worksheet', title: '<Page> 2' }, { fetcher })).toEqual({ ok: true, status: 201 });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toContain('/api/rooms/6106/pictures/');
    expect(new URL(url, 'https://example.test').searchParams.get('title')).toBe('Page 2');
    expect(options.body).toBe(image.blob);
    expect(options.headers).toEqual({ 'Content-Type': 'image/png', 'X-Room-Key': room.key });
    const f = fixture();
    const result = await f.manager.addPrepared(image, room, { id: id(1), writeContext: 0, material: 'worksheet', title: 'Worksheet Page 2' });
    expect(result).toMatchObject({ id: id(1), w: 1800, h: 2400, material: 'worksheet' });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.copies.get(id(1)).blob).toBe(image.blob);
  });

  it('reserves the last upload slot before image decoding while library cards use a separate allowance', async () => {
    const waiting = deferred();
    const prepare = vi.fn(() => waiting.promise);
    const images = Array.from({ length: 7 }, (_, i) => ({ id: id(i + 1), w: 100, h: 100 }));
    images.push({ id: id(20), library: 'card', w: 100, h: 100 });
    const f = fixture({ images, prepare });
    const first = f.manager.addFile({ name: 'first.png' }, room);
    const second = await f.manager.addPrepared(page(), room);
    expect(second.status).toBe(409);
    expect(f.prepare).toHaveBeenCalledTimes(1);
    waiting.resolve(page());
    expect(await first).toHaveProperty('id');
    expect(f.pictures.size).toBe(9); // eight uploads and one library source
  });

  it('does not render or upload if cancellation wins before preparation starts', async () => {
    const f = fixture();
    const work = f.manager.addFile({ name: 'cancel.png' }, room);
    f.manager.invalidate();
    expect(await work).toMatchObject({ cancelled: true });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
  });

  it('cannot repopulate a cleared lesson when image decoding finishes late', async () => {
    const waiting = deferred();
    const f = fixture({ prepare: vi.fn(() => waiting.promise) });
    const work = f.manager.addFile({ name: 'late.png' }, room);
    await tick();
    f.manager.invalidate();
    waiting.resolve(page());
    expect(await work).toMatchObject({ cancelled: true });
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.onAdded).not.toHaveBeenCalled();
  });

  it('rejects stale contexts, supports context zero and prevents student uploads', async () => {
    const f = fixture();
    f.manager.invalidate();
    expect(await f.manager.addPrepared(page(), room, { writeContext: 0 })).toMatchObject({ cancelled: true });
    expect(await f.manager.addPrepared(page(), room, { writeContext: null })).toMatchObject({ cancelled: true });
    expect(await fixture({ role: 'student' }).manager.addPrepared(page(), room)).toMatchObject({ status: 403 });
    expect(f.upload).not.toHaveBeenCalled();
  });

  it('aborts a pending write on rejoin even if the network ignores cancellation', async () => {
    const waiting = deferred();
    const f = fixture({ upload: vi.fn(() => waiting.promise) });
    const work = f.manager.addPrepared(page(), room, { id: id(1) });
    await tick();
    const signal = f.upload.mock.calls[0][3].signal;
    f.manager.invalidate();
    expect(signal.aborted).toBe(true);
    waiting.resolve({ ok: true, status: 201 });
    expect(await work).toMatchObject({ cancelled: true });
    expect(f.onAdded).not.toHaveBeenCalled();
  });

  it('deduplicates in-flight and completed page IDs and retains bytes on retry', async () => {
    const waiting = deferred();
    const f = fixture({ upload: vi.fn(() => waiting.promise) });
    const image = page();
    const first = f.manager.addPrepared(image, room, { id: id(1), material: 'worksheet' });
    expect(f.manager.addPrepared(image, room, { id: id(1) })).toBe(first);
    waiting.resolve({ ok: true, status: 201 });
    await first;
    expect(await f.manager.addPrepared(image, room, { id: id(1) })).toMatchObject({ existing: true, id: id(1) });
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(f.copies.get(id(1)).blob).toBe(image.blob);
  });

  it.each(['before cancellation', 'after cancellation'])('retains a server-accepted page acknowledged %s without importing another page', async (timing) => {
    const waiting = deferred();
    const f = fixture({ upload: vi.fn(() => waiting.promise) });
    const controller = new AbortController();
    const image = page();
    const picture = { id: id(1), w: image.w, h: image.h, material: 'worksheet', title: 'Page 1' };
    const work = f.manager.addPrepared(image, room, { id: id(1), signal: controller.signal, material: 'worksheet', title: 'Page 1' });
    await tick();
    if (timing === 'before cancellation') { f.pictures.set(picture.id, picture); f.manager.acceptPicture(picture); }
    controller.abort();
    waiting.resolve({ ok: true, status: 201 });
    expect(await work).toMatchObject({ cancelled: true });
    if (timing === 'after cancellation') { f.pictures.set(picture.id, picture); f.manager.acceptPicture(picture); }
    expect(f.copies.get(id(1)).blob).toBe(image.blob);
    expect(f.pictures.size).toBe(1);
    expect(f.upload).toHaveBeenCalledTimes(1);
    f.manager.invalidate();
    expect(f.manager.acceptPicture(picture)).toBe(false);
  });

  it('recovers a page whose server acknowledgment arrived before a lost HTTP response', async () => {
    let f;
    const upload = vi.fn(async (_room, pictureId, image) => {
      f.pictures.set(pictureId, { id: pictureId, w: image.w, h: image.h, material: 'worksheet', title: 'Page 1' });
      throw new TypeError('network response lost');
    });
    f = fixture({ upload });
    const image = page();
    expect(await f.manager.addPrepared(image, room, { id: id(1) })).toMatchObject({ id: id(1), existing: true });
    expect(await f.manager.addPrepared(image, room, { id: id(1) })).toMatchObject({ existing: true });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(f.copies.get(id(1)).blob).toBe(image.blob);
  });

  it('treats a server-acknowledged final-slot page as success when its HTTP response is lost', async () => {
    const images = Array.from({ length: 7 }, (_, i) => ({ id: id(i + 1), w: 100, h: 100 }));
    let f;
    f = fixture({ images, upload: vi.fn(async (_room, pictureId, image) => {
      const accepted = { id: pictureId, w: image.w, h: image.h, material: 'worksheet' };
      f.pictures.set(pictureId, accepted);
      f.manager.acceptPicture(accepted);
      throw new TypeError('response lost');
    }) });
    const result = await f.manager.addPrepared(page(), room, { id: id(99), material: 'worksheet' });
    expect(result).toMatchObject({ id: id(99), existing: true });
    expect(result.error).toBeUndefined();
    expect(f.pictures.size).toBe(8);
    expect(f.copies.has(id(99))).toBe(true);
  });

  it('releases reservations after synchronous validation failures', async () => {
    const f = fixture();
    for (let i = 0; i < 12; i++) expect(await f.manager.addPrepared({ ...page(), w: 4097 }, room)).toMatchObject({ status: 400 });
    expect(await f.manager.addPrepared({ ...page(), blob: new Blob([new Uint8Array(1_500_001)], { type: 'image/png' }) }, room)).toMatchObject({ status: 413 });
    expect(await f.manager.addPrepared(page(), room)).toHaveProperty('id');
    expect(f.upload).toHaveBeenCalledTimes(1);
  });

  it.each([400, 403, 409, 413, 415, 503])('reports HTTP %s without caching a rejected page or leaking the room key', async (status) => {
    const f = fixture({ upload: vi.fn(async () => ({ ok: false, status })) });
    const result = await f.manager.addPrepared(page(), room);
    expect(result).toMatchObject({ status, error: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain(room.key);
    expect(f.onAdded).not.toHaveBeenCalled();
  });
});
