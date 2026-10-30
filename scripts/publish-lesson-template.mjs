// Publish a reviewed original once for every tutor. No account is selected and no
// private copy is created by this command; tutors choose Use this lesson in-app.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { templateAssetSources, validateStarterTemplate } from '../server/starterLesson.js';
import { connectLessonTemplates } from '../server/lessonTemplates.js';
import { closeDatabases } from '../server/db.js';
import { MAX_PICTURE_BYTES } from '../shared/pieces.js';

export function parsePublisherArguments(args) {
  if (!args.length) return {};
  if (args.length === 2 && args[0] === '--template' && args[1] && !args[1].startsWith('--')) return { template: args[1] };
  throw Object.assign(new Error('Use only an optional --template path; publication never selects a private owner.'), { seedMessage: true });
}
export async function publishOriginalTemplate({ templates, template, assetBytes, pngBytes }) {
  const sources = assetBytes ?? pngBytes;
  validateStarterTemplate(template, sources); // all sources before any storage call
  return templates.publish(template, sources);
}
export async function loadTemplateSources(filename) {
  const bounded = async (file, max) => {
    const info = await stat(file);
    if (!info.isFile() || info.size > max) throw Object.assign(new Error('The original source file is missing or too large.'), { seedMessage: true });
    return readFile(file);
  };
  const template = JSON.parse((await bounded(filename, 256 * 1024)).toString('utf8'));
  const manifest = templateAssetSources(template); // validate names before opening any image
  const assetBytes = new Map(await Promise.all(manifest.map(async asset => [asset.id, await bounded(path.join(path.dirname(filename), asset.file), MAX_PICTURE_BYTES)])));
  validateStarterTemplate(template, assetBytes);
  return { template, assetBytes };
}
async function main() {
  try {
    const options = parsePublisherArguments(process.argv.slice(2));
    const filename = options.template ? path.resolve(options.template) : fileURLToPath(new URL('../content/lessons/short-a-teaching-pack/lesson.json', import.meta.url));
    const { template, assetBytes } = await loadTemplateSources(filename);
    const templates = connectLessonTemplates();
    if (!templates) throw Object.assign(new Error('Shared template storage is not configured.'), { seedMessage: true });
    console.log(JSON.stringify(await publishOriginalTemplate({ templates, template, assetBytes })));
  } catch (error) {
    console.error(JSON.stringify({ status: error.seedMessage || error.templateMessage ? error.message : 'The original template was not published or verified. Existing versions were not overwritten.' }));
    process.exitCode = 1;
  } finally { await closeDatabases(); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
