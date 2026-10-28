// Default: export only12 missing vowel cards into the existing grouped library.
// The full47 sound-specific cards are an explicit developer-reference opt-in.
// node scripts/render-phoneme-articulation.mjs [out folder] [local site] [--all-sounds]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { CARD } from '../src/articulation/cardLayout.js';
import { phonemeMouthRegions } from '../src/articulation/phonemeCardLayout.js';
import { phonemeExportPlan } from '../src/articulation/phonemeExport.js';

const args = process.argv.slice(2);
const allSounds = args.includes('--all-sounds');
const positional = args.filter((arg) => arg !== '--all-sounds');
if (positional.length > 2 || positional.some((arg) => arg.startsWith('-'))) throw new Error('Usage: node scripts/render-phoneme-articulation.mjs [out folder] [local site] [--all-sounds]');
const out = path.resolve(positional[0] || (allSounds ? 'phoneme-articulation-reference' : 'grouped-articulation-additions'));
const site = positional[1] || 'http://localhost:8080';
const plan = phonemeExportPlan({ allSounds });
const cell = (value) => { const text = String(value); return /[,;"\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; };
const rows = [['file', 'order', 'title', 'sounds', 'note', 'collection', 'regions', 'cardid', 'keyword', 'ipa', 'kind', 'inventory', 'category']];
const hashes = new Map();
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: CARD.width, height: CARD.height }, deviceScaleFactor: 1 });
  for (const { card, order, collection, cardId } of plan) {
    await page.goto(`${site}/dev/phoneme-articulation/${card.id}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const svg = page.locator(`[data-phoneme-card="${card.id}"]`);
    await svg.waitFor();
    const missing = await svg.getAttribute('data-missing-photo');
    if (missing) throw new Error(`Refusing to export ${card.id}: missing photo ${missing}`);
    const missingDiagram = await svg.getAttribute('data-missing-diagram');
    if (missingDiagram) throw new Error(`Refusing to export ${card.id}: missing diagram ${missingDiagram}`);
    await page.waitForTimeout(120);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: CARD.width, height: CARD.height } });
    const encoded = await page.evaluate(async (data) => { const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode(); const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height; canvas.getContext('2d').drawImage(img, 0, 0); return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]; }, png.toString('base64'));
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length > 1_500_000) throw new Error(`Card exceeds session image limit: ${card.id}`);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (hashes.has(digest)) throw new Error(`Duplicate rendered cards: ${hashes.get(digest)} and ${card.id}`);
    hashes.set(digest, card.id);
    const file = `${String(order).padStart(2, '0')}-phoneme-${card.id}.jpg`;
    writeFileSync(path.join(out, file), bytes);
    const regions = phonemeMouthRegions(card).map((r) => `${r.id}:${r.x},${r.y},${r.w},${r.h},${r.r}`).join(';');
    const note = [`/${card.ipa}/ as in ${card.keyword}.`, card.instruction, card.kind === 'sequence' ? `Sound sequence: /${card.ipa}/.` : '', card.dialectNote || card.note || ''].filter(Boolean).join(' ');
    const sounds = [...new Set(card.soundAliases?.length ? card.soundAliases : [card.displaySound || card.ipa])].filter(Boolean).join(', ');
    rows.push([file, order, `${card.title} — ${card.keyword}`, sounds, note, collection, regions, cardId, card.keyword, card.ipa, card.kind, card.inventory, card.category]);
    console.log(`  ${file}  ${Math.round(bytes.length / 1024)} KB`);
  }
  writeFileSync(path.join(out, 'cards.csv'), rows.map((row) => row.map(cell).join(',')).join('\n') + '\n');
  console.log(`Exported ${hashes.size} unique cards and cards.csv to ${out}`);
} finally { await browser.close(); }
