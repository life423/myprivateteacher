import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ current: null }));
vi.mock('react', () => ({ useState: value => hooks.current.useState(value), useRef: value => hooks.current.useRef(value), useEffect: (setup, deps) => hooks.current.useEffect(setup, deps) }));
import TutorGuide from './TutorGuide.jsx';
const mounted = [];
function mount(props) {
  const slots = []; let index = 0, effects = [], tree;
  const runtime = {
    useState(initial) { const i = index++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useEffect(setup, deps) { const i = index++, old = slots[i]; if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: setup() }; }); },
  };
  const result = {
    render(next = props) { props = next; index = 0; hooks.current = runtime; try { tree = TutorGuide(props); } finally { hooks.current = null; } return tree; },
    effects() { const pending = effects; effects = []; pending.forEach(effect => effect()); },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  }; mounted.push(result); return result;
}
function elements(node, predicate) { if (Array.isArray(node)) return node.flatMap(item => elements(item, predicate)); if (!node || typeof node !== 'object') return []; return [...(predicate(node) ? [node] : []), ...elements(node.props?.children, predicate)]; }
const closeButton = tree => elements(tree, item => item.type === 'button' && item.props['aria-label'] === 'Close tutor guide')[0];
beforeEach(() => { vi.stubGlobal('window', { innerWidth: 393, innerHeight: 852, addEventListener: vi.fn(), removeEventListener: vi.fn() }); });
afterEach(() => { mounted.splice(0).forEach(item => item.unmount()); vi.unstubAllGlobals(); });
describe('private tutor guide overlay', () => {
  it('keeps one mounted child in a fixed nonmodal surface while opening and closing', () => {
    const child = { type: 'LessonPanel', props: { privateNote: 'Unsent draft' } }, hook = mount({ open: false, onClose: vi.fn(), children: child });
    const closed = hook.render();
    expect(closed.type).toBe('aside'); expect(closed.props['aria-label']).toBe('Tutor guide'); expect(closed.props['aria-modal']).toBeUndefined(); expect(closed.props.role).toBeUndefined();
    expect(closed.props.className).toContain('fixed'); expect(closed.props.className).toContain('w-[min(600px,calc(100vw-1rem))]'); expect(closed.props.className).toContain('motion-reduce:transition-none'); expect(closed.props['aria-hidden']).toBe(true); expect(closed.props.inert).toBe('');
    const opened = hook.render({ open: true, onClose: vi.fn(), children: child });
    expect(opened.props.className).toContain('translate-x-0'); expect(opened.props['aria-hidden']).toBeUndefined(); expect(opened.props.inert).toBeUndefined();
    expect(elements(closed, item => item === child)).toHaveLength(1); expect(elements(opened, item => item === child)).toHaveLength(1);
    // No scrim, body lock, board callback, or second mounted child belongs here.
    expect(opened.props.onPointerDown).toBeUndefined(); expect(opened.props.style).toEqual({ '--tutor-guide-width': 'clamp(520px,40vw,560px)' }); expect(closeButton(opened).props.className).toContain('h-11');
  });
  it('closes with Escape and returns focus without trapping focus away from the board', () => {
    const listeners = new Map(), onClose = vi.fn(), focus = vi.fn(), target = { isConnected: true, focus };
    vi.stubGlobal('document', { activeElement: target, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) });
    vi.stubGlobal('requestAnimationFrame', fn => { fn(); return 1; }); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const hook = mount({ open: true, onClose, returnFocusRef: { current: target }, children: null }); const tree = hook.render(); tree.ref.current = { contains: () => false }; hook.effects();
    expect([...listeners.keys()]).toEqual(['keydown']);
    const event = { key: 'Escape', defaultPrevented: false, target: { closest: () => null }, preventDefault: vi.fn() };
    listeners.get('keydown')(event); expect(onClose).toHaveBeenCalledOnce(); expect(event.preventDefault).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    hook.render({ open: false, onClose, children: null }); hook.effects(); expect(listeners.size).toBe(0);
  });
  it('leaves Escape to another open dialog and makes Close return to the guide launcher', () => {
    const listeners = new Map(), onClose = vi.fn(), focus = vi.fn(), launcher = { isConnected: true, focus };
    vi.stubGlobal('document', { activeElement: null, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) });
    vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const hook = mount({ open: true, onClose, returnFocusRef: { current: launcher }, children: null }); const tree = hook.render(); tree.ref.current = { contains: () => false }; hook.effects();
    listeners.get('keydown')({ key: 'Escape', defaultPrevented: false, target: { closest: () => ({}) }, preventDefault: vi.fn() }); expect(onClose).not.toHaveBeenCalled();
    closeButton(tree).props.onClick(); expect(onClose).toHaveBeenCalledOnce(); expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});


describe('adaptive tutor guide docking', () => {
  it('docks in an existing desktop side layout but keeps a readable overlay on tall tablets', () => {
    window.innerWidth = 1440; window.innerHeight = 900;
    const desktop = mount({ open: true, onClose: vi.fn(), children: null }).render();
    expect(desktop.props['data-docked']).toBe(true); expect(desktop.props.className).toContain('top-20'); expect(desktop.props.className).toContain('w-[var(--tutor-guide-width)]');
    window.innerWidth = 1024; window.innerHeight = 900;
    const tablet = mount({ open: true, onClose: vi.fn(), children: null }).render();
    expect(tablet.props['data-docked']).toBeUndefined(); expect(tablet.props.className).toContain('w-[min(600px,calc(100vw-1rem))]');
  });
});
