import { cleanPictureMetadata } from '../../shared/pictureMetadata.js';
import { MAX_PICTURES, MAX_PICTURE_BYTES, MAX_PICTURE_SIDE, isPictureId } from '../../shared/pieces.js';

const cancelled = () => ({ cancelled: true, error: 'The import stopped because the lesson changed or it was cancelled. Pages already added stay in the lesson.' });
const failure = (status) => ({ status, error: ({
  400: 'This page has an unsupported image size.',
  403: 'The lesson connection changed. Reconnect before adding this page.',
  409: `This page could not be added. The lesson may have changed or reached its ${MAX_PICTURES}-upload limit.`,
  413: 'This page image is too large. Try a smaller image.',
  415: 'This file could not be read as a picture. Try another file.',
})[status] || 'The picture could not be uploaded. Check your connection and try again.' });

export function validPreparedPicture(value) {
  const side = (n) => Number.isInteger(n) && n > 0 && n <= MAX_PICTURE_SIDE;
  return value?.blob instanceof Blob && value.blob.size > 0 && value.blob.size <= MAX_PICTURE_BYTES &&
    ['image/jpeg', 'image/png', 'image/webp'].includes(value.blob.type) && side(value.w) && side(value.h);
}

// The server still sniffs bytes and authenticates the tutor; the MIME header only
// describes the already rendered image. PDF bytes never enter this endpoint.
export async function uploadPicture(room, id, image, { signal, fetcher = globalThis.fetch } = {}) {
  const query = new URLSearchParams({ w: image.w, h: image.h, ...cleanPictureMetadata(image) });
  const response = await fetcher(`/api/rooms/${room.code}/pictures/${id}?${query}`, {
    method: 'POST', body: image.blob, signal,
    headers: { 'Content-Type': image.blob.type, 'X-Room-Key': room.key, ...(room.pageId !== undefined ? { 'X-Page-Id': room.pageId, 'X-Page-Epoch': String(room.pageEpoch) } : {}) },
  });
  return { ok: response.ok, status: response.status };
}

// Reserve capacity before local image work, then guard both sides of the HTTP
// write. A clear/rejoin invalidates the original context, even if rendering or a
// fetch implementation ignores abort. Stable IDs make uncertain retries safe.
export function createPictureUploads({ role, getPictures, prepare, createId, onAdded, upload = uploadPicture }) {
  let context = 0;
  const pending = new Map();
  const candidates = new Map(); // bounded uncertain HTTP outcomes, acknowledged by pic:add
  const existing = (id) => getPictures().get(id);
  const count = () => [...getPictures().values()].filter((p) => !p.library).length;
  function invalidate() {
    context++;
    candidates.clear();
    for (const request of pending.values()) request.controller.abort();
  }
  function acceptPicture(picture) {
    const candidate = candidates.get(picture?.id);
    if (!candidate || candidate.generation !== context || picture.library || picture.w !== candidate.copy.w || picture.h !== candidate.copy.h) return false;
    candidates.delete(picture.id);
    onAdded(picture, candidate.copy);
    return true;
  }
  function add(input, room, options = {}, prepared = false) {
    if (role !== 'tutor') return Promise.resolve({ status: 403, error: 'Only the tutor can add a picture.' });
    if (!room?.code || !room?.key) return Promise.resolve({ error: 'Not connected yet. Try again in a moment.' });
    const generation = options.writeContext === undefined ? context : options.writeContext;
    if (generation !== context || options.signal?.aborted) return Promise.resolve(cancelled());
    const id = options.id || createId();
    if (!isPictureId(id)) return Promise.resolve({ status: 400, error: 'This picture could not be identified. Please try again.' });
    const here = existing(id);
    if (here) {
      if (here.library) return Promise.resolve(failure(409));
      // The server may have accepted a page and broadcast it before the HTTP
      // response was lost. A retry retains its bytes for reconnect restoration
      // without uploading or consuming another slot.
      if (prepared && validPreparedPicture(input) && here.w === input.w && here.h === input.h) {
        onAdded(here, { blob: input.blob, w: input.w, h: input.h, ...cleanPictureMetadata(here) });
      }
      return Promise.resolve({ ...here, existing: true });
    }
    const requestKey = `${room.code}:${room.key}:${id}`;
    const same = pending.get(requestKey);
    if (same && same.generation === generation) return same.promise;
    const reserved = [...pending.values()].filter((request) => request.generation === context && !existing(request.id)).length;
    if (count() + reserved >= MAX_PICTURES) return Promise.resolve({ status: 409, error: `Up to ${MAX_PICTURES} uploaded pictures or worksheet pages per lesson.` });
    const controller = new AbortController();
    const request = { id, generation, controller };
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const current = () => context === generation && !controller.signal.aborted;
    const destination = { code: room.code, key: room.key, ...(room.pageId !== undefined ? { pageId: room.pageId, pageEpoch: room.pageEpoch } : {}) };
    request.promise = Promise.resolve().then(async () => {
      let copy;
      try {
        if (!current()) return cancelled();
        const image = prepared ? input : await prepare(input, { signal: controller.signal });
        if (!current()) return cancelled();
        if (!validPreparedPicture(image)) return failure(image?.blob?.size > MAX_PICTURE_BYTES ? 413 : 400);
        copy = { blob: image.blob, w: image.w, h: image.h, ...cleanPictureMetadata({ material: options.material, title: options.title ?? input?.name }) };
        candidates.set(id, { generation, copy });
        while (candidates.size > MAX_PICTURES) candidates.delete(candidates.keys().next().value);
        const response = await upload(destination, id, copy, { signal: controller.signal });
        if (!current()) {
          if (context === generation) acceptPicture(existing(id));
          return cancelled();
        }
        if (!response.ok) { candidates.delete(id); return failure(response.status); }
        const picture = { id, w: copy.w, h: copy.h, ...cleanPictureMetadata(copy) };
        candidates.delete(id);
        onAdded(picture, copy);
        return picture;
      } catch (error) {
        const accepted = existing(id);
        if (current() && copy && accepted && !accepted.library && accepted.w === copy.w && accepted.h === copy.h) {
          candidates.delete(id);
          onAdded(accepted, copy);
          return { ...accepted, existing: true };
        }
        if (!current() || error?.name === 'AbortError') {
          if (context === generation) acceptPicture(existing(id));
          return cancelled();
        }
        return { error: prepared ? 'The page could not be uploaded. Check your connection and try again.' : 'That picture could not be opened or uploaded. Please try again.' };
      } finally {
        options.signal?.removeEventListener('abort', abort);
        if (pending.get(requestKey) === request) pending.delete(requestKey);
      }
    });
    pending.set(requestKey, request);
    return request.promise;
  }
  return { get context() { return context; }, invalidate, acceptPicture, addFile: (file, room, options) => add(file, room, options), addPrepared: (image, room, options) => add(image, room, options, true) };
}
