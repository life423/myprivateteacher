import { ObjectId } from 'mongodb';
import { mongoClient } from './db.js';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

// The picture library: one record per card in MongoDB (Azure Cosmos DB), each card's image in
// private Azure Blob Storage. Signing in to storage uses Azure identity (the app's own identity
// in Azure, your az login on a Mac), never keys. Off unless both settings are present.
export const DATABASE = 'myprivateteacher';
export const CARDS = 'pictures';
export const CONTAINER = 'library';

export function connectLibrary({ uri = process.env.MONGODB_URI, account = process.env.AZURE_STORAGE_ACCOUNT } = {}) {
  if (!uri || !account) return null;
  const client = mongoClient(uri);
  const cards = client.db(DATABASE).collection(CARDS);
  const storage = new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential());
  const container = storage.getContainerClient(CONTAINER);

  return {
    // Every card, series by series, in teaching order.
    async list() {
      const docs = await cards
        .find({}, { projection: { title: 1, sounds: 1, note: 1, collection: 1, order: 1, image: 1, regions: 1 } })
        .limit(1000)
        .toArray();
      return docs
        .filter((d) => d.image?.path)
        .map((d) => ({
          id: String(d._id),
          title: d.title,
          sounds: d.sounds || [],
          note: d.note || '',
          collection: d.collection || '',
          order: d.order ?? 0,
          w: d.image.width,
          h: d.image.height,
          regions: Array.isArray(d.regions) ? d.regions : [],
        }))
        .sort((a, b) => a.collection.localeCompare(b.collection) || a.order - b.order || a.title.localeCompare(b.title));
    },
    // One card's image, or null.
    async image(id) {
      if (!ObjectId.isValid(id)) return null;
      const card = await cards.findOne({ _id: new ObjectId(id) });
      if (!card?.image?.path) return null;
      const bytes = await container.getBlobClient(card.image.path).downloadToBuffer();
      return { bytes, w: card.image.width, h: card.image.height, title: card.title, regions: Array.isArray(card.regions) ? card.regions : [] };
    },
    close: () => {}, // the shared connection closes with the server
  };
}
