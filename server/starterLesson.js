// Local teaching/source preflight shared by the immutable template publisher.
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { cleanLessonInput, isLessonId, studentProjection } from '../shared/lessons.js';
import { MAX_PICTURE_BYTES, MAX_PICTURE_SIDE } from '../shared/pieces.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw Object.assign(new Error(message), { seedMessage: true }); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const known = new Set(['a', 'm', 's', 't', 'p']);
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = bytes => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

// Validate the complete prepared PNG before constructing cloud adapters. Bounds
// include decompression, rather than trusting only the filename or IHDR claim.
export function preparedPng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_PICTURE_BYTES || bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail('The prepared reading PNG is missing or too large.');
  let offset = 8, header, ended = false, palette = false, paletteBytes, transparency;
  const data = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail('The prepared reading PNG is truncated.');
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) fail('The prepared reading PNG is truncated.');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail('The prepared reading PNG failed its integrity check.');
    if (!header && type !== 'IHDR') fail('The prepared reading PNG needs an image header.');
    if (type === 'IHDR') {
      if (header || length !== 13) fail('The prepared reading PNG has an invalid header.');
      const w = bytes.readUInt32BE(offset + 8), h = bytes.readUInt32BE(offset + 12), depth = bytes[offset + 16], color = bytes[offset + 17];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (![w, h].every(side => side > 0 && side <= MAX_PICTURE_SIDE) || !depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) fail('Use a bounded, non-interlaced prepared reading PNG.');
      header = { w, h, depth, color };
    } else if (type === 'IDAT') data.push(bytes.subarray(offset + 8, end - 4));
    else if (type === 'PLTE') { palette = length >= 3 && length <= 768 && length % 3 === 0; paletteBytes = bytes.subarray(offset + 8, end - 4); }
    else if (type === 'tRNS') transparency = bytes.subarray(offset + 8, end - 4);
    else if (type === 'IEND') { if (length !== 0 || end !== bytes.length) fail('The prepared reading PNG has an invalid ending.'); ended = true; }
    else if (type === 'acTL' || (type[0] === type[0].toUpperCase() && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type))) fail('Use a static prepared reading PNG.');
    offset = end;
  }
  if (!header || !ended || !data.length || (header.color === 3 && !palette)) fail('The prepared reading PNG is incomplete.');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.color];
  const stride = Math.ceil(header.w * channels * header.depth / 8) + 1;
  let pixels;
  try { pixels = inflateSync(Buffer.concat(data), { maxOutputLength: stride * header.h }); }
  catch { fail('The prepared reading PNG could not be decoded.'); }
  if (pixels.length !== stride * header.h) fail('The prepared reading PNG has inconsistent dimensions.');
  for (let row = 0; row < header.h; row++) if (pixels[row * stride] > 4) fail('The prepared reading PNG has an invalid row filter.');
  return { w: header.w, h: header.h, type: 'image/png', bytes: bytes.length, sha256: hash(bytes), renderHash: rasterHash(header, pixels, stride, channels, paletteBytes, transparency) };
}
// Normalize PNG scanline filters and color formats so ancillary metadata or a
// different compression/filter choice cannot disguise a duplicated teaching sheet.
function rasterHash({ w, h, depth, color }, pixels, stride, channels, palette, transparency) {
  const digest = createHash('sha256').update(`${w}x${h}:rgba8`), bpp = Math.max(1, Math.ceil(channels * depth / 8));
  let previous = Buffer.alloc(stride - 1);
  const rgba = Buffer.alloc(w * 4), max = 2 ** depth - 1;
  const paeth = (a, b, c) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c; };
  for (let y = 0; y < h; y++) {
    const filter = pixels[y * stride], row = Buffer.from(pixels.subarray(y * stride + 1, (y + 1) * stride));
    for (let i = 0; i < row.length; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = previous[i], c = i >= bpp ? previous[i - bpp] : 0;
      row[i] = (row[i] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? paeth(a, b, c) : 0)) & 255;
    }
    const sample = at => depth === 16 ? row.readUInt16BE(at * 2) : depth === 8 ? row[at] : (row[Math.floor(at * depth / 8)] >> (8 - depth - at * depth % 8)) & max;
    for (let x = 0; x < w; x++) {
      const at = x * channels, target = x * 4, scale = value => Math.round(value * 255 / max);
      let r, g, b, a = 255;
      if (color === 3) {
        const index = sample(at);
        if (index * 3 + 2 >= palette.length) fail('The prepared PNG has an invalid palette index.');
        [r, g, b] = palette.subarray(index * 3, index * 3 + 3); a = transparency?.[index] ?? 255;
      } else if (color === 0 || color === 4) {
        const gray = sample(at); r = g = b = scale(gray);
        if (color === 4) a = scale(sample(at + 1));
        else if (transparency?.length === 2 && gray === transparency.readUInt16BE(0)) a = 0;
      } else {
        const red = sample(at), green = sample(at + 1), blue = sample(at + 2);
        r = scale(red); g = scale(green); b = scale(blue);
        if (color === 6) a = scale(sample(at + 3));
        else if (transparency?.length === 6 && red === transparency.readUInt16BE(0) && green === transparency.readUInt16BE(2) && blue === transparency.readUInt16BE(4)) a = 0;
      }
      rgba[target] = a ? r : 0; rgba[target + 1] = a ? g : 0; rgba[target + 2] = a ? b : 0; rgba[target + 3] = a;
    }
    digest.update(rgba); previous = row;
  }
  return digest.digest('hex');
}

