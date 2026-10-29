import { MAX_PICTURE_BYTES } from '../../shared/pieces.js';

export const PDFJS_VERSION = '6.4.299';
export const MAX_PDF_BYTES = 20_000_000;
export const MAX_PDF_PAGES = 200;
export const MAX_PDF_RENDER_SIDE = 2400;
const THUMBNAIL_SIDE = 320;
const JPEG_QUALITIES = [0.94, 0.88, 0.8];

export class PdfWorksheetError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PdfWorksheetError';
    this.code = code;
  }
}

const aborted = () => new DOMException('PDF import cancelled', 'AbortError');
const checkSignal = (signal) => { if (signal?.aborted) throw aborted(); };

// Race only the caller's wait; its cancellation callback also stops actual rendering.
function withAbort(work, signals, cancel = () => {}) {
  return new Promise((resolve, reject) => {
    const listening = signals.filter(Boolean);
    const cleanup = () => listening.forEach((signal) => signal.removeEventListener('abort', onAbort));
    const onAbort = () => { cleanup(); cancel(); reject(aborted()); };
    if (listening.some((signal) => signal.aborted)) {
      // Observe a potentially already-started task even when cancellation wins.
      Promise.resolve(work).catch(() => {});
      onAbort();
      return;
    }
    listening.forEach((signal) => signal.addEventListener('abort', onAbort, { once: true }));
    Promise.resolve(work).then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
  });
}

function friendly(error) {
  if (error?.name === 'AbortError' || error instanceof PdfWorksheetError) return error;
  if (error?.name === 'PasswordException') return new PdfWorksheetError('encrypted', 'This PDF is password protected. Save an unlocked copy, then import it.', error);
  if (error?.name === 'InvalidPDFException' || error?.name === 'MissingPDFException') return new PdfWorksheetError('invalid-pdf', 'This PDF could not be read. Try opening it in Preview and saving a fresh PDF copy.', error);
  return new PdfWorksheetError('render', 'This PDF page could not be rendered. Try saving a fresh PDF copy.', error);
}

function encoded(canvas, type, quality, signals) {
  return withAbort(new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.size <= 0 || blob.type !== type) reject(new PdfWorksheetError('encoding', 'This browser could not prepare the worksheet image.'));
      else resolve(blob);
    }, type, quality);
  }), signals);
}

