// Saves each articulation card as a 1200 x 1200 picture, plus cards.csv for the library import.
// It needs a running copy of the site (npm run build, then npm start):
//   node scripts/render-articulation-cards.mjs [out folder] [site address]
//   npm run import-library -- <out folder>
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { ARTICULATION_CARDS } from '../src/data/articulationCards.js';
import { CARD, MOUTH_REGION } from '../src/articulation/cardLayout.js';

const out = path.resolve(process.argv[2] || 'articulation-cards');
const site = process.argv[3] || 'http://localhost:8080';
const COLLECTION = 'Mouth Pictures';
const QUOTE = String.fromCharCode(34);
const NEWLINE = String.fromCharCode(10);
const cell = (value) => {
  const text = String(value);
  return text.includes(',') || text.includes(';') || text.includes(QUOTE) ? QUOTE + text.split(QUOTE).join(QUOTE + QUOTE) + QUOTE : text;
};

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: CARD.width, height: CARD.height }, deviceScaleFactor: 1 });
const m = MOUTH_REGION;
const rows = [['file', 'order', 'title', 'sounds', 'note', 'collection', 'regions', 'cardid']];
for (const [i, card] of ARTICULATION_CARDS.entries()) {
  await page.goto(`${site}/dev/articulation-cards/${card.id}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: CARD.width, height: CARD.height } });
  // JPEG keeps every card well under the 1.5 MB a session picture may be.
  const jpeg = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + data;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, png.toString('base64'));
  const file = `${String(i + 1).padStart(2, '0')}-${card.id}.jpg`;
  const bytes = Buffer.from(jpeg, 'base64');
  writeFileSync(path.join(out, file), bytes);
  rows.push([file, i + 1, card.title, card.sounds.join(', '), card.instruction, COLLECTION, `mouth:${m.x},${m.y},${m.w},${m.h},${m.r}`, card.id]);
  console.log(`  ${file}  ${Math.round(bytes.length / 1024)} KB`);
}
writeFileSync(path.join(out, 'cards.csv'), rows.map((row) => row.map(cell).join(',')).join(NEWLINE) + NEWLINE);
console.log(`Saved ${ARTICULATION_CARDS.length} cards and cards.csv to ${out}`);
await browser.close();
