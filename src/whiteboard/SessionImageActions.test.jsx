import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ current: null }));
vi.mock('react', () => ({
  useState: value => hooks.current.useState(value), useRef: value => hooks.current.useRef(value),
  useEffect: (setup, deps) => hooks.current.effect(setup, deps), useLayoutEffect: (setup, deps) => hooks.current.effect(setup, deps),
  useId: () => 'session-images-test',
}));
vi.mock('react-dom', () => ({ createPortal: (children, container) => ({ type: 'portal', props: { children, container } }) }));
import SessionImageActions from './SessionImageActions.jsx';

const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' ? [] : [node, ...nodes(node.props?.children)];
const find = (tree, predicate) => nodes(tree).find(predicate);
const button = (tree, text) => find(tree, node => node.type === 'button' && (node.props.children === text || node.props['aria-label'] === text));
const triggerOf = tree => button(tree, 'Picture options');
const panelOf = tree => find(tree, node => node.props['data-session-image-actions'] !== undefined);
let listeners, focusTrigger, focusAction, focusCancel, focusSearch, mounted, reposition;
beforeEach(() => {
  listeners = new Map(); mounted = [];
  focusTrigger = vi.fn(); focusAction = vi.fn(); focusCancel = vi.fn(); focusSearch = vi.fn();
  vi.stubGlobal('document', { body: {}, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) });
  vi.stubGlobal('window', { innerWidth: 393, innerHeight: 852, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('ResizeObserver', class { constructor(update) { reposition = update; } observe() {} disconnect() {} });
});
afterEach(() => { mounted.forEach(hook => hook.unmount()); vi.unstubAllGlobals(); });

function mount(props = {}) {
  const slots = []; let index = 0, effects = [];
  const onClear = vi.fn();
  const runtime = {
    useState(initial) { const i = index++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useRef(initial) { return slots[index++] ??= { current: initial }; },
    effect(setup, deps) { const i = index++, old = slots[i]; if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: setup() }; }); },
  };
  const hook = {
    onClear,
    render(patch = {}) {
      Object.assign(props, patch); index = 0; hooks.current = runtime;
      let tree;
      try { tree = SessionImageActions({ count: 2, onClear, ...props }); } finally { hooks.current = null; }
      if (triggerOf(tree)) triggerOf(tree).ref.current = {
        focus: focusTrigger, contains: target => target?.inTrigger,
        closest: () => ({ querySelector: () => ({ focus: focusSearch }) }),
        getBoundingClientRect: () => ({ right: 380, bottom: 220 }),
      };
      if (panelOf(tree)) panelOf(tree).ref.current = {
        contains: target => target?.inPanel,
        querySelector: selector => ({ focus: selector === '[data-cancel-images]' ? focusCancel : focusAction }),
      };
      return tree;
    },
    effects() { const pending = effects; effects = []; pending.forEach(run => run()); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  mounted.push(hook); return hook;
}
function open() {
  const hook = mount(); let tree = hook.render(); hook.effects();
  triggerOf(tree).props.onClick(); tree = hook.render(); hook.effects(); tree = hook.render(); hook.effects();
  return { hook, tree };
}

describe('session image cleanup in materials options', () => {
  it('focuses the first action only after the portal is visible and preserves focus on repositioning', () => {
    const hook = mount(); let tree = hook.render(); hook.effects();
    triggerOf(tree).props.onClick(); tree = hook.render();
    expect(panelOf(tree).props.style.visibility).toBe('hidden');
    hook.effects(); expect(focusAction).not.toHaveBeenCalled();
    tree = hook.render(); expect(panelOf(tree).props.style.visibility).toBe('visible');
    hook.effects(); expect(focusAction).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    reposition(); tree = hook.render(); hook.effects();
    expect(focusAction).toHaveBeenCalledOnce();
  });
  it('does not show cleanup when no session images exist', () => {
    const hook = mount({ count: 0 }); expect(hook.render()).toBeNull();
  });
  it('opens bounded options above clipped scrollers without clearing anything', () => {
    const { hook, tree } = open();
    expect(hook.onClear).not.toHaveBeenCalled();
    expect(panelOf(tree).props.style).toEqual({ position: 'fixed', left: 60, top: 228, width: 320, maxHeight: 616, visibility: 'visible' });
    expect(find(tree, node => node.type === 'portal').props.container).toBe(document.body);
    expect(focusAction).toHaveBeenCalledWith({ preventScroll: true });
  });
  it('requires explicit confirmation, defaults keyboard focus to Cancel, and restores search after removal', () => {
    const { hook, tree } = open();
    const cleanup = find(tree, node => node.type === 'button' && node.props.className.includes('text-rose-700'));
    cleanup.props.onClick(); let confirmation = hook.render(); hook.effects();
    expect(hook.onClear).not.toHaveBeenCalled();
    expect(focusCancel).toHaveBeenCalledWith({ preventScroll: true });
    expect(panelOf(confirmation).props['aria-label']).toBe('Remove this page’s images?');
    button(confirmation, 'Remove images').props.onClick();
    expect(hook.onClear).toHaveBeenCalledOnce();
    expect(panelOf(hook.render())).toBeUndefined();
    expect(focusSearch).toHaveBeenCalledWith({ preventScroll: true });
  });
  it('Escape cancels only these options and restores the trigger', () => {
    const { hook } = open();
    const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    listeners.get('keydown')(event);
    expect(panelOf(hook.render())).toBeUndefined();
    expect(hook.onClear).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(focusTrigger).toHaveBeenCalledWith({ preventScroll: true });
  });
  it('outside input dismisses without stealing focus or removing images', () => {
    const { hook } = open(); listeners.get('pointerdown')({ target: {} });
    expect(panelOf(hook.render())).toBeUndefined();
    expect(focusTrigger).not.toHaveBeenCalled(); expect(hook.onClear).not.toHaveBeenCalled();
  });
  it('keeps confirmation open with feedback when the current page cannot be changed', () => {
    const { hook, tree } = open(); hook.onClear.mockReturnValue(false);
    find(tree, node => node.type === 'button' && node.props.className.includes('text-rose-700')).props.onClick();
    const confirmation = hook.render(); hook.effects(); button(confirmation, 'Remove images').props.onClick();
    expect(find(hook.render(), node => node.props.role === 'alert').props.children).toContain('Reconnect');
    expect(panelOf(hook.render())).toBeDefined();
  });
});
