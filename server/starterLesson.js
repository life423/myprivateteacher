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
  let offset = 8, header, ended = false, palette = false;
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
    else if (type === 'PLTE') palette = length >= 3 && length <= 768 && length % 3 === 0;
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
  return { w: header.w, h: header.h, type: 'image/png', bytes: bytes.length, sha256: hash(bytes) };
}
const words = value => {
  if (typeof value !== 'string' || /\p{N}/u.test(value)) fail('The teaching text needs only the taught letters and ordinary punctuation.');
  const result = value.match(/\p{L}+/gu) || [];
  if (result.some(word => [...word.toLowerCase()].some(letter => !known.has(letter)))) fail('The teaching text contains an untaught letter.');
  return result.map(word => word.toLowerCase());
};

export function validateStarterTemplate(template, pngBytes) {
  if (!template || !isLessonId(template.id) || !Array.isArray(template.knownLetters) || !equal([...template.knownLetters].sort(), [...known].sort())) fail('The starter scope must explicitly be a, m, s, t and p.');
  if (!Array.isArray(template.wordChain) || template.wordChain.length < 2 || template.wordChain.some(word => typeof word !== 'string' || !/^[mstp]a[mstp]$/.test(word))) fail('The starter word chain needs short-a CVC words within the taught letters.');
  for (let index = 1; index < template.wordChain.length; index++) if ([...template.wordChain[index]].filter((letter, at) => letter !== template.wordChain[index - 1][at]).length !== 1) fail('Each word-chain step must change exactly one phoneme.');
  if (!Array.isArray(template.readingLines) || !template.readingLines.length || template.readingLines.length > 12 || template.readingLines.some(line => !words(line).length)) fail('The reading passage needs one to twelve nonempty, decodable lines.');
  const clean = cleanLessonInput(template);
  if (!equal(clean.activities.map(activity => activity.type), ['review', 'build', 'dictation', 'read'])) fail('The starter needs Review, Build words, Dictation and Read in order.');
  for (const activity of clean.activities) {
    words(activity.letters); if (activity.targets) words(activity.targets);
    if (activity.cardIds.length) fail('This first practice uses only its explicitly taught letters and original passage.');
    if (activity.reviewNextTime || activity.reviewNote) fail('A shared original template cannot contain learner review observations.');
    const projection = studentProjection(activity);
    if (['title', 'directions', 'targets', 'reviewNote', 'reviewNextTime'].some(field => Object.hasOwn(projection, field))) fail('Private teaching fields cannot enter student material.');
  }
  const [review, build, dictation, read] = clean.activities;
  if (![...known].every(letter => review.letters.toLowerCase().split(' ').includes(letter))) fail('Review must include the five known letters.');
  if (!equal(words(build.targets), template.wordChain) || build.boxes !== 3) fail('Build words must use the declared three-phoneme chain.');
  const available = build.letters.toLowerCase().split(' ');
  for (const word of template.wordChain) {
    const bank = [...available];
    for (const letter of word) { const at = bank.indexOf(letter); if (at < 0) fail('The prepared tile bank cannot make every word in the chain.'); bank.splice(at, 1); }
  }
  if (dictation.letters || dictation.cardIds.length || dictation.assetIds.length || studentProjection(dictation).letters) fail('Dictation must start with a blank writing area.');
  if (!dictation.targets.trim()) fail('Dictation needs tutor-private practice targets.');
  if (!template.asset || !isLessonId(template.asset.id) || template.asset.file !== 'reading.png' || !equal(read.assetIds, [template.asset.id]) || review.assetIds.length || build.assetIds.length || read.letters || read.cardIds.length) fail('Only Read may reference the single original reading image.');
  const image = preparedPng(pngBytes);
  if (template.asset.w !== image.w || template.asset.h !== image.h) fail('The declared reading image dimensions do not match the PNG.');
  return { content: clean, image };
}
