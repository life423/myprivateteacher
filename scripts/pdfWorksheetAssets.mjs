import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const directories = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
const types = { '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.js': 'text/javascript; charset=utf-8', '.icc': 'application/vnd.iccprofile' };

// Keep auxiliary font/decoder files beside their matching pinned PDF.js worker.
// Only installed, enumerated files are exposed: request paths are never joined to disk.
export function pdfWorksheetAssets() {
  let manifest;
  let base = '/';
  const assets = () => manifest ||= (async () => {
    const packageFile = require.resolve('pdfjs-dist/package.json');
    const root = path.dirname(packageFile);
    const { version } = JSON.parse(await readFile(packageFile, 'utf8'));
    const files = [];
    for (const directory of directories) {
      for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
        // The importer only paints pages. PDF JavaScript/sandbox assets are unnecessary.
        if (!entry.isFile() || entry.name.startsWith('quickjs')) continue;
        files.push({ name: `pdfjs/${version}/${directory}/${entry.name}`, file: path.join(root, directory, entry.name) });
      }
    }
    files.push({ name: `pdfjs/${version}/LICENSE`, file: path.join(root, 'LICENSE') });
    return { version, files };
  })();
  return {
    name: 'private-pdf-worksheet-assets',
    configResolved(config) { base = config.base; },
    async configureServer(server) {
      const { version, files } = await assets();
      const prefix = `${base}pdfjs/${version}/`;
      const byUrl = new Map(files.map((entry) => [`${base}${entry.name}`, entry.file]));
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (!url.startsWith(prefix)) return next();
        const file = byUrl.get(url);
        if (!file || !['GET', 'HEAD'].includes(req.method)) {
          res.statusCode = 404;
          res.end('PDF asset not found');
          return;
        }
        res.setHeader('Content-Type', types[path.extname(file)] || 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        if (req.method === 'HEAD') return res.end();
        createReadStream(file).on('error', () => { res.statusCode = 500; res.end(); }).pipe(res);
      });
    },
    async generateBundle() {
      const { files } = await assets();
      for (const entry of files) this.emitFile({ type: 'asset', fileName: entry.name, source: await readFile(entry.file) });
    },
  };
}
