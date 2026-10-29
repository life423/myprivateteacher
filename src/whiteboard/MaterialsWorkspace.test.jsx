import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ refs: [], effects: [], area: null, resized: null }));
vi.mock('react', () => ({
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
  useRef: (initial) => { const ref = { current: runtime.refs.length ? initial : runtime.area }; runtime.refs.push(ref); return ref; },
  useLayoutEffect: (setup) => runtime.effects.push(setup),
  useEffect: () => {},
  useId: () => 'materials-test',
}));
import MaterialsWorkspace from './MaterialsWorkspace.jsx';
let cleanup;
beforeEach(() => {
  runtime.refs.length = 0; runtime.effects.length = 0;
  runtime.area = { scrollHeight: 60, clientHeight: 40, scrollTop: 0, firstElementChild: {} };
  vi.stubGlobal('sessionStorage', { getItem: () => JSON.stringify({ active: 'pictures', pictures: { query: '', scrollTop: 100 } }) });
  vi.stubGlobal('ResizeObserver', class { constructor(callback) { runtime.resized = callback; } observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { cleanup?.(); cleanup = null; vi.unstubAllGlobals(); });
function findScroll(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.props?.['data-materials-scroll']) return node;
  return [node.props?.children].flat(Infinity).map(findScroll).find(Boolean);
}
function mount() {
  const tree = MaterialsWorkspace({ scope: 'lesson', tabs: [{ id: 'pictures', label: 'Pictures', content: () => null }] });
  cleanup = runtime.effects[0]();
  expect(runtime.area.scrollTop).toBe(20); // content is still loading, so restoration stays pending
  return findScroll(tree);
}
describe('materials scroll restoration while content loads', () => {
  it('keeps restoring the saved position as content grows before user interaction', () => {
    mount(); runtime.area.scrollHeight = 300; runtime.resized();
    expect(runtime.area.scrollTop).toBe(100);
  });
  it('stops restoration when keyboard interaction takes over the scroll area', () => {
    const scroll = mount(); scroll.props.onKeyDownCapture({ key: 'PageDown' });
    runtime.area.scrollTop = 12;
    runtime.area.scrollHeight = 300; runtime.resized();
    expect(runtime.area.scrollTop).toBe(12);
  });
});
