import { afterEach, describe, expect, it, vi } from 'vitest';
const test = vi.hoisted(() => ({ current: null, list: vi.fn(), copy: vi.fn(), navigate: vi.fn() }));
vi.mock('react', () => ({ useState: value => test.current.useState(value), useRef: value => test.current.useRef(value), useEffect: (effect, dependencies) => test.current.useEffect(effect, dependencies) }));
vi.mock('./api.js', () => ({ listLessonTemplates: (...args) => test.list(...args), createLessonFromTemplate: (...args) => test.copy(...args) }));
vi.mock('../router.jsx', () => ({ Link: () => null, navigate: (...args) => test.navigate(...args), useNavigationGuard: vi.fn() }));
vi.mock('../account/account.js', () => ({ useAccount: vi.fn() }));
vi.mock('../account/GoogleButton.jsx', () => ({ default: () => null }));
vi.mock('../whiteboard/PdfWorksheetImport.jsx', () => ({ default: () => null }));
import { IncludedLessons } from './PreparationPage.jsx';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const template = { id: 'short-a', title: 'Short a practice', description: 'Original four-activity sample', knownLetters: ['a', 'm', 's', 't', 'p'], activityCount: 4 };
const mounted = [];
function mount(onAuthenticationRequired = vi.fn()) {
  const slots = []; let index = 0, dirty = true, effects = [], tree;
  const runtime = {
    useState(initial) { const i = index++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; dirty = true; }]; },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useEffect(setup, deps) { const i = index++, old = slots[i]; if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: setup() }; }); },
  };
  const result = {
    render() { while (dirty) { dirty = false; index = 0; test.current = runtime; try { tree = IncludedLessons({ onAuthenticationRequired }); } finally { test.current = null; } const pending = effects; effects = []; pending.forEach(effect => effect()); } return tree; },
    unmount() { slots.forEach(slot => slot.cleanup?.()); }, onAuthenticationRequired,
  }; mounted.push(result); return result;
}
function elements(node, predicate) { if (Array.isArray(node)) return node.flatMap(item => elements(item, predicate)); if (!node || typeof node !== 'object') return []; return [...(predicate(node) ? [node] : []), ...elements(node.props?.children, predicate)]; }
const action = tree => elements(tree, item => item.type === 'button' && item.props.children === 'Use this lesson')[0];
const settle = async hook => { for (let i = 0; i < 8; i++) await Promise.resolve(); return hook.render(); };
afterEach(() => { mounted.splice(0).forEach(hook => hook.unmount()); test.list.mockReset(); test.copy.mockReset(); test.navigate.mockReset(); });
describe('included lesson private-copy action', () => {
  it('opens the returned private copy in the classroom once, even after two rapid taps', async () => {
    test.list.mockResolvedValue([template]); const copy = deferred(); test.copy.mockReturnValue(copy.promise);
    const hook = mount(); hook.render(); const button = action(await settle(hook));
    const first = button.props.onClick(); await button.props.onClick(); expect(test.copy).toHaveBeenCalledOnce();
    copy.resolve({ id: 'existing-edited-private-copy', revision: 8 }); await first;
    expect(test.navigate).toHaveBeenCalledWith('/whiteboard/teach?lesson=existing-edited-private-copy');
  });
  it('aborts a pending copy and suppresses late navigation when the gallery is left', async () => {
    test.list.mockResolvedValue([template]); const copy = deferred(); test.copy.mockReturnValue(copy.promise);
    const hook = mount(); hook.render(); const pending = action(await settle(hook)).props.onClick(); hook.unmount();
    expect(test.copy.mock.calls[0][1].signal.aborted).toBe(true);
    copy.resolve({ id: 'late-private-copy' }); await pending; expect(test.navigate).not.toHaveBeenCalled();
  });
  it('keeps the template available and asks for authentication when the session expires', async () => {
    test.list.mockResolvedValue([template]); test.copy.mockRejectedValue(Object.assign(new Error('Sign in again'), { status: 401 }));
    const hook = mount(); hook.render(); await action(await settle(hook)).props.onClick();
    expect(hook.onAuthenticationRequired).toHaveBeenCalledOnce(); expect(action(hook.render())).toBeDefined(); expect(test.navigate).not.toHaveBeenCalled();
  });
});
