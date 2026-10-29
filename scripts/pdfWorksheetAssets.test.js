import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { pdfWorksheetAssets } from './pdfWorksheetAssets.mjs';
import { PDFJS_VERSION } from '../src/whiteboard/pdfWorksheets.js';

const response = () => {
  const chunks = [];
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const stream = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  stream.headers = {};
  stream.setHeader = (name, value) => { stream.headers[name] = value; };
  stream.on('finish', finish);
  return { stream, done, chunks };
};

async function middleware() {
  const plugin = pdfWorksheetAssets();
  plugin.configResolved({ base: '/' });
  let handle;
  await plugin.configureServer({ middlewares: { use(fn) { handle = fn; } } });
  return handle;
}

describe('versioned same-origin PDF assets', () => {
  it('emits all four auxiliary families and license without the scripting sandbox', async () => {
    const plugin = pdfWorksheetAssets();
    const files = [];
    await plugin.generateBundle.call({ emitFile(file) { files.push(file); } });
    for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
      expect(files.some((file) => file.fileName.startsWith(`pdfjs/${PDFJS_VERSION}/${directory}/`))).toBe(true);
    }
    expect(files.some((file) => file.fileName === `pdfjs/${PDFJS_VERSION}/LICENSE`)).toBe(true);
    expect(files.some((file) => /quickjs|sandbox/.test(file.fileName))).toBe(false);
    expect(files.every((file) => file.source.length > 0 && file.type === 'asset')).toBe(true);
  });

  it('serves worker decoder WASM with the correct MIME type and stable version cache key', async () => {
    const handle = await middleware();
    const { stream, done, chunks } = response();
    const next = vi.fn();
    handle({ url: `/pdfjs/${PDFJS_VERSION}/wasm/openjpeg.wasm?v=1`, method: 'GET' }, stream, next);
    await done;
    expect(stream.headers['Content-Type']).toBe('application/wasm');
    expect(stream.headers['Cache-Control']).toContain('immutable');
    expect(Buffer.concat(chunks).subarray(0, 4)).toEqual(Buffer.from([0, 97, 115, 109]));
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['../../package.json', '%2e%2e/%2e%2e/.env', 'wasm/quickjs-eval.js', 'missing.bcmap'])('refuses unenumerated path %s', async (file) => {
    const handle = await middleware();
    const { stream, done } = response();
    handle({ url: `/pdfjs/${PDFJS_VERSION}/${file}`, method: 'GET' }, stream, vi.fn());
    await done;
    expect(stream.statusCode).toBe(404);
  });

  it('does not intercept other app routes or expose assets through mutating requests', async () => {
    const handle = await middleware();
    const next = vi.fn();
    handle({ url: '/api/me', method: 'GET' }, response().stream, next);
    expect(next).toHaveBeenCalledOnce();
    const { stream, done } = response();
    handle({ url: `/pdfjs/${PDFJS_VERSION}/wasm/openjpeg.wasm`, method: 'POST' }, stream, next);
    await done;
    expect(stream.statusCode).toBe(404);
  });
});
