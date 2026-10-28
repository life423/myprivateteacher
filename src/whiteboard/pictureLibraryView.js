import { cleanCrop } from '../../shared/pieces.js';

const KEY = 'mpt.picture-library-view';
export const emptyPictureLibraryView = () => ({ query: '', collection: '', scrollTop: 0, keepOpen: false });

export function cleanPictureLibraryView(input) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    query: typeof value.query === 'string' ? value.query.slice(0, 200) : '',
    collection: typeof value.collection === 'string' ? value.collection.slice(0, 100) : '',
    scrollTop: Number.isFinite(value.scrollTop) ? Math.min(1_000_000, Math.max(0, value.scrollTop)) : 0,
    keepOpen: value.keepOpen === true,
  };
}

export function loadPictureLibraryView(storage) {
  try {
    const target = storage || globalThis.sessionStorage;
    return cleanPictureLibraryView(JSON.parse(target?.getItem(KEY) || 'null'));
  } catch {
    return emptyPictureLibraryView();
  }
}

export function savePictureLibraryView(value, storage) {
  try { (storage || globalThis.sessionStorage)?.setItem(KEY, JSON.stringify(cleanPictureLibraryView(value))); }
  catch { /* Browsing still works when private storage is unavailable. */ }
}

// Primary Add face uses the curated crop, never a guessed portion of the card.
export function libraryFaceCrop(picture) {
  const face = picture?.regions?.find((region) => region.id === 'mouth');
  return face ? cleanCrop(face, picture) : null;
}

export const keepPictureLibraryOpen = (event, preference = false) => Boolean(preference || event?.ctrlKey || event?.metaKey);
