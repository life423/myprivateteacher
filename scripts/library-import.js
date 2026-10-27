import { isDeepStrictEqual } from 'node:util';

// Kept separate from the CLI so an import plan can be checked without credentials or writes.
export function readCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') field += '"', i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(field), field = '';
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('cards.csv has an unclosed quoted field');
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('cards.csv must contain a header and at least one card');
  const [header, ...body] = rows;
  const names = header.map((h) => h.trim().toLowerCase());
  if (!names.includes('file') || new Set(names).size !== names.length) throw new Error('cards.csv needs a file column and unique column names');
  return body.map((cells, i) => {
    if (cells.length > names.length) throw new Error(`cards.csv row ${i + 2} has too many fields`);
    return Object.fromEntries(names.map((name, n) => [name, (cells[n] ?? '').trim()]));
  });
}

export function readRegions(text, { width, height }) {
  const seen = new Set();
  return (text || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = /^([^:]+):([^:]+)$/.exec(part);
    if (!match) throw new Error(`Invalid region: ${part}`);
    const id = match[1].trim();
    const values = match[2].split(',').map((n) => n.trim());
    const [x, y, w, h, r = 0] = values.map(Number);
    if (seen.has(id) || ![4, 5].includes(values.length) || values.some((n) => !n) ||
      ![x, y, w, h, r].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 ||
      x + w > width || y + h > height || r < 0 || r > Math.min(w, h) / 2) throw new Error(`Invalid or duplicate region: ${part}`);
    seen.add(id);
    return { id, label: id.charAt(0).toUpperCase() + id.slice(1), x, y, w, h, r };
  });
}

const key = (value) => String(value || '').normalize('NFKC').trim().toLowerCase();
const sameCollection = (a, b) => key(a.collection) === key(b.collection);
const digest = (card) => card.sha256 || card.image?.sha256 || card.computedSha256;
export const cardMetadata = (card, existing) => ({
  collection: card.collection,
  file: card.file,
  order: card.order,
  title: card.title,
  sounds: card.sounds,
  note: card.note,
  regions: card.regions,
  ...(card.cardId || existing?.cardId ? { cardId: card.cardId || existing.cardId } : {}),
});

export function planLibraryImport(cards, existingCards) {
  const identities = new Map(), hashes = new Map(), claimed = new Set();
  for (const card of cards) {
    if (!/^[a-f0-9]{64}$/.test(digest(card) || '')) throw new Error(`Missing image SHA256 for ${card.file}`);
    for (const field of ['cardId', 'file', 'title']) {
      if (!key(card[field])) continue;
      const identity = `${key(card.collection)}:${field}:${key(card[field])}`;
      if (identities.has(identity)) throw new Error(`Duplicate CSV ${field}: ${card[field]}`);
      identities.set(identity, card);
    }
    if (hashes.has(digest(card))) throw new Error(`Duplicate image bytes in CSV: ${hashes.get(digest(card))} and ${card.file}`);
    hashes.set(digest(card), card.file);
  }
  return cards.map((card) => {
    const matches = existingCards.filter((doc) => sameCollection(doc, card) && ['cardId', 'file', 'title']
      .some((field) => key(card[field]) && key(card[field]) === key(doc[field])));
    if (matches.length > 1) throw new Error(`Ambiguous existing card for ${card.file}: ${matches.map((d) => String(d._id)).join(', ')}`);
    const existing = matches[0];
    if (card.cardId && existing?.cardId && key(card.cardId) !== key(existing.cardId)) throw new Error(`Conflicting stable card ID for ${card.file}`);
    const duplicate = existingCards.find((doc) => digest(doc) === digest(card) && doc !== existing);
    if (duplicate) throw new Error(`Image bytes already belong to another library card: ${duplicate.title || duplicate.file || duplicate._id}`);
    if (existing && claimed.has(String(existing._id))) throw new Error(`Several CSV rows target the same existing card: ${existing._id}`);
    if (existing) claimed.add(String(existing._id));
    const upload = !existing?.image?.path || digest(existing) !== digest(card);
    const metadata = cardMetadata(card, existing);
    const unchanged = existing && !upload && existing.image?.sha256 === digest(card) && Object.entries(metadata).every(([field, value]) => isDeepStrictEqual(existing[field], value));
    return { card, existing, metadata, upload, action: !existing ? 'add' : unchanged ? 'skip' : 'update' };
  });
}
