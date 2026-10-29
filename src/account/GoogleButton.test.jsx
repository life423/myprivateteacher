import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ refs: [], effects: [], updates: [], refresh: vi.fn() }));
vi.mock('react', () => ({
  useState: (initial) => [initial, (value) => runtime.updates.push(value)],
  useRef: (value) => { const ref = { current: runtime.refs.length === 0 ? {} : value }; runtime.refs.push(ref); return ref; },
  useEffect: (setup) => runtime.effects.push(setup),
}));
vi.mock('./account.js', () => ({ refreshAccount: runtime.refresh }));
import GoogleButton from './GoogleButton.jsx';
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
let callback, cleanup;
beforeEach(() => {
  callback = null; cleanup = null; runtime.refs.length = 0; runtime.effects.length = 0; runtime.updates.length = 0;
  runtime.refresh.mockReset().mockResolvedValue({ tutor: { id: 'tutor' } });
  vi.stubGlobal('window', { google: { accounts: { id: { initialize: (options) => { callback = options.callback; }, renderButton: vi.fn() } } } });
});
afterEach(() => { cleanup?.(); vi.unstubAllGlobals(); });
async function mount() {
  const signedIn = vi.fn(); GoogleButton({ clientId: 'client', onSignedIn: signedIn }); cleanup = runtime.effects[0]();
  await Promise.resolve(); expect(callback).toEqual(expect.any(Function)); return signedIn;
}

describe('Google sign-in callback lifetime', () => {
  it('ignores callbacks from a button whose effect already ended', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const signedIn = await mount();
    cleanup(); await callback({ credential: 'credential' });
    expect(fetcher).not.toHaveBeenCalled(); expect(signedIn).not.toHaveBeenCalled(); expect(runtime.updates).toEqual([]);
  });

  it('refreshes shared account state after success but does not navigate through an unmounted button', async () => {
    const reply = deferred(); vi.stubGlobal('fetch', vi.fn().mockReturnValue(reply.promise)); const signedIn = await mount();
    const signingIn = callback({ credential: 'credential' }); cleanup(); reply.resolve({ ok: true }); await signingIn;
    expect(runtime.refresh).toHaveBeenCalledOnce(); expect(signedIn).not.toHaveBeenCalled(); expect(runtime.updates).toEqual([null]);
  });

  it('does not publish a late error after its button is gone', async () => {
    const reply = deferred(); vi.stubGlobal('fetch', vi.fn().mockReturnValue(reply.promise)); await mount();
    const signingIn = callback({ credential: 'credential' }); cleanup(); reply.resolve({ ok: false, json: async () => ({ error: 'Denied' }) }); await signingIn;
    expect(runtime.refresh).not.toHaveBeenCalled(); expect(runtime.updates).toEqual([null]);
  });
});
