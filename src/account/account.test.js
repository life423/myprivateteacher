import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ updates: [], cleanups: [], effects: [], deferEffects: false }));
vi.mock('react', () => ({
  useState: (initial) => [initial, (value) => runtime.updates.push(value)],
  useEffect: (setup) => {
    if (runtime.deferEffects) runtime.effects.push(setup);
    else runtime.cleanups.push(setup());
  },
}));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const response = (data) => ({ ok: true, json: async () => data });
const anonymous = { tutor: null, signIn: { google: 'client' } };
const signedIn = { tutor: { id: 'tutor', name: 'Tutor' }, signIn: { google: 'client' } };
beforeEach(() => { vi.resetModules(); runtime.updates.length = 0; runtime.cleanups.length = 0; runtime.effects.length = 0; runtime.deferEffects = false; });
afterEach(() => { runtime.cleanups.splice(0).forEach((cleanup) => cleanup?.()); vi.unstubAllGlobals(); });

describe('shared account refresh ordering', () => {
  it('catches up when a refresh completes between rendering and subscribing', async () => {
    runtime.deferEffects = true;
    const request = deferred();
    const fetcher = vi.fn().mockReturnValue(request.promise); vi.stubGlobal('fetch', fetcher);
    const account = await import('./account.js');
    expect(account.useAccount().loading).toBe(true);
    const refreshed = account.refreshAccount(); await Promise.resolve();
    request.resolve(response(signedIn)); await refreshed;
    expect(runtime.updates).toEqual([]); // This component has not subscribed yet.
    runtime.cleanups.push(runtime.effects.shift()());
    expect(runtime.updates).toEqual([signedIn]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('deduplicates simultaneous initial account lookups from multiple components', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(anonymous)); vi.stubGlobal('fetch', fetcher);
    const account = await import('./account.js');
    account.useAccount(); account.useAccount();
    await vi.waitFor(() => expect(runtime.updates).toHaveLength(2));
    expect(fetcher).toHaveBeenCalledOnce();
    expect(runtime.updates).toEqual([anonymous, anonymous]);
  });

  it('does not let an older anonymous response undo a newer successful sign-in', async () => {
    const initial = deferred(), login = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(initial.promise).mockReturnValueOnce(login.promise); vi.stubGlobal('fetch', fetcher);
    const account = await import('./account.js'); account.useAccount();
    await Promise.resolve();
    const refreshing = account.refreshAccount(); await Promise.resolve();
    login.resolve(response(signedIn)); expect(await refreshing).toEqual(signedIn);
    initial.resolve(response(anonymous));
    await vi.waitFor(() => expect(runtime.updates).toHaveLength(1));
    await Promise.resolve(); await Promise.resolve();
    expect(runtime.updates).toEqual([signedIn]);
    expect(account.useAccount().tutor).toEqual(signedIn.tutor);
  });

  it('makes superseded refresh callers wait for the latest account state', async () => {
    const first = deferred(), second = deferred();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    const account = await import('./account.js');
    const older = account.refreshAccount(); await Promise.resolve();
    const newer = account.refreshAccount(); await Promise.resolve();
    first.resolve(response(anonymous)); await Promise.resolve();
    let oldSettled = false; older.then(() => { oldSettled = true; }); await Promise.resolve();
    expect(oldSettled).toBe(false);
    second.resolve(response(signedIn));
    expect(await older).toEqual(signedIn); expect(await newer).toEqual(signedIn);
  });

  it('forces fresh anonymous state after logout rather than reusing an earlier lookup', async () => {
    const old = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(response(anonymous));
    vi.stubGlobal('fetch', fetcher);
    const account = await import('./account.js');
    const earlier = account.refreshAccount(); await Promise.resolve();
    expect(await account.signOut()).toEqual(anonymous);
    old.resolve(response(signedIn)); expect(await earlier).toEqual(anonymous);
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/me', '/auth/logout', '/api/me']);
    expect(account.useAccount().tutor).toBeNull();
  });
});
