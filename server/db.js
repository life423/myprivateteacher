import { MongoClient } from 'mongodb';

// Keep the same client for library/account collections that were already created.
// An unsuccessful first connect can leave its topology closed, so explicitly retry
// that initial connection; after success the driver's own monitoring takes over.
const clients = new Map();
let shutdown = null;
const FIRST_RETRY_MS = 2000;
const MAX_RETRY_MS = 30000;

function connection(uri) {
  if (shutdown) throw new Error('Database connections are closed.');
  if (!clients.has(uri)) {
    clients.set(uri, {
      // Cosmos discovers a regional endpoint before authentication. Let that discovery
      // finish on slower networks, while bounding each individual connection.
      client: new MongoClient(uri, { serverSelectionTimeoutMS: 45000, connectTimeoutMS: 8000, retryWrites: false }),
      pending: null,
      timer: null,
      ready: false,
      closed: false,
      retryMs: FIRST_RETRY_MS,
    });
  }
  return clients.get(uri);
}

export function mongoClient(uri) {
  return connection(uri).client;
}

function connect(entry) {
  if (entry.closed || entry.ready || entry.timer) return Promise.resolve();
  if (entry.pending) return entry.pending;
  const started = Date.now();
  // Defer invocation so even a synchronous driver error shares the pending promise.
  entry.pending = Promise.resolve().then(() => entry.closed ? undefined : entry.client.connect()).then(() => {
    if (entry.closed) return;
    entry.ready = true;
    console.log(`Database connected in ${Date.now() - started} ms`);
  }).catch((error) => {
    if (entry.closed) return;
    console.warn(`Database not reachable yet: ${error.message}`);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void connect(entry);
    }, entry.retryMs);
    entry.timer.unref?.();
    entry.retryMs = Math.min(entry.retryMs * 2, MAX_RETRY_MS);
  }).finally(() => {
    entry.pending = null;
  });
  return entry.pending;
}

export function warmDatabase(uri) {
  if (!uri || shutdown) return Promise.resolve();
  return connect(connection(uri));
}

export function closeDatabases() {
  if (shutdown) return shutdown;
  const entries = [...clients.values()];
  for (const entry of entries) {
    entry.closed = true;
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  shutdown = Promise.resolve().then(async () => {
    await Promise.all(entries.map(async (entry) => {
      const pending = entry.pending;
      // Close immediately to interrupt discovery, then close a late successful connect
      // once more. No timer or in-flight attempt can reopen the client after shutdown.
      await entry.client.close().catch(() => {});
      if (pending) {
        await pending;
        await entry.client.close().catch(() => {});
      }
    }));
    clients.clear();
  });
  return shutdown;
}
