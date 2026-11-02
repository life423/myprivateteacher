import { useEffect, useRef, useState } from 'react';
import { lessonAssetUrl } from './api.js';

const normalizedSound = value => String(value ?? '').normalize('NFKC').toLowerCase().replaceAll('/', '').trim();

// Suggestions use only the activity's public letter tiles. Private dictation
// targets and tutor notes never decide what appears in this material picker.
export function teachingMaterials(lesson, activity, library = []) {
  if (!lesson || !activity || activity.type === 'dictation') return [];
  if (activity.type === 'read') {
    const assets = new Map((lesson.assets || []).map(asset => [asset.id, asset]));
    return (activity.assetIds || []).filter(id => assets.has(id)).map((assetId, index) => ({
      kind: 'asset', assetId, key: `asset:${assetId}`,
      label: (activity.assetIds || []).length > 1 ? `${activity.title || 'Lesson picture'} · ${index + 1}` : activity.title || 'Lesson picture',
      src: lessonAssetUrl(lesson.id, assetId),
    }));
  }
  if (activity.type !== 'review') return [];
  const selected = new Set(activity.cardIds || []);
  const sounds = new Set((activity.letters || '').split(/\s+/).map(normalizedSound).filter(Boolean));
  const seen = new Set();
  return library.filter(card => {
    if (seen.has(card.id)) return false;
    const relevant = selected.has(card.id) || [...(card.sounds || []), card.ipa].some(sound => sounds.has(normalizedSound(sound)));
    if (relevant) seen.add(card.id);
    return relevant;
  }).map(card => ({ kind: 'library', cardId: card.id, key: `library:${card.id}`, label: card.title || 'Sound picture' }));
}

function MaterialPreview({ material, loadLibraryImage }) {
  const [image, setImage] = useState({ src: material.src || null, failed: false });
  useEffect(() => {
    if (material.kind !== 'library') return undefined;
    let current = true;
    setImage({ src: null, failed: false });
    Promise.resolve().then(() => loadLibraryImage?.(material.cardId)).then(src => {
      if (current) setImage({ src: src || null, failed: !src });
    }).catch(() => { if (current) setImage({ src: null, failed: true }); });
    return () => { current = false; };
  }, [material.kind, material.cardId, loadLibraryImage]);
  return <span className='flex h-24 w-full items-center justify-center overflow-hidden rounded-lg bg-slate-50'>
    {image.src && !image.failed ? <img src={image.src} alt='' loading='lazy' draggable={false} onError={() => setImage(value => ({ ...value, failed: true }))} className='h-full w-full object-contain' /> : <span className='px-2 text-center text-xs font-normal leading-5 text-slate-500'>{image.failed ? 'Preview unavailable' : 'Loading preview…'}</span>}
  </span>;
}

export default function LessonMaterials({ lesson, activity, activityIndex, library = [], loadLibraryImage, onOpenMaterial, disabled = false }) {
  const [pending, setPending] = useState(null), [error, setError] = useState(null);
  const request = useRef(0), opening = useRef(false);
  useEffect(() => () => { request.current++; }, []);
  const materials = teachingMaterials(lesson, activity, library);
  if (!materials.length || !onOpenMaterial) return null;
  const choose = async material => {
    if (disabled || opening.current) return;
    opening.current = true;
    const ticket = ++request.current;
    setPending(material.key); setError(null);
    try {
      const { kind, assetId, cardId, label } = material;
      await onOpenMaterial({ kind, ...(kind === 'asset' ? { assetId } : { cardId }), activityId: activity.id, activityIndex, label });
    } catch (failure) {
      if (ticket === request.current) setError({ key: material.key, message: failure?.message || 'This material could not be opened. Try again.' });
    } finally {
      if (ticket === request.current) { opening.current = false; setPending(null); }
    }
  };
  return <section aria-label='Teaching pieces' className='space-y-3'>
    <div>
      <h4 className='text-sm font-bold text-slate-800'>Teaching pieces</h4>
      <p className='mt-1 text-sm leading-6 text-slate-600'>Choose individual words, letters or pictures. Only pieces you add go on the board.</p>
    </div>
    <div className='grid grid-cols-2 gap-3'>
      {materials.map(material => <button key={material.key} type='button' aria-label={`Choose parts from ${material.label}`} disabled={disabled || Boolean(pending)} onClick={() => choose(material)} className='flex min-h-11 min-w-0 flex-col items-stretch gap-2 rounded-xl border border-slate-200 bg-white p-2 text-left transition-colors duration-150 hover:border-violet-300 hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none'>
        <MaterialPreview material={material} loadLibraryImage={loadLibraryImage} />
        <span className='text-sm font-semibold leading-5 text-slate-800 [overflow-wrap:anywhere]'>{material.label}</span>
        <span className='mt-auto inline-flex min-h-11 items-center text-sm font-semibold text-violet-700'>{pending === material.key ? 'Opening…' : error?.key === material.key ? 'Try again' : 'Choose parts'}</span>
      </button>)}
    </div>
    {error && <p role='alert' className='rounded-lg bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-800'>{error.message}</p>}
  </section>;
}
