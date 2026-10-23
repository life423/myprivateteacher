import { MongoClient } from 'mongodb';

// One database connection for the whole server (the picture library and tutor accounts share
// it), opened when the server starts so the first visitor doesn't wait for it.
const clients = new Map();

export function mongoClient(uri) {
  if (!clients.has(uri)) clients.set(uri, new MongoClient(uri, { serverSelectionTimeoutMS: 10000, retryWrites: false }));
  return clients.get(uri);
}

export async function warmDatabase(uri) {
  if (!uri) return;
  const started = Date.now();
  try {
    await mongoClient(uri).connect();
    console.log(`Database connected in ${Date.now() - started} ms`);
  } catch (error) {
    console.warn(`Database not reachable yet: ${error.message}`);
  }
}

export async function closeDatabases() {
  await Promise.all([...clients.values()].map((client) => client.close().catch(() => {})));
  clients.clear();
}
