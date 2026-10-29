import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the loader passed to React.lazy without mounting an unresolved Suspense tree.
vi.mock('react', async (original) => ({
  ...await original(),
  lazy: (load) => ({ load }),
}));
import { lazyPage, PageBoundary } from './lazyPage.jsx';

const marker = 'mpt-reloaded-for-update';
const failure = new Error('The page chunk could not be fetched');
let reload;
beforeEach(() => {
  reload = vi.fn();
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function pageWith(storage) {
  vi.stubGlobal('window', { sessionStorage: storage, location: { reload } });
  return lazyPage(() => Promise.reject(failure));
}

describe('lazy page update recovery', () => {
  it.each([
    ['unavailable', undefined],
    ['unreadable', { getItem: () => { throw new Error('Storage blocked'); } }],
    ['unwritable', { getItem: () => null, setItem: () => { throw new Error('Storage blocked'); } }],
  ])('passes the chunk error to the page boundary when storage is %s', async (_name, storage) => {
    const page = pageWith(storage);
    await expect(page.load()).rejects.toBe(failure);
    expect(reload).not.toHaveBeenCalled();
  });

  it('passes the chunk error through when accessing sessionStorage itself throws', async () => {
    const browser = { location: { reload } };
    Object.defineProperty(browser, 'sessionStorage', { get() { throw new Error('Storage blocked'); } });
    vi.stubGlobal('window', browser);
    const page = lazyPage(() => Promise.reject(failure));
    await expect(page.load()).rejects.toBe(failure);
    expect(reload).not.toHaveBeenCalled();
  });

  it('saves a marker before its one automatic reload and stops on the next failed load', async () => {
    const saved = new Map();
    const storage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
    const page = pageWith(storage);
    let settled = false;
    page.load().then(() => { settled = true; }, () => { settled = true; });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(saved.get(marker)).toBe('1000000');
    expect(settled).toBe(false); // Suspense stays pending while the browser reloads.

    const afterReload = lazyPage(() => Promise.reject(failure));
    await expect(afterReload.load()).rejects.toBe(failure);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('leaves a manual retry available when automatic recovery cannot run', async () => {
    const page = pageWith(undefined);
    await expect(page.load()).rejects.toBe(failure);
    const boundary = new PageBoundary({});
    boundary.state = PageBoundary.getDerivedStateFromError(failure);
    const children = boundary.render().props.children.props.children;
    const retry = children.find((child) => child.type === 'button');
    expect(retry.props.children).toBe('Try again');
    retry.props.onClick();
    expect(reload).toHaveBeenCalledOnce();
  });
});