const PACK_ID = 'starter-short-a-amstp-v2', ORIGINAL_ID = 'starter-short-a-amstp-v1';
const PACK_ASSETS = ['sound-cue', 'word-work', 'reading', 'meaning'];
export function templateAssetSources(template) {
  if (template?.schemaVersion === 1) {
    if (!template.asset || !isLessonId(template.asset.id) || template.asset.file !== 'reading.png') fail('The template must use its prepared reading.png.');
    return [template.asset];
  }
  if (template?.schemaVersion !== 2 || template.id !== PACK_ID || template.familyId !== 'short-a-amstp' || template.edition !== 2 || template.supersedes !== ORIGINAL_ID) fail('The teaching pack needs its explicit immutable version and previous original.');
  if (!Array.isArray(template.assets) || template.assets.length !== PACK_ASSETS.length || !equal(template.assets.map(asset => asset?.id).sort(), [...PACK_ASSETS].sort())) fail('The teaching pack needs four distinct named image sources.');
  for (const asset of template.assets) {
    if (asset.file !== `${asset.id}.png` || asset.source !== `${asset.id}.svg` || asset.w !== 1600 || asset.h !== 1700 || typeof asset.purpose !== 'string' || !asset.purpose.trim() || asset.purpose.length > 160) fail('Each teaching sheet needs a safe PNG/SVG basename, purpose and 1600 by 1700 dimensions.');
  }
  return template.assets;
}
const words = value => {
  if (typeof value !== 'string' || /\p{N}/u.test(value)) fail('The teaching text needs only the taught letters and ordinary punctuation.');
  const result = value.match(/\p{L}+/gu) || [];
  if (result.some(word => [...word.toLowerCase()].some(letter => !known.has(letter)))) fail('The teaching text contains an untaught letter.');
  return result.map(word => word.toLowerCase());
};

