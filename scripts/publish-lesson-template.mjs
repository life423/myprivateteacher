// Publish a reviewed original once for every tutor. No account is selected and no
// private copy is created by this command; tutors choose Use this lesson in-app.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateStarterTemplate } from '../server/starterLesson.js';
import { connectLessonTemplates } from '../server/lessonTemplates.js';
import { closeDatabases } from '../server/db.js';

export function parsePublisherArguments(args) {
  if (!args.length) return {};
  if (args.length === 2 && args[0] === '--template' && args[1] && !args[1].startsWith('--')) return { template: args[1] };
  throw Object.assign(new Error('Use only an optional --template path; publication never selects a private owner.'), { seedMessage: true });
}
export async function publishOriginalTemplate({ templates, template, pngBytes }) {
  validateStarterTemplate(template, pngBytes); // before any repository/storage call
  return templates.publish(template, pngBytes);
}
async function main() {
  try {
    const options = parsePublisherArguments(process.argv.slice(2));
    const filename = options.template ? path.resolve(options.template) : fileURLToPath(new URL('../content/lessons/short-a-first-practice/lesson.json', import.meta.url));
    const template = JSON.parse(await readFile(filename, 'utf8'));
    if (template.asset?.file !== 'reading.png') throw Object.assign(new Error('The template must use its prepared reading.png.'), { seedMessage: true });
    const pngBytes = await readFile(path.join(path.dirname(filename), template.asset.file));
    validateStarterTemplate(template, pngBytes);
    const templates = connectLessonTemplates();
    if (!templates) throw Object.assign(new Error('Shared template storage is not configured.'), { seedMessage: true });
    console.log(JSON.stringify(await publishOriginalTemplate({ templates, template, pngBytes })));
  } catch (error) {
    console.error(JSON.stringify({ status: error.seedMessage || error.templateMessage ? error.message : 'The original template was not published or verified. Existing versions were not overwritten.' }));
    process.exitCode = 1;
  } finally { await closeDatabases(); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
