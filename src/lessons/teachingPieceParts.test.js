import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { regionAt } from '../whiteboard/regions.js';
import { partsForTeachingImage, selectionPartsForTeachingImage } from './teachingPieceParts.js';

const source = name => {
  const bytes = readFileSync(new URL(`../../content/lessons/short-a-teaching-pack/${name}.png`, import.meta.url));
  return { hash: createHash('sha256').update(bytes).digest('hex'), w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
};
const parts = name => { const image = source(name); return partsForTeachingImage(image.hash, image.w, image.h); };
const contains = (part, [left, top, right, bottom], margin = 8) => {
  expect(part.x).toBeLessThanOrEqual(left - margin);
  expect(part.y).toBeLessThanOrEqual(top - margin);
  expect(part.x + part.w).toBeGreaterThanOrEqual(right + margin);
  expect(part.y + part.h).toBeGreaterThanOrEqual(bottom + margin);
};

describe('reviewed individual teaching pieces', () => {
  it('recognizes the exact four checked-in PNGs and keeps every crop inside their teaching area', () => {
    for (const [name, count] of [['sound-cue', 7], ['word-work', 12], ['reading', 4], ['meaning', 4]]) {
      const image = source(name), choices = parts(name);
      expect(choices).toHaveLength(count);
      expect(new Set(choices.map(part => part.id)).size).toBe(count);
      for (const part of choices) {
        expect(part.id).toBeTruthy(); expect(part.label).toBeTruthy();
        expect([part.x, part.y, part.w, part.h].every(Number.isInteger)).toBe(true);
        expect(part.w).toBeGreaterThan(0); expect(part.h).toBeGreaterThan(0);
        expect(part.x).toBeGreaterThanOrEqual(0); expect(part.y).toBeGreaterThanOrEqual(390);
        expect(part.x + part.w).toBeLessThanOrEqual(image.w);
        // Exclude worksheet headings, page numbers and the footer rules/branding.
        expect(part.y + part.h).toBeLessThanOrEqual(1540);
        expect(part.y + part.h).toBeLessThanOrEqual(image.h);
        expect(Object.keys(part).every(key => ['id', 'label', 'x', 'y', 'w', 'h', 'letter', 'boxes', 'fontSize', 'content'].includes(key))).toBe(true);
      }
    }
  });

  it('keeps breve marks and descenders inside the marked-word crops with comfortable margins', () => {
    const choices = new Map(parts('word-work').map(part => [part.id, part]));
    // Dark glyph bounds measured on these exact PNGs; importantly p descends
    // below its baseline, and the breve rises above the ordinary a glyph.
    for (const [id, bounds] of [
      ['model-mat', [615, 413, 999, 588]],
      ['word-mat', [335, 1002, 574, 1112]], ['word-pat', [1055, 1002, 1253, 1140]],
      ['word-sat', [355, 1192, 549, 1302]], ['word-sap', [1034, 1192, 1265, 1330]],
      ['word-tap', [348, 1382, 548, 1520]], ['word-map', [1014, 1382, 1290, 1520]],
    ]) contains(choices.get(id), bounds);
    expect([...choices.values()].filter(part => part.id.startsWith('word-')).map(part => part.label)).toEqual(['măt', 'păt', 'săt', 'săp', 'tăp', 'măp']);
  });

  it('offers native plain-letter tiles separately from the source spelling marks', () => {
    const letters = parts('word-work').filter(part => part.letter);
    expect(letters.map(part => part.letter)).toEqual(['m', 'a', 't']);
    expect(letters.every(part => part.fontSize === 150)).toBe(true);
    const shortA = parts('sound-cue').find(part => part.letter);
    expect(shortA).toMatchObject({ id: 'short-a', letter: 'a', fontSize: 500 });
    contains(shortA, [319, 557, 557, 920]);
  });

  it('retains ordinary passage text and source font sizes for four independent sentence strips', () => {
    const choices = parts('reading');
    expect(choices.map(part => part.label)).toEqual(['Pat sat.', 'Tap, Pat, tap!', 'Pat sat.', 'Tap, tap, tap!']);
    expect(choices.every(part => part.fontSize === 128 && !part.letter)).toBe(true);
    const bounds = [[161, 473, 574, 566], [154, 731, 895, 848], [161, 989, 574, 1082], [154, 1247, 881, 1364]];
    choices.forEach((part, index) => contains(part, bounds[index]));
  });

  it('offers the three sound boxes as a native board control independently of their letters', () => {
    const boxes = parts('word-work').filter(part => part.boxes);
    expect(boxes).toEqual([{ id: 'sound-boxes', label: '3 sound boxes', x: 398, y: 653, w: 804, h: 230, boxes: 3 }]);
    expect(boxes[0].letter).toBeUndefined(); expect(boxes[0].fontSize).toBeUndefined();
  });

  it('separates object illustrations from their words and keeps sound cues independently selectable', () => {
    expect(parts('meaning').map(part => part.label)).toEqual(['Mat picture', 'mat', 'Map picture', 'map']);
    expect(parts('meaning').filter(part => part.fontSize).map(part => part.fontSize)).toEqual([200, 200]);
    expect(parts('sound-cue').map(part => part.id)).toEqual(['short-a', 'apple', 'mouth', 'diagram', 'open-jaw', 'lips', 'tongue']);
  });

  it('falls back safely for unknown bytes, incorrect dimensions or invalid hash input', () => {
    const image = source('word-work');
    expect(partsForTeachingImage('0'.repeat(64), image.w, image.h)).toEqual([]);
    expect(partsForTeachingImage(image.hash, 1600, 1699)).toEqual([]);
    expect(partsForTeachingImage(image.hash, '1600', 1700)).toEqual([]);
    for (const invalid of [undefined, null, '', '__proto__', {}, []]) expect(partsForTeachingImage(invalid, 1600, 1700)).toEqual([]);
    expect(partsForTeachingImage(image.hash.toUpperCase(), 1600, 1700)).toHaveLength(12);
  });

  it('returns fresh metadata so editing a selection cannot corrupt later source previews', () => {
    const first = parts('word-work'); first[0].x = -500; first[0].content.text = 'Changed'; first.pop();
    const next = parts('word-work');
    expect(next).toHaveLength(12); expect(next[0].x).toBe(595); expect(next[0].content.text).toBe('măt');
  });
});

const fineParts = name => { const image = source(name); return selectionPartsForTeachingImage(image.hash, image.w, image.h); };
const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe('fine native teaching selections', () => {
  it('separates every word-work letter body from its breve and neighboring glyphs', () => {
    const choices = fineParts('word-work');
    expect(choices).toHaveLength(31);
    expect(choices.filter(part => part.letter).map(part => part.letter).join('')).toBe('matmatmatpatsatsaptapmap');
    expect(choices.filter(part => part.content?.kind === 'breve')).toHaveLength(7);
    expect(new Set(choices.map(part => part.id)).size).toBe(31);
    for (const part of choices) {
      expect(part.kind).toBe(part.letter ? 'letter' : 'mark');
      expect(choices.filter(other => other !== part && intersects(part, other))).toEqual([]);
      expect(part.x).toBeGreaterThanOrEqual(0); expect(part.y).toBeGreaterThan(390);
      expect(part.x + part.w).toBeLessThan(1600); expect(part.y + part.h).toBeLessThan(1540);
    }
  });

  it('selects the model breve or a single letter instead of a whole word rectangle', () => {
    const regions = [...fineParts('word-work'), ...parts('word-work')];
    const mark = regionAt(regions, 868, 430);
    expect(mark).toMatchObject({ kind: 'mark', content: { kind: 'breve' } });
    expect(mark.y + mark.h).toBeLessThan(457);
    expect(regionAt(regions, 865, 520)).toMatchObject({ kind: 'letter', letter: 'a' });
    expect(regionAt(regions, 700, 520)).toMatchObject({ kind: 'letter', letter: 'm' });
    expect(regionAt(regions, 970, 520)).toMatchObject({ kind: 'letter', letter: 't' });
    expect(regionAt(regions, 491, 1012)).toMatchObject({ kind: 'mark', content: { kind: 'breve' } });
    expect(regionAt(regions, 491, 1060)).toMatchObject({ letter: 'a' });
  });

  it('rebuilds known words and reading strips as native text while retaining punctuation', () => {
    const wordWork = parts('word-work');
    expect(wordWork.find(part => part.id === 'model-mat').content).toEqual({ kind: 'text', text: 'măt' });
    expect(wordWork.filter(part => part.id.startsWith('word-')).map(part => part.content.text)).toEqual(['măt', 'păt', 'săt', 'săp', 'tăp', 'măp']);
    expect(parts('reading').map(part => part.content)).toEqual([
      { kind: 'text', text: 'Pat sat.' }, { kind: 'text', text: 'Tap, Pat, tap!' },
      { kind: 'text', text: 'Pat sat.' }, { kind: 'text', text: 'Tap, tap, tap!' },
    ]);
    expect(wordWork.find(part => part.id === 'breve')).toMatchObject({ label: 'Breve', content: { kind: 'breve' } });
    expect(parts('meaning').filter(part => part.fontSize).map(part => part.content.text)).toEqual(['mat', 'map']);
    expect(parts('sound-cue').filter(part => part.id !== 'short-a' && part.fontSize).map(part => part.content.text)).toEqual(['Open jaw.', 'Lips unrounded.', 'Tongue low and forward.']);
  });

  it('supports individual target letters in other reviewed sources without inventing image OCR', () => {
    expect(fineParts('reading').map(part => part.letter).join('')).toBe('PatsatTapPattapPatsatTaptaptap');
    expect(fineParts('meaning').map(part => part.letter).join('')).toBe('matmap');
    expect(fineParts('sound-cue').map(part => part.kind)).toEqual(['letter', 'mark']);
    const cue = fineParts('sound-cue');
    expect(cue[0].y).toBeGreaterThan(cue[1].y + cue[1].h);
    const image = source('word-work');
    for (const [hash, w, h] of [['0'.repeat(64), 1600, 1700], [image.hash, 1600, 1699], ['__proto__', 1600, 1700], [null, 1600, 1700]]) {
      expect(selectionPartsForTeachingImage(hash, w, h)).toEqual([]);
    }
    expect(selectionPartsForTeachingImage(image.hash.toUpperCase(), 1600, 1700)).toHaveLength(31);
  });

  it('does not let mutations of native content leak between source previews', () => {
    const choices = fineParts('word-work');
    choices.find(part => part.content).content.kind = 'changed'; choices[0].letter = 'x';
    const again = fineParts('word-work');
    expect(again[0].letter).toBe('m');
    expect(again.find(part => part.content).content).toEqual({ kind: 'breve' });
  });
});
