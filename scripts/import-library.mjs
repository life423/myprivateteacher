// Imports cards.csv and its images into Cosmos DB metadata + private Azure Blob Storage.
// npm run import-library -- <folder> [--dry-run]
// Optional cardid is a stable teaching-card ID. Legacy cards match collection + file or title.
// Preflight validates the entire batch and refuses duplicate or ambiguous matches before writes.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { imageType } from '../server/index.js';
import { CARDS, CONTAINER, DATABASE } from '../server/library.js';
import { MAX_PICTURE_BYTES, MAX_PICTURE_SIDE } from '../shared/pieces.js';
import { planLibraryImport, readCsv, readRegions, teachingMetadata } from './library-import.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function dimensions(bytes, type) {
  if (type === 'image/png' && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (type === 'image/jpeg') {
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      }
      const length = bytes.readUInt16BE(i + 2);
      if (length < 2) return null;
      i += 2 + length;
    }
  }
  return null;
}

function preflight(folder) {
  return readCsv(readFileSync(path.join(folder, 'cards.csv'), 'utf8')).map((row) => {
    if (!row.file) throw new Error('Every CSV row needs a file');
    const filename = path.resolve(folder, row.file);
    if (!filename.startsWith(`${folder}${path.sep}`)) throw new Error(`Image must be inside the import folder: ${row.file}`);
    const bytes = readFileSync(filename);
    const type = imageType(bytes);
    const size = type && dimensions(bytes, type);
    if (!size || !Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width <= 0 || size.height <= 0) {
      throw new Error(`Not a readable JPEG or PNG: ${row.file}`);
    }
    if (Math.max(size.width, size.height) > MAX_PICTURE_SIDE) throw new Error(`${row.file} exceeds the ${MAX_PICTURE_SIDE}px session limit`);
    if (bytes.length > MAX_PICTURE_BYTES) throw new Error(`${row.file} exceeds the ${MAX_PICTURE_BYTES / 1e6} MB session limit`);
    const order = row.order ? Number(row.order) : 0;
    if (!Number.isFinite(order) || order < 0) throw new Error(`Invalid teaching order: ${row.file}`);
    return {
      file: row.file, collection: row.collection || path.basename(folder),
      title: row.title || path.parse(row.file).name, order,
      sounds: (row.sounds || '').split(',').map((s) => s.trim()).filter(Boolean),
      note: row.note || '', regions: readRegions(row.regions, size),
      ...(row.cardid ? { cardId: row.cardid } : {}),
      ...teachingMetadata(row),
      bytes, type, ...size, sha256: sha256(bytes),
    };
  });
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const positional = args.filter((arg) => arg !== '--dry-run');
const { MONGODB_URI: uri, AZURE_STORAGE_ACCOUNT: account } = process.env;
if (positional.length !== 1 || positional[0].startsWith('-') || !uri || !account) {
  console.error('Usage: npm run import-library -- <folder with cards.csv> [--dry-run] (needs MONGODB_URI, AZURE_STORAGE_ACCOUNT and az login)');
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 30000, connectTimeoutMS: 8000, retryWrites: false });
try {
  const cards = preflight(path.resolve(positional[0]));
  // Check duplicate input identities/content before connecting to either service.
  planLibraryImport(cards, []);
  const records = client.db(DATABASE).collection(CARDS);
  const existingCards = await records.find({}, { projection: {
    collection: 1, file: 1, cardId: 1, title: 1, order: 1, sounds: 1, note: 1, regions: 1, image: 1,
    ipa: 1, keyword: 1, kind: 1, inventory: 1, category: 1,
  } }).toArray();
  const container = new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential()).getContainerClient(CONTAINER);
  // Old imports have no hash. Read their bytes to detect renamed duplicates too; this is read-only.
  for (const doc of existingCards) {
    if (doc.image?.path && !doc.image.sha256) doc.computedSha256 = sha256(await container.getBlobClient(doc.image.path).downloadToBuffer());
  }
  const plan = planLibraryImport(cards, existingCards);
  for (const item of plan) {
    const { card, existing, metadata, action, upload } = item;
    console.log(`  ${dryRun ? 'would ' : ''}${action}  ${card.file} (${card.title})${existing ? `  id ${existing._id}` : ''}${action !== 'skip' && !upload ? '  (image unchanged)' : ''}`);
    if (dryRun || action === 'skip') continue;
    const id = existing?._id ?? new ObjectId();
    const blobPath = existing?.image?.path || `pictures/${id}/original.${card.type === 'image/png' ? 'png' : 'jpg'}`;
    if (upload) await container.getBlockBlobClient(blobPath).uploadData(card.bytes, { blobHTTPHeaders: { blobContentType: card.type } });
    await records.updateOne({ _id: id }, {
      $set: { ...metadata, image: { path: blobPath, type: card.type, width: card.width, height: card.height, bytes: card.bytes.length, sha256: card.sha256 }, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    }, { upsert: true });
  }
  const counts = (action) => plan.filter((item) => item.action === action).length;
  console.log(`${dryRun ? 'Plan' : 'Import'}: ${counts('add')} add, ${counts('update')} update, ${counts('skip')} unchanged.${dryRun ? ' No writes made.' : ''}`);
} catch (error) {
  console.error(`Import stopped: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
