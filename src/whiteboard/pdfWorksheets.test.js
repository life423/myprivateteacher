import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pdfjs = vi.hoisted(() => ({ getDocument: vi.fn(), workers: [], version: '6.4.299' }));
vi.mock('pdfjs-dist/build/pdf.mjs', () => ({
  version: pdfjs.version,
  getDocument: pdfjs.getDocument,
  PDFWorker: class {
    constructor({ port }) { this.port = port; this.destroy = vi.fn(); pdfjs.workers.push(this); }
  },
  VerbosityLevel: { ERRORS: 0 },
  AnnotationMode: { ENABLE: 1 },
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/assets/pdf.worker.test.mjs' }));

import { loadPdfWorksheet, MAX_PDF_BYTES, MAX_PDF_PAGES, PDFJS_VERSION } from './pdfWorksheets.js';

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const source = () => new Blob(['%PDF-1.7\nmock-document-for-loader-tests']);
let ports;
let canvases;
let pages;
let documentProxy;
let loading;
let encode;
let open;

beforeEach(() => {
  ports = [];
  canvases = [];
  pages = [];
  open = [];
  pdfjs.workers.length = 0;
  pdfjs.getDocument.mockReset();
  encode = (type) => ({ type, size: 400 });
  vi.stubGlobal('Worker', class {
    constructor(url, options) { this.url = url; this.options = options; this.listeners = {}; this.terminate = vi.fn(); ports.push(this); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
  });
  vi.stubGlobal('document', {
    baseURI: 'https://myprivateteacher.test/whiteboard/teach',
    createElement(kind) {
      expect(kind).toBe('canvas');
      const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ canvas })), toBlob: vi.fn((callback, type, quality) => callback(encode(type, quality))) };
      canvases.push(canvas);
      return canvas;
    },
  });
  documentProxy = {
    numPages: 3,
    getPage: vi.fn(async () => {
      const page = {
        getViewport: vi.fn(({ scale }) => ({ width: 100 * scale, height: 200 * scale })),
        render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
        cleanup: vi.fn(),
      };
      pages.push(page);
      return page;
    }),
  };
  loading = { promise: Promise.resolve(documentProxy), destroy: vi.fn(async () => {}) };
  pdfjs.getDocument.mockImplementation(() => loading);
});

afterEach(async () => {
  await Promise.all(open.map((pdf) => pdf.destroy()));
  vi.unstubAllGlobals();
});

async function loaded(options) {
  const pdf = await loadPdfWorksheet(source(), options);
  open.push(pdf);
  return pdf;
}

