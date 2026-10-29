import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, ChevronDown, Lock, Plus, Save, Trash2 } from 'lucide-react';
import { Link, navigate, useNavigationGuard } from '../router.jsx';
import { useAccount } from '../account/account.js';
import GoogleButton from '../account/GoogleButton.jsx';
import PdfWorksheetImport from '../whiteboard/PdfWorksheetImport.jsx';
import { newPictureId, shrinkPicture } from '../whiteboard/pictures.js';
import { catalogCollections, collectionLabel, filterLibraryCards } from '../whiteboard/libraryCatalog.js';
import { MAX_PICTURE_BYTES } from '../../shared/pieces.js';
import { ACTIVITY_TYPES, MAX_ACTIVITIES, MAX_ASSETS, acknowledgeSave, activity, attachAsset, editDraft, isDirty, loadedEditor, moveActivity } from './editor.js';
import { createLesson, deleteLesson, deleteLessonAsset, getLesson, getLessonCatalog, lessonAssetUrl, lessonCardUrl, listLessons, saveLesson, uploadLessonAsset } from './api.js';

const button = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50';
const secondary = `${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
const primary = `${button} bg-violet-600 text-white hover:bg-violet-700`;
const input = 'min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200';
const label = 'mb-1.5 block text-sm font-semibold text-slate-700';
const aborted = (error) => error?.name === 'AbortError';

function Shell({ children, title = 'Prepare lesson' }) {
  return <main className='min-h-dvh bg-slate-50 text-slate-900'>
    <header className='border-b border-slate-200 bg-white'>
      <div className='mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6'>
        <Link to='/' className='flex min-h-11 items-center gap-2 text-sm font-bold sm:text-base'><span className='flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white'><BookOpen className='h-5 w-5' aria-hidden='true' /></span>My Private Teacher</Link>
        <Link to='/account' className={secondary}>My account</Link>
      </div>
    </header>
    <div className='mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8'>
      <h1 className='text-2xl font-extrabold tracking-tight sm:text-3xl'>{title}</h1>
      <p className='mt-2 flex items-start gap-1.5 text-sm leading-6 text-slate-600'><Lock className='mt-1 h-4 w-4 shrink-0' aria-hidden='true' />Your plan and notes stay private. Students only see materials you open during teaching.</p>
      {children}
    </div>
  </main>;
}

function SignIn({ clientId, onSignedIn, expired = false }) {
  return <div className='rounded-2xl border border-violet-200 bg-white p-5'>
    <h2 className='font-bold'>{expired ? 'Sign in again to save' : 'Sign in to prepare a lesson'}</h2>
    <p className='mb-4 mt-2 text-sm leading-6 text-slate-600'>{expired ? 'Your unsaved changes are still on this page. After signing in, try Save again.' : 'Keep your activity order, teaching directions, and worksheets together in your own account.'}</p>
    {clientId ? <GoogleButton clientId={clientId} onSignedIn={onSignedIn} /> : <Link to='/login' className={secondary}>Go to sign in</Link>}
  </div>;
}

function ErrorNotice({ error, children }) {
  if (!error) return null;
  return <div className='rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800'><p role='alert'>{error.message || error}</p>{children && <div className='mt-3 flex flex-wrap gap-2'>{children}</div>}</div>;
}

function LessonList({ clientId }) {
  const [lessons, setLessons] = useState(null), [error, setError] = useState(null), [creating, setCreating] = useState(false), [title, setTitle] = useState(''), [expired, setExpired] = useState(false), [deleting, setDeleting] = useState(null);
  const [retry, setRetry] = useState(0);
  const createId = useRef(null), alive = useRef(false), creatingRef = useRef(false), createController = useRef(null), deleteController = useRef(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; createController.current?.abort(); deleteController.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setError(null);
    listLessons({ signal: controller.signal }).then((items) => { if (!controller.signal.aborted) setLessons(items); }).catch((failure) => { if (!controller.signal.aborted && !aborted(failure)) { setError(failure); if (failure.status === 401) setExpired(true); } });
    return () => controller.abort();
  }, [retry]);
  const create = async (event) => {
    event.preventDefault(); if (creatingRef.current) return;
    creatingRef.current = true; setCreating(true); setError(null);
    createId.current ||= crypto.randomUUID();
    const controller = new AbortController(); createController.current = controller;
    try {
      const lesson = await createLesson({ id: createId.current, title: title.trim() || 'Untitled lesson', activities: [] }, { signal: controller.signal });
      if (alive.current && !controller.signal.aborted) navigate(`/lessons/${lesson.id}`);
    } catch (failure) { if (alive.current && !aborted(failure)) { setError(failure); if (failure.status === 401) setExpired(true); } }
    finally { creatingRef.current = false; if (alive.current) setCreating(false); }
  };
  const retryDelete = async (lesson) => {
    if (deleteController.current || !window.confirm('Retry deleting this lesson and its worksheets?')) return;
    const controller = new AbortController(); deleteController.current = controller; setDeleting(lesson.id); setError(null);
    try { await deleteLesson(lesson.id, lesson.revision, { signal: controller.signal }); if (alive.current && !controller.signal.aborted) setLessons((items) => items.filter((item) => item.id !== lesson.id)); }
    catch (failure) { if (alive.current && !aborted(failure)) setError(failure); }
    finally { deleteController.current = null; if (alive.current) setDeleting(null); }
  };
  return <div className='mt-6 grid items-start gap-6 lg:grid-cols-[20rem_1fr]'>
    <form onSubmit={create} className='rounded-2xl border border-violet-200 bg-white p-5 shadow-sm'>
      <h2 className='text-lg font-bold'>A plan for your next lesson</h2>
      <p className='mt-2 text-sm leading-6 text-slate-600'>Choose the materials and the order. You decide what and how to teach.</p>
      <label htmlFor='new-lesson-name' className={`${label} mt-5`}>Lesson name</label>
      <input id='new-lesson-name' value={title} disabled={creating} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder='For example, Short a practice' className={input} />
      <button type='submit' disabled={creating || lessons === null} className={`${primary} mt-3 w-full`}><Plus className='h-4 w-4' aria-hidden='true' />{creating ? 'Creating…' : 'Prepare lesson'}</button>
      <p className='mt-3 text-xs leading-5 text-slate-500'>Review · Build words · Dictation · Read</p>
      <Link to='/whiteboard/teach' className={`${secondary} mt-5 w-full`}>Open a blank whiteboard</Link>
    </form>
    <section aria-labelledby='saved-lessons-heading' className='min-w-0'>
      {expired && <div className='mb-4'><SignIn expired clientId={clientId} onSignedIn={() => { setExpired(false); setRetry((value) => value + 1); }} /></div>}
      <h2 id='saved-lessons-heading' className='mb-3 text-lg font-bold'>Your lessons</h2>
      <ErrorNotice error={error}><button type='button' onClick={() => setRetry((value) => value + 1)} className={secondary}>Try again</button></ErrorNotice>
      {lessons === null ? <p role='status' className='mt-4 text-sm text-slate-600'>{error ? 'Your saved lessons have not loaded.' : 'Loading your lessons…'}</p> : !lessons.length ? <div className='rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600'>No saved lessons yet. Give your first lesson a name to get started.</div> : <ul className='mt-3 grid gap-3'>
        {lessons.map((lesson) => <li key={lesson.id}>{lesson.deletePending ? <div className='rounded-2xl border border-amber-200 bg-white p-4'><h3 className='break-words font-bold'>{lesson.title}</h3><p className='mt-1 text-sm text-slate-600'>Deletion is not complete. Retry to finish removing this lesson and its worksheets.</p><button type='button' disabled={Boolean(deleting)} onClick={() => retryDelete(lesson)} className={`${secondary} mt-3`}>{deleting === lesson.id ? 'Deleting…' : 'Retry deletion'}</button></div> : <Link to={`/lessons/${lesson.id}`} className='flex min-h-20 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-violet-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500'>
          <div className='min-w-0'><h3 className='break-words font-bold'>{lesson.title}</h3><p className='mt-1 text-sm text-slate-500'>{lesson.activityCount || 0} activities{lesson.reviewCount ? ` · ${lesson.reviewCount} to review next time` : ''}</p></div><span className='shrink-0 text-sm font-semibold text-violet-700'>Edit →</span>
        </Link>}</li>)}
      </ul>}
    </section>
  </div>;
}

function CardPicker({ selected, onChange }) {
  const [cards, setCards] = useState(null), [error, setError] = useState(null), [retry, setRetry] = useState(0), [query, setQuery] = useState(''), [collection, setCollection] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setError(null);
    getLessonCatalog({ signal: controller.signal }).then((items) => { if (!controller.signal.aborted) setCards(items); }).catch((failure) => { if (!controller.signal.aborted && !aborted(failure)) setError(failure); });
    return () => controller.abort();
  }, [retry]);
  const matches = cards ? filterLibraryCards(cards, { query, collection }) : [];
  return <details className='rounded-xl border border-slate-200 bg-slate-50'>
    <summary className='min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold text-slate-800'>Articulation cards <span className='font-normal text-slate-500'>({selected.length} selected)</span></summary>
    <div className='border-t border-slate-200 p-3'>
      <div className='grid gap-2 sm:grid-cols-2'><label><span className={label}>Find a card</span><input type='search' value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Sound or keyword' className={input} /></label><label><span className={label}>Collection</span><select value={collection} onChange={(event) => setCollection(event.target.value)} className={input}><option value=''>All collections</option>{cards && catalogCollections(cards).map((name) => <option key={name} value={name}>{collectionLabel(name)}</option>)}</select></label></div>
      <ErrorNotice error={error}><button type='button' onClick={() => setRetry((value) => value + 1)} className={secondary}>Retry cards</button></ErrorNotice>
      {!cards ? <p role='status' className='mt-3 text-sm text-slate-600'>{error ? 'Cards could not be loaded.' : 'Loading cards…'}</p> : <><p className='mb-2 mt-3 text-xs text-slate-500'>{matches.length} of {cards.length} cards</p><div className='grid max-h-96 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3'>
        {matches.map((card) => <label key={card.id} className={`flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-white ${selected.includes(card.id) ? 'border-violet-500 ring-1 ring-violet-500' : 'border-slate-200'}`}>
          <img src={lessonCardUrl(card.id)} alt='' loading='lazy' draggable={false} className='aspect-square w-full object-contain' />
          <span className='flex min-h-11 items-center gap-2 border-t border-slate-100 p-2 text-xs font-semibold'><input type='checkbox' checked={selected.includes(card.id)} onChange={(event) => onChange(event.target.checked ? [...selected, card.id] : selected.filter((id) => id !== card.id))} className='h-5 w-5 shrink-0 accent-violet-600' /><span className='break-words'>{card.title}</span></span>
        </label>)}
      </div>{!matches.length && <p className='py-4 text-sm text-slate-600'>No cards match. Try another sound or collection.</p>}</>}
    </div>
  </details>;
}

function LessonEditor({ id, clientId }) {
  const [state, setState] = useState(null), [selected, setSelected] = useState(null), [error, setError] = useState(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [uploading, setUploading] = useState(0), [pdf, setPdf] = useState(null), [expired, setExpired] = useState(false), [uploadRetry, setUploadRetry] = useState(null), [activityListOpen, setActivityListOpen] = useState(false);
  const stateRef = useRef(state), alive = useRef(false), busyRef = useRef(false), requests = useRef(new Set()), jobs = useRef(new Map()), fileInput = useRef(null), uploadButton = useRef(null), ownerContext = useRef({ id });
  stateRef.current = state;
  const dirty = isDirty(state);
  useNavigationGuard(() => isDirty(stateRef.current) || jobs.current.size > 0, 'Leave this lesson and discard unsaved changes?');
  const update = (transform) => setState((current) => { if (!current) return current; const next = transform(current); stateRef.current = next; return next; });
  const fail = (failure) => { setError(failure); if (failure.status === 401) setExpired(true); };
  const request = () => { const controller = new AbortController(); requests.current.add(controller); return controller; };
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController(); requests.current.add(controller);
    getLesson(id, { signal: controller.signal }).then((lesson) => {
      if (controller.signal.aborted) return;
      const next = loadedEditor(lesson); stateRef.current = next; setState(next); setSelected(lesson.activities[0]?.id || null);
    }).catch((failure) => { if (!controller.signal.aborted && !aborted(failure)) fail(failure); }).finally(() => { requests.current.delete(controller); if (!controller.signal.aborted) setLoading(false); });
    return () => { alive.current = false; requests.current.forEach((item) => item.abort()); requests.current.clear(); jobs.current.clear(); };
  }, [id]);
  const edit = (transform) => { update((current) => editDraft(current, transform)); setMessage(''); };
  const editActivity = (activityId, patch) => edit((draft) => ({ ...draft, activities: draft.activities.map((item) => item.id === activityId ? { ...item, ...patch } : item) }));
  const save = async () => {
    const current = stateRef.current;
    if (!current || busyRef.current || jobs.current.size) return false;
    busyRef.current = true; setBusy(true); setError(null); setMessage('');
    const controller = request(), sent = { version: current.version, draft: JSON.parse(JSON.stringify(current.draft)) };
    try {
      const saved = await saveLesson(id, { revision: current.lesson.revision, ...sent.draft }, { signal: controller.signal });
      if (controller.signal.aborted || !alive.current) return false;
      const next = acknowledgeSave(stateRef.current, sent, saved); stateRef.current = next; setState(next);
      setMessage(isDirty(next) ? 'Saved. Your newer edits still need saving.' : 'Lesson saved.');
      return !isDirty(next);
    } catch (failure) { if (!aborted(failure) && alive.current) fail(failure); return false; }
    finally { requests.current.delete(controller); busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const reload = async () => {
    if (busyRef.current || jobs.current.size || (isDirty(stateRef.current) && !window.confirm('Discard your unsaved changes and reload the latest saved lesson?'))) return;
    busyRef.current = true; setBusy(true); setError(null);
    const controller = request();
    try {
      const lesson = await getLesson(id, { signal: controller.signal });
      if (!alive.current || controller.signal.aborted) return;
      const next = loadedEditor(lesson); stateRef.current = next; setState(next); setSelected((old) => lesson.activities.some((item) => item.id === old) ? old : lesson.activities[0]?.id || null); setMessage('Latest saved lesson loaded.');
    } catch (failure) { if (!aborted(failure) && alive.current) fail(failure); }
    finally { requests.current.delete(controller); busyRef.current = false; if (alive.current) { setBusy(false); setLoading(false); } }
  };
  const add = (type) => {
    if (stateRef.current.draft.activities.length >= MAX_ACTIVITIES) return;
    const next = activity(type); edit((draft) => ({ ...draft, activities: [...draft.activities, next] })); setSelected(next.id); setActivityListOpen(false);
  };
  const removeActivity = (item) => {
    if (!window.confirm(`Remove “${item.title || ACTIVITY_TYPES[item.type].title}” from this lesson?`)) return;
    for (const job of jobs.current.values()) if (job.activityId === item.id) job.controller.abort();
    const remaining = stateRef.current.draft.activities.filter((other) => other.id !== item.id);
    edit((draft) => ({ ...draft, activities: remaining })); setSelected(remaining[0]?.id || null);
    if (pdf?.context.activityId === item.id) setPdf(null);
  };
  const uploadPrepared = async (prepared, options) => {
    const origin = options.writeContext;
    if (origin?.owner !== ownerContext.current || !stateRef.current?.draft.activities.some((item) => item.id === origin.activityId) || options.signal?.aborted) return { cancelled: true };
    if (prepared.blob.size > MAX_PICTURE_BYTES) { const error = new Error('This page is too large. Choose a smaller image.'); fail(error); return { error: error.message }; }
    if ((stateRef.current.lesson.assets?.length || 0) + jobs.current.size >= MAX_ASSETS && !stateRef.current.lesson.assets.some((asset) => asset.id === options.id)) { const error = new Error(`A lesson can hold up to ${MAX_ASSETS} worksheet images.`); fail(error); return { error: error.message }; }
    const controller = request(), key = options.id || newPictureId();
    const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true });
    jobs.current.set(key, { controller, activityId: origin.activityId }); setUploading(jobs.current.size); setMessage('');
    try {
      const asset = await uploadLessonAsset(id, key, prepared, { signal: controller.signal });
      if (!alive.current || controller.signal.aborted || origin.owner !== ownerContext.current) return { cancelled: true };
      update((current) => attachAsset(current, origin.activityId, asset)); setUploadRetry(null); setMessage('Worksheet added to your plan. Save the lesson to keep its activity selection.');
      return asset;
    } catch (failure) {
      if (aborted(failure) || !alive.current) return { cancelled: true };
      fail(failure); setUploadRetry({ prepared, options: { ...options, id: key, signal: undefined } }); return { error: failure.message };
    } finally { options.signal?.removeEventListener('abort', abort); requests.current.delete(controller); jobs.current.delete(key); if (alive.current) setUploading(jobs.current.size); }
  };
  const chooseFile = async (event) => {
    const file = event.target.files?.[0]; event.target.value = '';
    const activityId = selected;
    if (!file || !activityId) return;
    const context = { owner: ownerContext.current, activityId };
    setError(null);
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) { setPdf({ file, context }); return; }
    const controller = request(), key = newPictureId();
    jobs.current.set(key, { controller, activityId }); setUploading(jobs.current.size);
    try {
      const prepared = await shrinkPicture(file);
      if (controller.signal.aborted || !alive.current) return;
      // Release the preparation reservation before the upload reserves its slot.
      jobs.current.delete(key);
      await uploadPrepared(prepared, { id: key, writeContext: context, signal: controller.signal });
    } catch (failure) { if (alive.current && !aborted(failure)) fail(new Error('This image could not be opened. Try a PNG, JPEG, or PDF.')); }
    finally { requests.current.delete(controller); jobs.current.delete(key); if (alive.current) setUploading(jobs.current.size); }
  };
  const discardAsset = async (asset) => {
    if (busyRef.current || stateRef.current.draft.activities.some((item) => item.assetIds.includes(asset.id)) || stateRef.current.lesson.activities.some((item) => item.assetIds.includes(asset.id))) return;
    if (!window.confirm('Delete this unused worksheet image?')) return;
    const controller = request(); setError(null);
    try { await deleteLessonAsset(id, asset.id, { signal: controller.signal }); if (alive.current && !controller.signal.aborted) update((current) => ({ ...current, lesson: { ...current.lesson, assets: current.lesson.assets.filter((item) => item.id !== asset.id) } })); }
    catch (failure) { if (!aborted(failure) && alive.current) fail(failure); }
    finally { requests.current.delete(controller); }
  };
  const deletePlan = async () => {
    if (busyRef.current || !window.confirm('Delete this saved lesson and its worksheets? This cannot be undone.')) return;
    busyRef.current = true; setBusy(true); setError(null); const controller = request();
    try {
      await deleteLesson(id, stateRef.current.lesson.revision, { signal: controller.signal });
      if (!alive.current || controller.signal.aborted) return;
      // The deleted draft has no remaining changes to protect.
      const next = loadedEditor({ ...stateRef.current.lesson, ...stateRef.current.draft }); stateRef.current = next; setState(next);
      navigate('/lessons');
    } catch (failure) { if (!aborted(failure) && alive.current) fail(failure); }
    finally { requests.current.delete(controller); busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const teach = async () => {
    if (busyRef.current || jobs.current.size) return;
    if (!isDirty(stateRef.current) || await save()) navigate(`/whiteboard/teach?lesson=${encodeURIComponent(id)}`);
  };
  if (loading) return <p role='status' className='mt-6 text-sm text-slate-600'>Loading your lesson…</p>;
  if (!state) return <div className='mt-6 space-y-4'><ErrorNotice error={error}><button type='button' onClick={reload} disabled={busy} className={secondary}>Try again</button></ErrorNotice>{expired && <SignIn expired clientId={clientId} onSignedIn={() => { setExpired(false); reload(); }} />}<Link to='/lessons' className={secondary}><ArrowLeft className='h-4 w-4' aria-hidden='true' />Your lessons</Link></div>;
  const current = state.draft.activities.find((item) => item.id === selected), assets = state.lesson.assets || [];
  return <>
    <div className='mt-5 flex flex-wrap items-center justify-between gap-3'><Link to='/lessons' className={secondary}><ArrowLeft className='h-4 w-4' aria-hidden='true' />Your lessons</Link><div className='flex flex-wrap gap-2'><button type='button' disabled={busy || uploading > 0 || !dirty} onClick={save} className={secondary}><Save className='h-4 w-4' aria-hidden='true' />{busy ? 'Saving…' : 'Save lesson'}</button><button type='button' disabled={busy || uploading > 0 || !state.draft.activities.length} onClick={teach} className={primary}>Teach this lesson →</button></div></div>
    <div className='my-3 min-h-6 text-sm'><p role='status' aria-live='polite' className={dirty ? 'text-amber-800' : 'text-slate-600'}>{uploading ? 'Preparing your worksheet…' : message || (dirty ? 'Unsaved changes' : 'All changes saved')}</p></div>
    <ErrorNotice error={error}>{error?.status === 409 && <button type='button' onClick={reload} disabled={busy} className={secondary}>Reload latest saved lesson</button>}{uploadRetry && <button type='button' disabled={uploading > 0} onClick={() => uploadPrepared(uploadRetry.prepared, uploadRetry.options)} className={secondary}>Retry worksheet upload</button>}</ErrorNotice>
    {expired && <div className='my-4'><SignIn expired clientId={clientId} onSignedIn={() => { setExpired(false); setError(null); setMessage('Signed in. You can save your changes now.'); }} /></div>}
    <label className='mb-5 mt-4 block'><span className={label}>Lesson name</span><input value={state.draft.title} maxLength={120} onChange={(event) => edit((draft) => ({ ...draft, title: event.target.value }))} className={`${input} max-w-2xl font-bold`} /></label>
    <div className='grid items-start gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]'>
      <aside className='rounded-2xl border border-slate-200 bg-white p-4'>
        <button type='button' aria-expanded={activityListOpen || !state.draft.activities.length} aria-controls='activity-order' onClick={() => setActivityListOpen((open) => !open)} className={`${button} w-full justify-between px-0 text-slate-800 lg:hidden`}>Activities ({state.draft.activities.length})<ChevronDown className={`h-4 w-4 ${activityListOpen ? 'rotate-180' : ''}`} aria-hidden='true' /></button>
        <h2 className='hidden font-bold lg:block'>Activity order <span className='ml-1 text-sm font-normal text-slate-500'>{state.draft.activities.length}/{MAX_ACTIVITIES}</span></h2>
        <div id='activity-order' className={`${activityListOpen || !state.draft.activities.length ? '' : 'hidden'} lg:block`}><ol className='mt-3 space-y-2'>
          {state.draft.activities.map((item, index) => <li key={item.id} className={`rounded-xl border ${selected === item.id ? 'border-violet-400 bg-violet-50' : 'border-slate-200 bg-white'}`}>
            <button type='button' onClick={() => { setSelected(item.id); setActivityListOpen(false); setPdf(null); }} aria-current={selected === item.id ? 'step' : undefined} className='flex min-h-11 w-full min-w-0 items-center gap-2 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500'><span className='shrink-0 text-xs font-semibold text-slate-500'>{index + 1}.</span><span className='min-w-0 flex-1 break-words text-sm font-semibold'>{item.title || ACTIVITY_TYPES[item.type].title}</span>{item.reviewNextTime && <span title='Review next time' aria-label='Review next time' className='h-2 w-2 shrink-0 rounded-full bg-amber-500' />}</button>
            <div className='flex items-center justify-between gap-1 border-t border-slate-100 px-1'><span className='pl-2 text-xs text-slate-500'>{ACTIVITY_TYPES[item.type].title}</span><div className='flex'><button type='button' aria-label={`Move activity ${index + 1} up`} disabled={index === 0} onClick={() => edit((draft) => ({ ...draft, activities: moveActivity(draft.activities, item.id, -1) }))} className={`${button} px-2 text-slate-600 hover:bg-slate-100`}><ArrowUp className='h-4 w-4' aria-hidden='true' /></button><button type='button' aria-label={`Move activity ${index + 1} down`} disabled={index === state.draft.activities.length - 1} onClick={() => edit((draft) => ({ ...draft, activities: moveActivity(draft.activities, item.id, 1) }))} className={`${button} px-2 text-slate-600 hover:bg-slate-100`}><ArrowDown className='h-4 w-4' aria-hidden='true' /></button></div></div>
          </li>)}
        </ol>
        <fieldset disabled={state.draft.activities.length >= MAX_ACTIVITIES} className='mt-4 border-t border-slate-200 pt-3'><legend className='float-left mb-2 w-full text-sm font-semibold text-slate-700'>Add activity</legend><div className='clear-both grid grid-cols-2 gap-2'>{Object.entries(ACTIVITY_TYPES).map(([type, item]) => <button key={type} type='button' onClick={() => add(type)} className={`${secondary} px-2`}><Plus className='h-4 w-4 shrink-0' aria-hidden='true' />{item.title}</button>)}</div></fieldset></div>
      </aside>
      <section aria-label='Activity editor' className='min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6'>
        {!current ? <div className='flex min-h-64 flex-col justify-center text-center'><BookOpen className='mx-auto h-8 w-8 text-violet-500' aria-hidden='true' /><h2 className='mt-3 text-lg font-bold'>Prepare one activity at a time</h2><p className='mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-600'>Add Review, Build words, Dictation, or Read. Move activities into the order you will teach them.</p></div> : <div key={current.id} className='space-y-5'>
          <div className='flex items-start justify-between gap-3'><div><h2 className='text-lg font-bold'>{ACTIVITY_TYPES[current.type].title}</h2><p className='mt-1 text-sm leading-6 text-slate-600'>{ACTIVITY_TYPES[current.type].description}</p></div><button type='button' aria-label='Remove activity' onClick={() => removeActivity(current)} className={`${button} shrink-0 px-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700`}><Trash2 className='h-4 w-4' aria-hidden='true' /></button></div>
          <label className='block'><span className={label}>Activity name <span className='font-normal text-slate-500'>(private)</span></span><input value={current.title} maxLength={120} onChange={(event) => editActivity(current.id, { title: event.target.value })} className={input} /></label>
          {(current.type === 'build' || current.type === 'dictation') && <label className='block'><span className={label}>{current.type === 'build' ? 'Word list (private)' : 'Words or sentences (private)'}</span><textarea value={current.targets} maxLength={10000} rows={4} onChange={(event) => editActivity(current.id, { targets: event.target.value })} placeholder='One word or sentence per line' className={`${input} resize-y`} /><span className='mt-1 block text-xs leading-5 text-slate-500'>This list is only for you. You decide what to show or say during teaching.</span></label>}
          {(current.type === 'review' || current.type === 'build') && <>
            <label className='block'><span className={label}>{current.type === 'review' ? 'Letters and sounds to review' : 'Starting letter tiles'}</span><input value={current.letters} maxLength={2000} onChange={(event) => editActivity(current.id, { letters: event.target.value })} placeholder='m a p sh' className={input} /><span className='mt-1 block text-xs leading-5 text-slate-500'>Separate tiles with spaces. Keep a letter team together, for example sh.</span></label>
            {current.type === 'build' && <label className='block'><span className={label}>Sound boxes</span><select value={current.boxes} onChange={(event) => editActivity(current.id, { boxes: Number(event.target.value) })} className={`${input} max-w-xs`}>{[0, 2, 3, 4, 5].map((count) => <option key={count} value={count}>{count ? `${count} sound boxes` : 'No sound boxes'}</option>)}</select><span className='mt-1 block text-xs leading-5 text-slate-500'>Choose one box per sound. Letter count and sound count can differ.</span></label>}
            {current.type === 'review' && <CardPicker selected={current.cardIds} onChange={(cardIds) => editActivity(current.id, { cardIds })} />}
          </>}
          {current.type === 'read' && <div>
            <h3 className={label}>Worksheet pages</h3><p className='mb-3 text-sm leading-6 text-slate-600'>Upload an image or choose pages from a PDF. The original PDF stays on your computer. Up to {MAX_ASSETS} images per lesson.</p>
            <input ref={fileInput} type='file' accept='image/*,application/pdf,.pdf' onChange={chooseFile} className='sr-only' tabIndex={-1} aria-label='Choose a worksheet file' />
            <button ref={uploadButton} type='button' disabled={uploading > 0 || assets.length >= MAX_ASSETS} onClick={() => fileInput.current?.click()} className={secondary}><Plus className='h-4 w-4' aria-hidden='true' />Upload worksheet or PDF</button>
            {assets.length > 0 && <div className='mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3'>{assets.map((asset, index) => {
              const used = current.assetIds.includes(asset.id), savedUse = state.lesson.activities.some((item) => item.assetIds.includes(asset.id)), anyUse = state.draft.activities.some((item) => item.assetIds.includes(asset.id));
              return <div key={asset.id} className={`overflow-hidden rounded-xl border ${used ? 'border-violet-400 ring-1 ring-violet-400' : 'border-slate-200'}`}><label className='block cursor-pointer'><img src={lessonAssetUrl(id, asset.id)} alt='' className='aspect-[3/4] w-full bg-slate-100 object-contain' /><span className='flex min-h-11 items-center gap-2 p-2 text-xs font-semibold'><input type='checkbox' className='h-5 w-5 accent-violet-600' checked={used} onChange={(event) => editActivity(current.id, { assetIds: event.target.checked ? [...current.assetIds, asset.id] : current.assetIds.filter((value) => value !== asset.id) })} />Worksheet {index + 1}</span></label>{!anyUse && <button type='button' disabled={savedUse || busy} onClick={() => discardAsset(asset)} className={`${button} w-full rounded-none border-t border-slate-100 px-2 text-xs text-slate-600`}>{savedUse ? 'Save to remove selection first' : 'Delete unused image'}</button>}</div>;
            })}</div>}
          </div>}
          <label className='block'><span className={label}>Directions for you <span className='font-normal text-slate-500'>(private)</span></span><textarea value={current.directions} maxLength={2000} rows={3} onChange={(event) => editActivity(current.id, { directions: event.target.value })} placeholder='Reminders, prompts, or teaching directions' className={`${input} resize-y`} /></label>
          <div className='rounded-xl border border-amber-200 bg-amber-50/60 p-3'><label className='flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800'><input type='checkbox' checked={current.reviewNextTime} onChange={(event) => editActivity(current.id, { reviewNextTime: event.target.checked })} className='h-5 w-5 shrink-0 accent-violet-600' />Review next time</label><label className='mt-1 block'><span className={label}>Review note <span className='font-normal text-slate-500'>(private)</span></span><textarea value={current.reviewNote} maxLength={1000} rows={2} onChange={(event) => editActivity(current.id, { reviewNote: event.target.value })} placeholder='What would you like to revisit?' className={`${input} resize-y`} /></label></div>
        </div>}
      </section>
    </div>
    <footer className='mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500'><p>Only opened materials enter a live lesson. Your words and notes stay in your private plan.</p><button type='button' disabled={busy || uploading > 0} onClick={deletePlan} className={`${button} text-rose-700 hover:bg-rose-50`}><Trash2 className='h-4 w-4' aria-hidden='true' />Delete lesson</button></footer>
    {pdf && <PdfWorksheetImport file={pdf.file} writeContext={pdf.context} uploadCount={assets.length + uploading} onImportPage={uploadPrepared} onClose={() => setPdf(null)} returnFocusRef={uploadButton} />}
  </>;
}

export default function PreparationPage({ id = null }) {
  const { loading, tutor, googleClientId } = useAccount();
  return <Shell>{loading ? <p role='status' className='mt-6 text-sm text-slate-600'>Checking your account…</p> : !tutor ? <div className='mt-6 max-w-lg'><SignIn clientId={googleClientId} /></div> : id ? <LessonEditor key={`${tutor.id}:${id}`} id={id} clientId={googleClientId} /> : <LessonList key={tutor.id} clientId={googleClientId} />}</Shell>;
}