// No PDF is sent to the server here. Only explicit, prepared page images leave the
// importer later. Loading PDF.js and its same-origin worker is deferred until called.
export async function loadPdfWorksheet(file, { signal, onProgress } = {}) {
  checkSignal(signal);
  if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size <= 0) {
    throw new PdfWorksheetError('invalid-pdf', 'Choose a PDF worksheet to import.');
  }
  if (file.size > MAX_PDF_BYTES) throw new PdfWorksheetError('file-size', 'Choose a PDF smaller than 20 MB.');
  const bytes = new Uint8Array(await withAbort(file.arrayBuffer(), [signal]));
  if (bytes.byteLength > MAX_PDF_BYTES) throw new PdfWorksheetError('file-size', 'Choose a PDF smaller than 20 MB.');
  if (!new TextDecoder('ascii').decode(bytes.subarray(0, 1024)).includes('%PDF-')) {
    throw new PdfWorksheetError('invalid-pdf', 'This file is not a readable PDF.');
  }
  const [pdfjs, { default: workerUrl }] = await withAbort(Promise.all([
    import('pdfjs-dist/build/pdf.mjs'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]), [signal]);
  checkSignal(signal);
  if (pdfjs.version !== PDFJS_VERSION) throw new PdfWorksheetError('version', 'The PDF importer needs a page refresh. Please reload and try again.');
  const lifetime = new AbortController();
  let loadingTask;
  let worker;
  let port;
  let destroyed = false;
  let destroyPromise;
  let queue = Promise.resolve();
  const stopForSignal = () => { void destroy(); };
  const destroy = () => {
    if (destroyPromise) return destroyPromise;
    destroyed = true;
    lifetime.abort();
    signal?.removeEventListener('abort', stopForSignal);
    // Give the public PDF.js teardown a bounded opportunity to finish. A crashed
    // worker cannot acknowledge Terminate, so always release its real Worker too.
    destroyPromise = (async () => {
      let timer;
      try {
        await Promise.race([
          Promise.resolve(loadingTask?.destroy()).catch(() => {}),
          new Promise((resolve) => { timer = setTimeout(resolve, 1000); }),
        ]);
      } finally {
        clearTimeout(timer);
        worker?.destroy();
        port?.terminate();
      }
    })();
    return destroyPromise;
  };
  signal?.addEventListener('abort', stopForSignal, { once: true });
  const base = new URL(`${import.meta.env.BASE_URL}pdfjs/${PDFJS_VERSION}/`, document.baseURI).href;
  let rejectWorker;
  const workerFailure = new Promise((_, reject) => { rejectWorker = reject; });
  // A single rejected worker promise is observed by load/render races below.
  workerFailure.catch(() => {});
  try {
    port = new Worker(workerUrl, { type: 'module', name: 'worksheet-pdf' });
    port.addEventListener('error', () => rejectWorker(new PdfWorksheetError('worker', 'The PDF renderer could not start. Reload this page and try again.')));
    worker = new pdfjs.PDFWorker({ port });
    loadingTask = pdfjs.getDocument({
      data: bytes,
      worker,
      cMapUrl: `${base}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${base}standard_fonts/`,
      wasmUrl: `${base}wasm/`,
      iccUrl: `${base}iccs/`,
      useWorkerFetch: true,
      useSystemFonts: false,
      isEvalSupported: false,
      enableXfa: false,
      stopAtErrors: true,
      // Bound scratch image decoding while preserving the complete page content.
      canvasMaxAreaInBytes: 32 * 1024 * 1024,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    });
    if (onProgress) loadingTask.onProgress = ({ loaded, total }) => {
      if (!destroyed) onProgress({ loaded, total });
    };
    const pdf = await withAbort(Promise.race([loadingTask.promise, workerFailure]), [lifetime.signal]);
    if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1) throw new PdfWorksheetError('invalid-pdf', 'This PDF does not contain any pages.');
    if (pdf.numPages > MAX_PDF_PAGES) throw new PdfWorksheetError('too-many-pages', 'Choose a PDF with 200 pages or fewer.');
    if (pdf.isPureXfa) throw new PdfWorksheetError('unsupported', 'This PDF uses an interactive XFA form. Print or export it as a standard PDF first.');

    const renderPage = (pageNumber, { signal: pageSignal, maxSide = MAX_PDF_RENDER_SIDE } = {}) => {
      const signals = [lifetime.signal, pageSignal];
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) return Promise.reject(new PdfWorksheetError('page', 'Choose an existing page in this PDF.'));
      const requestedSide = Number.isFinite(maxSide) ? Math.round(maxSide) : MAX_PDF_RENDER_SIDE;
      const side = Math.max(32, Math.min(MAX_PDF_RENDER_SIDE, requestedSide));
      const operation = queue.catch(() => {}).then(async () => {
        checkSignal(lifetime.signal);
        checkSignal(pageSignal);
        let page;
        try {
          page = await withAbort(Promise.race([pdf.getPage(pageNumber), workerFailure]), signals);
          const original = page.getViewport({ scale: 1 }); // PDF.js includes the page's rotation.
          if (![original.width, original.height].every((n) => Number.isFinite(n) && n > 0)) throw new PdfWorksheetError('page', 'This PDF page has an invalid page size.');
          const minimumSide = Math.min(side, 1200);
          for (let target = side; ; target = Math.max(minimumSide, Math.floor(target * 0.8))) {
            checkSignal(lifetime.signal);
            checkSignal(pageSignal);
            const viewport = page.getViewport({ scale: target / Math.max(original.width, original.height) });
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(viewport.width));
            canvas.height = Math.max(1, Math.round(viewport.height));
            try {
              const context = canvas.getContext('2d', { alpha: false });
              if (!context) throw new PdfWorksheetError('canvas', 'This browser could not create the worksheet image.');
              const task = page.render({ canvasContext: context, viewport, background: '#ffffff', annotationMode: pdfjs.AnnotationMode.ENABLE });
              await withAbort(Promise.race([task.promise, workerFailure]), signals, () => task.cancel());
              const png = await encoded(canvas, 'image/png', undefined, signals);
              if (png.size <= MAX_PICTURE_BYTES) return { blob: png, w: canvas.width, h: canvas.height };
              for (const quality of JPEG_QUALITIES) {
                const jpeg = await encoded(canvas, 'image/jpeg', quality, signals);
                if (jpeg.size <= MAX_PICTURE_BYTES) return { blob: jpeg, w: canvas.width, h: canvas.height };
              }
            } finally {
              canvas.width = 0;
              canvas.height = 0;
            }
            if (target === minimumSide) throw new PdfWorksheetError('image-size', 'This page is too detailed to fit the worksheet image limit. Try exporting this page at a smaller size.');
          }
        } catch (error) {
          throw friendly(error);
        } finally {
          page?.cleanup();
        }
      });
      queue = operation.catch(() => {});
      return withAbort(operation, signals);
    };
    return {
      numPages: pdf.numPages,
      renderPage,
      thumbnail: (pageNumber, options = {}) => renderPage(pageNumber, { ...options, maxSide: THUMBNAIL_SIDE }),
      destroy,
    };
  } catch (error) {
    await destroy();
    throw friendly(error);
  }
}
