import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const effects = vi.hoisted(() => []);
vi.mock('react', () => ({ startTransition: fn => fn(), useEffect: setup => effects.push(setup), useState: initial => [initial(), vi.fn()], useRef: value => ({ current: value }) }));
let router, entries, index, url, events, cleanups;
beforeEach(async () => {
  vi.resetModules(); effects.length = 0; cleanups = []; events = new Map(); entries = [{ url: '/', state: null }]; index = 0; url = new URL('https://example.test/');
  const visit = value => { url = new URL(value, url); };
  const history = {
    get state() { return entries[index].state; },
    replaceState(state, _, target) { entries[index] = { state, url: target }; visit(target); },
    pushState(state, _, target) { entries.splice(index + 1); entries.push({ state, url: target }); index++; visit(target); },
    go(delta) { index += delta; visit(entries[index].url); for (const callback of events.get('popstate') || []) callback({}); },
  };
  vi.stubGlobal('window', { get location() { return url; }, history, scrollTo: vi.fn(), confirm: vi.fn(), addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); }, removeEventListener(name, fn) { events.get(name)?.delete(fn); } });
  router = await import('./router.jsx'); router.useRoute(); cleanups.push(effects.shift()());
});
afterEach(() => { cleanups.forEach(cleanup => cleanup?.()); vi.unstubAllGlobals(); });
describe('unsaved lesson navigation protection', () => {
  it('cancels programmatic/Link navigation without changing the URL or history', () => {
    const guard = vi.fn().mockReturnValue(false); cleanups.push(router.registerNavigationGuard(guard));
    expect(router.navigate('/lessons/plan')).toBe(false); expect(url.pathname).toBe('/'); expect(entries).toHaveLength(1);
  });
  it('restores a canceled Back without adding entries, then permits Back and Forward', () => {
    router.navigate('/lessons'); router.navigate('/lessons/plan');
    const guard = vi.fn().mockReturnValueOnce(false).mockReturnValue(true); cleanups.push(router.registerNavigationGuard(guard));
    window.history.go(-1); expect(url.pathname).toBe('/lessons/plan'); expect(index).toBe(2); expect(entries).toHaveLength(3); expect(guard).toHaveBeenCalledOnce();
    window.history.go(-1); expect(url.pathname).toBe('/lessons'); window.history.go(1); expect(url.pathname).toBe('/lessons/plan');
  });
  it('keeps teaching query strings and supports replace without creating an extra entry', () => {
    expect(router.navigate('/whiteboard/teach?lesson=plan')).toBe(true); expect(url.search).toBe('?lesson=plan');
    router.navigate('/lessons/plan', { replace: true }); expect(entries).toHaveLength(2); expect(url.pathname).toBe('/lessons/plan');
  });
  it('reads current dirty state synchronously after a save and protects native reload only while dirty', () => {
    let dirty = true; router.useNavigationGuard(() => dirty, 'Discard draft?'); cleanups.push(effects.shift()());
    const event = { preventDefault: vi.fn() }; for (const callback of events.get('beforeunload')) callback(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    window.confirm.mockReturnValue(false); expect(router.navigate('/account')).toBe(false); expect(window.confirm).toHaveBeenCalledWith('Discard draft?');
    dirty = false; expect(router.navigate('/account')).toBe(true); expect(window.confirm).toHaveBeenCalledOnce();
  });
});