export function validateStarterTemplate(template, imageBytes) {
  const sources = templateAssetSources(template), pack = template.schemaVersion === 2;
  if (!template || !isLessonId(template.id) || !Array.isArray(template.knownLetters) || !equal([...template.knownLetters].sort(), [...known].sort())) fail('The starter scope must explicitly be a, m, s, t and p.');
  if (!Array.isArray(template.wordChain) || template.wordChain.length < 2 || template.wordChain.some(word => typeof word !== 'string' || !/^[mstp]a[mstp]$/.test(word))) fail('The starter word chain needs short-a CVC words within the taught letters.');
  for (let index = 1; index < template.wordChain.length; index++) if ([...template.wordChain[index]].filter((letter, at) => letter !== template.wordChain[index - 1][at]).length !== 1) fail('Each word-chain step must change exactly one phoneme.');
  if (!Array.isArray(template.readingLines) || !template.readingLines.length || template.readingLines.length > 12 || template.readingLines.some(line => !words(line).length)) fail('The reading passage needs one to twelve nonempty, decodable lines.');
  const clean = cleanLessonInput(template);
  const types = pack ? ['review', 'read', 'read', 'build', 'dictation', 'read', 'read'] : ['review', 'build', 'dictation', 'read'];
  if (!equal(clean.activities.map(activity => activity.type), types)) fail('The starter needs its declared review, material, word-building, dictation and reading sequence.');
  for (const activity of clean.activities) {
    words(activity.letters); if (activity.targets) words(activity.targets);
    if (activity.cardIds.length) fail('This first practice uses only its explicitly taught letters and original passage.');
    if (activity.reviewNextTime || activity.reviewNote) fail('A shared original template cannot contain learner review observations.');
    const projection = studentProjection(activity);
    if (['title', 'directions', 'targets', 'reviewNote', 'reviewNextTime'].some(field => Object.hasOwn(projection, field))) fail('Private teaching fields cannot enter student material.');
  }
  const review = clean.activities[0], build = clean.activities[pack ? 3 : 1], dictation = clean.activities[pack ? 4 : 2];
  if (![...known].every(letter => review.letters.toLowerCase().split(' ').includes(letter)) || review.assetIds.length) fail('Review must include the five known plain-letter tiles.');
  if (!equal(words(build.targets), template.wordChain) || build.boxes !== 3 || build.assetIds.length) fail('Build words must use the declared three-phoneme chain.');
  const available = build.letters.toLowerCase().split(' ');
  for (const word of template.wordChain) {
    const bank = [...available];
    for (const letter of word) { const at = bank.indexOf(letter); if (at < 0) fail('The prepared tile bank cannot make every word in the chain.'); bank.splice(at, 1); }
  }
  if (dictation.letters || dictation.cardIds.length || dictation.assetIds.length || studentProjection(dictation).letters || pack && dictation.boxes !== 3) fail('Dictation must start with a blank writing area and its declared sound boxes.');
  if (!dictation.targets.trim()) fail('Dictation needs tutor-private practice targets.');
  const reads = clean.activities.filter(activity => activity.type === 'read');
  const expected = pack ? PACK_ASSETS : [template.asset.id];
  if (!equal(reads.map(activity => activity.assetIds), expected.map(id => [id])) || reads.some(activity => activity.letters || activity.cardIds.length || activity.boxes)) fail('Each material/reading activity must open its own single declared sheet.');
  const bytes = !pack && Buffer.isBuffer(imageBytes) ? new Map([[sources[0].id, imageBytes]]) : imageBytes;
  if (!(bytes instanceof Map) || !equal([...bytes.keys()].sort(), sources.map(asset => asset.id).sort())) fail('Provide the exact PNG byte map for all declared sheets.');
  const assets = sources.map(asset => {
    const data = bytes.get(asset.id), image = preparedPng(data);
    if (asset.w !== image.w || asset.h !== image.h) fail('The declared reading image dimensions do not match the PNG.');
    return { id: asset.id, ...image, ...(pack ? { purpose: asset.purpose.trim() } : {}), data };
  });
  if (pack && new Set(assets.map(asset => asset.renderHash)).size !== assets.length) fail('Teaching sheets must not contain duplicated rendered images.');
  return { content: clean, image: assets[0], assets };
}