describe('private PDF worksheet rendering', () => {
  it('rejects invalid/oversized inputs before loading the PDF runtime or starting a worker', async () => {
    await expect(loadPdfWorksheet(new Blob(['ordinary image bytes']))).rejects.toMatchObject({ code: 'invalid-pdf' });
    await expect(loadPdfWorksheet({ size: MAX_PDF_BYTES + 1, arrayBuffer: vi.fn() })).rejects.toMatchObject({ code: 'file-size' });
    await expect(loadPdfWorksheet(new Blob([]))).rejects.toMatchObject({ code: 'invalid-pdf' });
    await expect(loadPdfWorksheet({ size: 100, arrayBuffer: async () => new ArrayBuffer(MAX_PDF_BYTES + 1) })).rejects.toMatchObject({ code: 'file-size' });
    expect(pdfjs.getDocument).not.toHaveBeenCalled();
    expect(ports).toHaveLength(0);
  });

  it('loads only provided bytes and pinned, same-origin assets without scripting or system-font substitution', async () => {
    const pdf = await loaded();
    expect(pdf.numPages).toBe(3);
    expect(ports[0]).toMatchObject({ url: '/assets/pdf.worker.test.mjs', options: { type: 'module', name: 'worksheet-pdf' } });
    expect(pdfjs.getDocument).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.any(Uint8Array), worker: pdfjs.workers[0],
      cMapUrl: `https://myprivateteacher.test/pdfjs/${PDFJS_VERSION}/cmaps/`,
      standardFontDataUrl: `https://myprivateteacher.test/pdfjs/${PDFJS_VERSION}/standard_fonts/`,
      wasmUrl: `https://myprivateteacher.test/pdfjs/${PDFJS_VERSION}/wasm/`,
      iccUrl: `https://myprivateteacher.test/pdfjs/${PDFJS_VERSION}/iccs/`,
      useSystemFonts: false, enableXfa: false, stopAtErrors: true, isEvalSupported: false,
    }));
    expect(pdfjs.getDocument.mock.calls[0][0]).not.toHaveProperty('url');
    expect(pdfjs.getDocument.mock.calls[0][0]).not.toHaveProperty('password');
  });

  it('keeps lossless text pages as PNG at 2400px and frees canvas storage after encoding', async () => {
    const pdf = await loaded();
    const result = await pdf.renderPage(2);
    expect(result).toEqual({ blob: { type: 'image/png', size: 400 }, w: 1200, h: 2400 });
    expect(documentProxy.getPage).toHaveBeenCalledWith(2);
    expect(canvases[0].toBlob).toHaveBeenCalledTimes(1);
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 });
    expect(pages[0].cleanup).toHaveBeenCalledOnce();
    expect(pages[0].render.mock.calls[0][0]).toMatchObject({ background: '#ffffff', annotationMode: 1 });
  });

  it('uses the rotated PDF viewport and bounds requested render/thumbnail sizes', async () => {
    documentProxy.getPage.mockImplementation(async () => ({ getViewport: ({ scale }) => ({ width: 200 * scale, height: 100 * scale }), render: () => ({ promise: Promise.resolve() }), cleanup() {} }));
    const pdf = await loaded();
    expect(await pdf.renderPage(1, { maxSide: 99999 })).toMatchObject({ w: 2400, h: 1200 });
    expect(await pdf.thumbnail(1, { maxSide: 99999 })).toMatchObject({ w: 320, h: 160 });
    await expect(pdf.renderPage(0)).rejects.toMatchObject({ code: 'page' });
    await expect(pdf.renderPage(4)).rejects.toMatchObject({ code: 'page' });
  });

  it('tries bounded JPEG quality before reducing page resolution', async () => {
    encode = (type, quality) => ({ type, size: type === 'image/jpeg' && quality === 0.88 ? 900_000 : 1_600_000 });
    const pdf = await loaded();
    const result = await pdf.renderPage(1);
    expect(result).toMatchObject({ blob: { type: 'image/jpeg', size: 900_000 }, w: 1200, h: 2400 });
    expect(pages[0].render).toHaveBeenCalledOnce();
    expect(canvases[0].toBlob.mock.calls.map(([, type, quality]) => [type, quality])).toEqual([['image/png', undefined], ['image/jpeg', 0.94], ['image/jpeg', 0.88]]);
  });

  it('bounds encoding attempts and refuses an oversized page instead of emitting unusable bytes', async () => {
    encode = (type) => ({ type, size: 1_500_001 });
    const pdf = await loaded();
    await expect(pdf.renderPage(1)).rejects.toMatchObject({ code: 'image-size' });
    expect(pages[0].render).toHaveBeenCalledTimes(5); // 2400,1920,1536,1228,1200; never below1200.
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });

  it('serializes thumbnails and full pages rather than allocating concurrent page canvases', async () => {
    const first = deferred();
    const pdf = await loaded();
    const original = documentProxy.getPage.getMockImplementation();
    documentProxy.getPage.mockImplementation(async (...args) => {
      const page = await original(...args);
      if (pages.length === 1) page.render.mockReturnValueOnce({ promise: first.promise, cancel: vi.fn() });
      return page;
    });
    const a = pdf.renderPage(1);
    const b = pdf.thumbnail(2);
    await tick();
    expect(documentProxy.getPage).toHaveBeenCalledTimes(1);
    expect(canvases).toHaveLength(1);
    first.resolve();
    await a;
    expect(await b).toMatchObject({ w: 160, h: 320 });
    expect(documentProxy.getPage).toHaveBeenCalledTimes(2);
  });

  it('cancels only an aborted page render and lets a following page continue', async () => {
    const active = deferred();
    const cancel = vi.fn(() => active.reject(new Error('render cancelled')));
    const pdf = await loaded();
    const original = documentProxy.getPage.getMockImplementation();
    documentProxy.getPage.mockImplementation(async (...args) => {
      const page = await original(...args);
      if (pages.length === 1) page.render.mockReturnValueOnce({ promise: active.promise, cancel });
      return page;
    });
    const controller = new AbortController();
    const a = pdf.renderPage(1, { signal: controller.signal });
    const rejected = expect(a).rejects.toMatchObject({ name: 'AbortError' });
    await tick();
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(await pdf.thumbnail(2)).toMatchObject({ w: 160, h: 320 });
    expect(canvases.every((canvas) => canvas.width === 0)).toBe(true);
  });

  it('rejects queued work on destroy and terminates its worker once, without rendering again', async () => {
    const pdf = await loaded();
    await pdf.destroy();
    await pdf.destroy();
    await expect(pdf.renderPage(1)).rejects.toMatchObject({ name: 'AbortError' });
    expect(documentProxy.getPage).not.toHaveBeenCalled();
    expect(loading.destroy).toHaveBeenCalledOnce();
    expect(pdfjs.workers[0].destroy).toHaveBeenCalledOnce();
    expect(ports[0].terminate).toHaveBeenCalledOnce();
  });

  it('aborts document loading and releases both worker layers even before a page is available', async () => {
    loading.promise = new Promise(() => {});
    const controller = new AbortController();
    const work = loadPdfWorksheet(source(), { signal: controller.signal });
    const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(pdfjs.getDocument).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect(loading.destroy).toHaveBeenCalledOnce();
    expect(ports[0].terminate).toHaveBeenCalledOnce();
  });

  it.each([
    ['PasswordException', 'encrypted'],
    ['InvalidPDFException', 'invalid-pdf'],
  ])('turns %s into a clear error and frees its worker', async (name, code) => {
    pdfjs.getDocument.mockImplementation(() => ({ ...loading, promise: Promise.reject(Object.assign(new Error('PDF parser detail'), { name })) }));
    await expect(loadPdfWorksheet(source())).rejects.toMatchObject({ code });
    expect(ports[0].terminate).toHaveBeenCalledOnce();
  });

  it('rejects over-limit and XFA documents before allocating page canvases', async () => {
    documentProxy.numPages = MAX_PDF_PAGES + 1;
    await expect(loadPdfWorksheet(source())).rejects.toMatchObject({ code: 'too-many-pages' });
    documentProxy.numPages = 1;
    documentProxy.isPureXfa = true;
    await expect(loadPdfWorksheet(source())).rejects.toMatchObject({ code: 'unsupported' });
    expect(canvases).toHaveLength(0);
    expect(ports.every((port) => port.terminate.mock.calls.length === 1)).toBe(true);
  });

  it('reports worker startup errors without a main-thread fake-worker fallback', async () => {
    loading.promise = new Promise(() => {});
    const work = loadPdfWorksheet(source());
    const rejected = expect(work).rejects.toMatchObject({ code: 'worker' });
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    ports[0].listeners.error();
    await rejected;
    expect(ports[0].terminate).toHaveBeenCalledOnce();
  });
});
