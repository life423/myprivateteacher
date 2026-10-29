import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('mongodb', () => ({ MongoClient: class { constructor(...args) { return mocked.createClient(...args); } } }));

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

function clientFixture() {
  const client = { connected: false };
  client.connect = vi.fn(async () => { client.connected = true; return client; });
  client.close = vi.fn(async () => { client.connected = false; });
  // Collection handles stay bound to this client, as they do in the real driver.
  const collection = { findOne: vi.fn(async () => {
    if (!client.connected) throw new Error('Topology is closed');
    return { title: 'Library card' };
  }) };
  client.db = vi.fn(() => ({ collection: () => collection }));
  return client;
}

let db, client;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  client = clientFixture();
  mocked.createClient.mockReset().mockReturnValue(client);
  db = await import('./db.js');
});
afterEach(async () => {
  await db.closeDatabases();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('shared database startup recovery', () => {
  it('deduplicates concurrent warmers and preserves one client for collection handles', async () => {
    const attempt = deferred();
    client.connect.mockReturnValueOnce(attempt.promise);
    expect(db.mongoClient('mongodb://fixture')).toBe(db.mongoClient('mongodb://fixture'));
    const first = db.warmDatabase('mongodb://fixture');
    const second = db.warmDatabase('mongodb://fixture');
    expect(first).toBe(second);
    await Promise.resolve();
    expect(client.connect).toHaveBeenCalledTimes(1);
    attempt.resolve(client);
    await Promise.all([first, second]);
    await db.warmDatabase('mongodb://fixture');
    expect(mocked.createClient).toHaveBeenCalledTimes(1);
    expect(mocked.createClient).toHaveBeenCalledWith('mongodb://fixture', expect.objectContaining({ retryWrites: false }));
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers an initial connection failure on the same client and previously bound collection', async () => {
    client.connect.mockRejectedValueOnce(new Error('Request blocked by network firewall'));
    const collection = db.mongoClient('mongodb://fixture').db('fixture').collection('pictures');
    await db.warmDatabase('mongodb://fixture');
    await expect(collection.findOne()).rejects.toThrow('Topology is closed');
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(client.connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(collection.findOne()).resolves.toEqual({ title: 'Library card' });
    expect(mocked.createClient).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(300000);
    expect(client.connect).toHaveBeenCalledTimes(2);
    // Recovery reconnects the driver; it does not replay a failed read or write.
    expect(collection.findOne).toHaveBeenCalledTimes(2);
  });

  it('uses one unreferenced retry timer with bounded backoff during a sustained outage', async () => {
    client.connect.mockRejectedValue(new Error('offline'));
    const timers = vi.spyOn(globalThis, 'setTimeout');
    await db.warmDatabase('mongodb://fixture');
    expect(timers.mock.results[0].value.hasRef()).toBe(false);
    await Promise.all([db.warmDatabase('mongodb://fixture'), db.warmDatabase('mongodb://fixture')]);
    expect(client.connect).toHaveBeenCalledTimes(1);
    for (const delay of [2000, 4000, 8000, 16000, 30000, 30000]) {
      expect(vi.getTimerCount()).toBe(1);
      const before = client.connect.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(client.connect).toHaveBeenCalledTimes(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(client.connect).toHaveBeenCalledTimes(before + 1);
    }
    expect(vi.getTimerCount()).toBe(1);
  });

  it('cancels scheduled retries at shutdown and cannot restart through another warmer', async () => {
    client.connect.mockRejectedValueOnce(new Error('offline'));
    await db.warmDatabase('mongodb://fixture');
    await db.closeDatabases();
    await vi.advanceTimersByTimeAsync(300000);
    await db.warmDatabase('mongodb://fixture');
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => db.mongoClient('mongodb://fixture')).toThrow('Database connections are closed');
  });

  it('closes a late successful connection before shutdown resolves', async () => {
    const attempt = deferred();
    client.connect.mockImplementationOnce(async () => {
      await attempt.promise;
      client.connected = true;
      return client;
    });
    const warming = db.warmDatabase('mongodb://fixture');
    await Promise.resolve();
    const closing = db.closeDatabases();
    expect(db.closeDatabases()).toBe(closing);
    await Promise.resolve();
    expect(client.close).toHaveBeenCalledTimes(1);
    attempt.resolve();
    await Promise.all([warming, closing]);
    expect(client.connected).toBe(false);
    expect(client.close).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(console.log).not.toHaveBeenCalled();
  });

  it('does not schedule recovery when an in-flight connection fails during shutdown', async () => {
    const attempt = deferred();
    client.connect.mockReturnValueOnce(attempt.promise);
    const warming = db.warmDatabase('mongodb://fixture');
    await Promise.resolve();
    const closing = db.closeDatabases();
    attempt.reject(new Error('connection interrupted'));
    await Promise.all([warming, closing]);
    await vi.advanceTimersByTimeAsync(300000);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('does not begin a queued connection after shutdown has already started', async () => {
    const warming = db.warmDatabase('mongodb://fixture');
    const closing = db.closeDatabases();
    await Promise.all([warming, closing]);
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.connected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves an unconfigured database disabled', async () => {
    await db.warmDatabase(undefined);
    expect(mocked.createClient).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
