import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, FileText, X } from 'lucide-react';
import { MAX_PICTURES } from '../../shared/pieces.js';
import { newPictureId } from './pictures.js';
import { loadPdfWorksheet } from './pdfWorksheets.js';
import './pdfWorksheetImport.css';

const PAGE_GROUP = 12;
const button = 'inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50';
const secondary = `${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
const primary = `${button} bg-violet-600 text-white hover:bg-violet-700`;
const pageTitle = (name, page) => {
  const suffix = ` (Page ${page})`;
  return `${name.replace(/\.pdf$/i, '').slice(0, 80 - suffix.length)}${suffix}`;
};
const aborted = (error) => error?.name === 'AbortError';

// Only the visible group creates thumbnail jobs. Leaving the group cancels its
// jobs and frees its object URLs; even a 200-page document stays bounded.
function PageThumbnail({ document, page, disabled, onPreview }) {
  const element = useRef(null);
  const [image, setImage] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let url;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      document.thumbnail(page, { signal: controller.signal }).then(({ blob }) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage(url);
      }).catch((failure) => { if (!controller.signal.aborted && !aborted(failure)) setError(true); });
    }, { rootMargin: '120px' });
    observer.observe(element.current);
    return () => { controller.abort(); observer.disconnect(); if (url) URL.revokeObjectURL(url); };
  }, [document, page]);
  return <button ref={element} type='button' disabled={disabled} onClick={() => onPreview(page)} aria-label={`Preview page ${page}`} className='relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-t-xl bg-slate-100 p-2 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-violet-500'>
    {image ? <img src={image} alt='' draggable={false} className='max-h-full max-w-full object-contain shadow-sm' /> : <span className='px-2 text-center text-xs text-slate-600'>{error ? 'Preview unavailable. Open page to retry.' : 'Loading preview…'}</span>}
    <span className='absolute bottom-1 right-1 rounded-lg bg-white/95 p-1.5 text-slate-700 shadow-sm'><Eye className='h-4 w-4' aria-hidden='true' /></span>
  </button>;
}

function PagePreview({ document, page }) {
  const [state, setState] = useState({ src: null, error: null });
  useEffect(() => {
    const controller = new AbortController();
    let url;
    setState({ src: null, error: null });
    document.renderPage(page, { signal: controller.signal, maxSide: 1200 }).then(({ blob }) => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setState({ src: url, error: null });
    }).catch((error) => { if (!controller.signal.aborted && !aborted(error)) setState({ src: null, error: error.message || 'This page could not be previewed.' }); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [document, page]);
  return <div data-pdf-page-preview className='flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-slate-100 p-2'>
    {state.src ? <img src={state.src} alt={`Preview of PDF page ${page}`} draggable={false} className='h-full max-h-full w-full object-contain' /> : <p role={state.error ? 'alert' : 'status'} className='p-4 text-center text-sm text-slate-700'>{state.error || `Rendering page ${page}…`}</p>}
  </div>;
}

// PDF bytes and previews stay in this browser. Only an explicit import sends
// selected, rasterized pages through the existing worksheet-image upload path.
export default function PdfWorksheetImport({ file, uploadCount = 0, writeContext = null, onImportPage, onClose, returnFocusRef }) {
  const dialog = useRef(null);
  const headingId = useId(), slotsId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const initialContext = useRef(writeContext);
  const contextRef = useRef(writeContext);
  contextRef.current = writeContext;
  const importRef = useRef(onImportPage);
  importRef.current = onImportPage;
  const documentRef = useRef(null);
  const alive = useRef(true);
  const lifetime = useRef(null), batch = useRef(null);
  const pageIds = useRef(new Map()), completedRef = useRef(new Map());
  const [document, setDocument] = useState(null);
  const [loadState, setLoadState] = useState('Opening PDF…');
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [completed, setCompleted] = useState(new Map());
  const [failures, setFailures] = useState(new Map());
  const [group, setGroup] = useState(0);
  const [previewPage, setPreviewPage] = useState(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [notice, setNotice] = useState(null);
  const remaining = Math.max(0, MAX_PICTURES - uploadCount);
  const remainingRef = useRef(remaining);
  remainingRef.current = remaining;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const groups = document ? Math.ceil(document.numPages / PAGE_GROUP) : 0;
  const pages = document ? Array.from({ length: Math.min(PAGE_GROUP, document.numPages - group * PAGE_GROUP) }, (_, index) => group * PAGE_GROUP + index + 1) : [];
  const selectedCount = selected.size;
  const finished = completed.size > 0 && selectedCount === 0;

  useEffect(() => {
    alive.current = true;
    const element = dialog.current;
    const previous = window.document.activeElement;
    const overflow = window.document.body.style.overflow;
    window.document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      alive.current = false;
      batch.current?.abort();
      if (element.open) element.close();
      window.document.body.style.overflow = overflow;
      const target = returnFocusRef?.current || previous;
      if (target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
    };
  }, [returnFocusRef]);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    loadPdfWorksheet(file, { signal: controller.signal, onProgress: (value) => {
      if (!controller.signal.aborted && value?.total) setLoadState(`Opening PDF (${Math.round(value.loaded / value.total * 100)}%)…`);
    } }).then((pdf) => {
      if (controller.signal.aborted) { pdf.destroy(); return; }
      documentRef.current = pdf;
      setDocument(pdf);
    }).catch((error) => { if (!controller.signal.aborted && !aborted(error)) setLoadError(error.message || 'This PDF could not be opened.'); });
    return () => {
      controller.abort();
      batch.current?.abort();
      documentRef.current?.destroy();
      documentRef.current = null;
    };
  }, [file]);

  useEffect(() => {
    if (writeContext !== initialContext.current || writeContext === null) {
      batch.current?.abort();
      lifetime.current?.abort();
      closeRef.current();
    }
  }, [writeContext]);

  // A concurrent image upload can consume a slot while this private picker is open.
  useEffect(() => {
    if (importing || selectedRef.current.size <= remaining) return;
    setSelected((current) => new Set([...current].sort((a, b) => a - b).slice(0, remaining)));
    setNotice(`Only ${remaining} upload ${remaining === 1 ? 'slot remains' : 'slots remain'}. Your selection was adjusted.`);
  }, [remaining, importing]);

  const choose = (page, checked) => {
    if (importing || completedRef.current.has(page)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (checked && next.size < remainingRef.current) next.add(page);
      if (!checked) next.delete(page);
      return next;
    });
    setNotice(null);
  };

  const cancelBatch = () => {
    batch.current?.abort();
    setNotice('Import stopped. Pages already imported remain in your lesson.');
  };

  const importSelected = async () => {
    if (importing || batch.current || !documentRef.current || !selectedRef.current.size || contextRef.current === null) return;
    const controller = new AbortController();
    batch.current = controller;
    const context = contextRef.current;
    const chosen = [...selectedRef.current].sort((a, b) => a - b).slice(0, remainingRef.current);
    setImporting(true); setNotice(null); setFailures(new Map());
    let imported = 0;
    try {
      for (let index = 0; index < chosen.length; index++) {
        const page = chosen[index];
        if (controller.signal.aborted || contextRef.current !== context) break;
        if (completedRef.current.has(page)) continue;
        if (remainingRef.current < 1) { setNotice('All upload slots are full. Pages already imported remain in your lesson.'); break; }
        setProgress({ page, index: index + 1, total: chosen.length });
        if (!pageIds.current.has(page)) pageIds.current.set(page, newPictureId());
        try {
          const prepared = await documentRef.current.renderPage(page, { signal: controller.signal });
          if (controller.signal.aborted || contextRef.current !== context) break;
          const result = await importRef.current(prepared, { id: pageIds.current.get(page), title: pageTitle(file.name, page), material: 'worksheet', signal: controller.signal, writeContext: context });
          if (controller.signal.aborted || contextRef.current !== context || result?.cancelled) break;
          if (result?.error || !result?.id) throw new Error(result?.error || 'This page could not be imported.');
          completedRef.current.set(page, result);
          setCompleted(new Map(completedRef.current));
          setSelected((current) => { const next = new Set(current); next.delete(page); return next; });
          imported++;
        } catch (error) {
          if (controller.signal.aborted || aborted(error)) break;
          setFailures((current) => new Map(current).set(page, error.message || 'This page could not be imported.'));
          setNotice(`Import paused on page ${page}. ${error.message || 'This page could not be imported.'} Pages already imported remain in your lesson. Retry the remaining selection.`);
          break;
        }
      }
      if (!controller.signal.aborted && imported === chosen.length) setNotice(`${imported} ${imported === 1 ? 'page imported' : 'pages imported'}. You can select more pages or choose Done.`);
    } finally {
      if (batch.current === controller) {
        batch.current = null;
        if (alive.current) { setImporting(false); setProgress(null); }
      }
    }
  };

  const checkbox = (page) => <label className='flex min-h-11 min-w-0 cursor-pointer items-center gap-2 px-2 text-sm font-semibold text-slate-800'>
    <input type='checkbox' aria-label={`Select page ${page}`} aria-describedby={slotsId} checked={selected.has(page)} disabled={importing || completed.has(page) || (!selected.has(page) && selectedCount >= remaining)} onChange={(event) => choose(page, event.target.checked)} className='h-5 w-5 shrink-0 accent-violet-600' />
    <span>Page {page}</span>
  </label>;

  return <dialog ref={dialog} data-pdf-import aria-labelledby={headingId} onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll('button,input,select,[tabindex="0"]')].filter((control) => !control.disabled && control.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} className='pdf-import-dialog text-slate-900 backdrop:bg-slate-950/55'>
    <div className='pdf-import-content'>
      <header className='pdf-import-header'>
        <div className='min-w-0'><h2 id={headingId} className='flex items-center gap-2 text-base font-bold'><FileText className='h-5 w-5 shrink-0 text-violet-600' aria-hidden='true' />Import PDF pages</h2><p className='mt-0.5 truncate text-xs text-slate-600' title={file.name}>{file.name}</p></div>
        <button type='button' aria-label='Close PDF import' onClick={onClose} className={`${button} h-11 w-11 shrink-0 px-0 text-slate-600 hover:bg-slate-100`}><X className='h-5 w-5' aria-hidden='true' /></button>
      </header>
      <div data-pdf-import-body className={`pdf-import-body ${previewPage ? 'pdf-import-preview' : ''}`}>
        {!document ? <div className='flex min-h-32 items-center justify-center p-4 text-center'><div><p role={loadError ? 'alert' : 'status'} className='text-sm text-slate-700'>{loadError || loadState}</p><p className='mt-2 text-xs text-slate-600'>No pages have been uploaded.</p></div></div> : previewPage ? <>
          <div className='flex shrink-0 flex-wrap items-center justify-between gap-2'><button type='button' onClick={() => setPreviewPage(null)} className={secondary}><ArrowLeft className='h-4 w-4' aria-hidden='true' />All pages</button>{checkbox(previewPage)}</div>
          <PagePreview key={previewPage} document={document} page={previewPage} />
        </> : <>
          <p className='text-sm leading-relaxed text-slate-600'>Choose the pages for this lesson. Your PDF and previews stay private until you import selected pages.</p>
          <div className='my-3 flex items-center gap-2'>
            <button type='button' aria-label='Previous page group' disabled={group === 0 || importing} onClick={() => setGroup((value) => value - 1)} className={`${secondary} w-11 shrink-0 px-0`}><ChevronLeft className='h-5 w-5' aria-hidden='true' /></button>
            <label className='min-w-0 flex-1'><span className='sr-only'>Pages to browse</span><select aria-label='Pages to browse' value={group} disabled={importing} onChange={(event) => setGroup(Number(event.target.value))} className='min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500'>{Array.from({ length: groups }, (_, index) => <option key={index} value={index}>Pages {index * PAGE_GROUP + 1}–{Math.min(document.numPages, (index + 1) * PAGE_GROUP)} of {document.numPages}</option>)}</select></label>
            <button type='button' aria-label='Next page group' disabled={group >= groups - 1 || importing} onClick={() => setGroup((value) => value + 1)} className={`${secondary} w-11 shrink-0 px-0`}><ChevronRight className='h-5 w-5' aria-hidden='true' /></button>
          </div>
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'>
            {pages.map((page) => <article key={page} data-pdf-page={page} className={`min-w-0 overflow-hidden rounded-xl border ${selected.has(page) ? 'border-violet-500 ring-1 ring-violet-500' : completed.has(page) ? 'border-emerald-300' : 'border-slate-200'}`}>
              <PageThumbnail document={document} page={page} disabled={importing} onPreview={setPreviewPage} />
              {checkbox(page)}
              {completed.has(page) && <p className='px-2 pb-2 text-xs font-semibold text-emerald-700'>{completed.get(page).placementFailed ? 'Imported. Add from Worksheets.' : 'Imported'}</p>}
              {failures.has(page) && <p className='px-2 pb-2 text-xs font-semibold text-rose-700'>{failures.get(page)}</p>}
            </article>)}
          </div>
        </>}
      </div>
      <footer data-pdf-import-footer className='pdf-import-footer'>
        <div id={slotsId} className='mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-slate-600'><span>{selectedCount} selected{completed.size ? ` · ${completed.size} imported` : ''}</span><span>{remaining} of {MAX_PICTURES} upload slots remaining</span></div>
        <p role='status' aria-live='polite' className='mb-2 text-xs leading-relaxed text-slate-700'>{progress ? `Importing page ${progress.page} (${progress.index} of ${progress.total})…` : notice || 'Only selected pages will be added to this lesson.'}</p>
        <div className='grid grid-cols-[1fr_2fr] gap-2'>
          <button type='button' onClick={importing ? cancelBatch : onClose} className={secondary}>{importing ? 'Stop import' : 'Cancel'}</button>
          <button type='button' disabled={importing || Boolean(loadError) || !document || (!finished && (!selectedCount || remaining < 1))} onClick={finished ? onClose : importSelected} className={primary}>{importing ? 'Importing…' : finished ? 'Done' : `${failures.size ? 'Retry' : 'Import'} ${selectedCount || ''} ${selectedCount === 1 ? 'page' : 'pages'}`}</button>
        </div>
      </footer>
    </div>
  </dialog>;
}
