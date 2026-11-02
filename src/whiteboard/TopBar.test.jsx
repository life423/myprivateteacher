import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ current: null }));
vi.mock('react', () => ({
  useState: value => hooks.current.useState(value), useRef: value => hooks.current.useRef(value),
  useEffect: (setup, deps) => hooks.current.effect(setup, deps), useLayoutEffect: (setup, deps) => hooks.current.effect(setup, deps),
  useId: () => 'lesson-controls-test', startTransition: fn => fn(),
}));
vi.mock('react-dom', () => ({ createPortal: (children, container) => ({ type: 'portal', props: { children, container } }) }));
import { TopBar } from './ui.jsx';

const mounted = [];
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' ? [] : [node, ...nodes(node.props?.children)];
const find = (tree, predicate) => nodes(tree).find(predicate);
const trigger = tree => find(tree, node => node.type === 'button' && node.props['aria-label'] === 'Lesson controls');
const dialog = tree => find(tree, node => node.props?.['data-lesson-controls'] !== undefined);
function mount() {
  const slots = []; let index = 0, effects = [];
  const runtime = {
    useState(initial) { const i = index++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useRef(initial) { return slots[index++] ??= { current: initial }; },
    effect(setup, deps) { const i = index++, old = slots[i]; if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: setup() }; }); },
  };
  const hook = {
    render() { index = 0; hooks.current = runtime; try { return TopBar({ title: 'Board', menu: <button>Student tools</button> }); } finally { hooks.current = null; } },
    effects() { const pending = effects; effects = []; pending.forEach(run => run()); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  }; mounted.push(hook); return hook;
}
let listeners, focus, observe, disconnect, reposition;
beforeEach(() => {
  listeners = new Map(); focus = vi.fn(); observe = vi.fn(); disconnect = vi.fn();
  vi.stubGlobal('window', { innerWidth: 1440, innerHeight: 900, matchMedia: () => ({ matches: true }), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { body: {}, activeElement: null, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) });
  vi.stubGlobal('ResizeObserver', class { constructor(update) { reposition = update; } observe = observe; disconnect = disconnect; });
});
afterEach(() => { mounted.splice(0).forEach(hook => hook.unmount()); vi.unstubAllGlobals(); });
function open() {
  const hook = mount(); let tree = hook.render();
  trigger(tree).ref.current = { focus, contains: () => false, getBoundingClientRect: () => ({ right: 1320, bottom: 60 }) };
  hook.effects(); trigger(tree).props.onClick(); tree = hook.render();
  const firstFocus = vi.fn();
  dialog(tree).ref.current = { contains: target => target?.inControls, querySelector: () => ({ focus: firstFocus }) };
  hook.effects(); tree = hook.render(); hook.effects();
  return { hook, tree, firstFocus };
}

describe('lesson controls above the tutor guide', () => {
  it('waits until the portal is visible to move keyboard focus and does not refocus on resize', () => {
    const hook = mount(); let tree = hook.render();
    trigger(tree).ref.current = { focus, contains: () => false, getBoundingClientRect: () => ({ right: 1320, bottom: 60 }) };
    hook.effects(); trigger(tree).props.onClick(); tree = hook.render();
    const firstFocus = vi.fn();
    dialog(tree).ref.current = { contains: target => target?.inControls, querySelector: () => ({ focus: firstFocus }) };
    expect(dialog(tree).props.style.visibility).toBe('hidden');
    hook.effects(); expect(firstFocus).not.toHaveBeenCalled();
    tree = hook.render(); expect(dialog(tree).props.style.visibility).toBe('visible');
    hook.effects(); expect(firstFocus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    reposition(); tree = hook.render(); hook.effects();
    expect(firstFocus).toHaveBeenCalledOnce();
  });
  it('escapes the header stacking context with a bounded body portal and focuses its controls', () => {
    const { tree, firstFocus } = open();
    const portal = find(tree, node => node.type === 'portal');
    expect(portal.props.container).toBe(document.body);
    expect(dialog(tree).props.style).toEqual({ position: 'fixed', left: 1000, top: 68, width: 320, maxHeight: 824, visibility: 'visible' });
    expect(dialog(tree).props.className).toContain('z-[60]');
    expect(firstFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(observe).toHaveBeenCalledOnce();
  });
  it('Escape dismisses only the command dialog, consumes the key and returns focus to its trigger', () => {
    const { hook } = open();
    const event = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    listeners.get('keydown')(event);
    const tree = hook.render(); hook.effects();
    expect(dialog(tree)).toBeUndefined(); expect(event.defaultPrevented).toBe(true);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it('outside pointer input closes the commands without stealing focus from a guide control', () => {
    const { hook } = open();
    listeners.get('pointerdown')({ target: { inControls: false, inTutorGuide: true } });
    const tree = hook.render(); hook.effects();
    expect(dialog(tree)).toBeUndefined(); expect(focus).not.toHaveBeenCalled();
  });
});
