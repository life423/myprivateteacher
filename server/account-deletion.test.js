import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';
const fixture = vi.hoisted(() => ({ database: null }));
vi.mock('./db.js', () => ({ mongoClient: () => ({ db: () => fixture.database }) }));
import { connectAccounts } from './accounts.js';
let tutor, exists, session, collections;
beforeEach(() => {
  exists = true; session = true;
  tutor = { _id: new ObjectId('a'.repeat(24)), googleSub: 'verified-sub', email: 'tutor@example.test', name: 'Tutor' };
  collections = {
    tutors: { createIndex: async () => {}, findOne: vi.fn(async () => exists ? tutor : null), findOneAndUpdate: vi.fn(async () => tutor), updateOne: vi.fn(async (_query, update) => { Object.assign(tutor, update.$set); }), deleteOne: vi.fn(async () => { exists = false; }) },
    sessions: { findOne: vi.fn(async () => session ? { _id: 'fingerprint', tutorId: tutor._id, expiresAt: new Date(Date.now() + 100000) } : null), deleteMany: vi.fn(async () => { session = false; return { deletedCount: 1 }; }), insertOne: vi.fn() },
    grants: { deleteOne: vi.fn(async () => {}), findOneAndDelete: vi.fn(async () => null) }, activity: {},
  };
  fixture.database = { collection: name => collections[name] };
});

describe('account deletion with private lesson cleanup', () => {
  it('revokes sessions and blocks writes before cleanup, then removes the account', async () => {
    let accounts;
    const beforeDelete = vi.fn(async id => {
      expect(id).toBe(String(tutor._id)); expect(tutor.deletingAt).toBeInstanceOf(Date); expect(session).toBe(false);
      expect(await accounts.tutorFor('cached-token')).toBeNull(); expect(await accounts.isActive(id)).toBe(false); expect(exists).toBe(true);
    });
    accounts = connectAccounts({ uri: 'fixture', clientId: 'fixture-client', beforeDelete });
    expect(await accounts.tutorFor('cached-token')).not.toBeNull();
    expect(await accounts.deleteTutor(String(tutor._id))).toBe(true);
    expect(beforeDelete).toHaveBeenCalledOnce(); expect(exists).toBe(false);
  });
  it('retains a tombstone and denies sign-in after failed cleanup, then permits an admin retry', async () => {
    const beforeDelete = vi.fn().mockRejectedValueOnce(new Error('private cleanup unavailable')).mockResolvedValue(undefined);
    const accounts = connectAccounts({ uri: 'fixture', clientId: 'fixture-client', beforeDelete });
    await expect(accounts.deleteTutor(String(tutor._id))).rejects.toThrow('private cleanup unavailable');
    expect(exists).toBe(true); expect(session).toBe(false); expect(await accounts.isActive(String(tutor._id))).toBe(false);
    await expect(accounts.signIn({ googleSub: 'verified-sub', email: tutor.email, name: 'Tutor', picture: '' })).rejects.toThrow('being deleted');
    expect(collections.sessions.insertOne).not.toHaveBeenCalled();
    expect(await accounts.deleteTutor(String(tutor._id))).toBe(true); expect(exists).toBe(false);
  });
  it('does not run cleanup for a missing or invalid account', async () => {
    const beforeDelete = vi.fn();
    const accounts = connectAccounts({ uri: 'fixture', clientId: 'fixture-client', beforeDelete });
    expect(await accounts.deleteTutor('invalid')).toBe(false); exists = false;
    expect(await accounts.deleteTutor(String(tutor._id))).toBe(false); expect(beforeDelete).not.toHaveBeenCalled();
  });
});
