import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ current: null }));
vi.mock('react', () => ({
  useState: initial => hooks.current.useState(initial), useRef: initial => hooks.current.useRef(initial),
  useEffect: (setup, deps) => hooks.current.effect(setup, deps), useLayoutEffect: (setup, deps) => hooks.current.effect(setup, deps),
  useId: () => 'object-size-test',
}));
import ObjectSizeControl from './ObjectSizeControl.jsx';
import ObjectToolbar from './ObjectToolbar.jsx';

const mounted = [];
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' ? [] : [node, ...nodes(node.props?.children)];
const find = (tree, predicate) => nodes(tree).find(predicate);
const button = tree => find(tree, node => node.type === 'button');
const slider = tree => find(tree, node => node.type === 'input');
const panel = tree => find(tree, node => node.props?.['data-object-size-panel'] !== undefined);
const event = fields => ({ preventDefault: vi.fn(), stopPropagation: vi.fn(), ...fields });
let windowListeners, documentListeners;
function listenerTarget(registry) {
  return {
    addEventListener(name, fn) { if (!registry.has(name)) registry.set(name, new Set()); registry.get(name).add(fn); },
    removeEventListener(name, fn) { registry.get(name)?.delete(fn); },
  };
}
const dispatch = (registry, name, e) => [...(registry.get(name) || [])].forEach(fn => fn(e));

function mount(overrides = {}, Component = ObjectSizeControl) {
  const slots = []; let index = 0, effects = [];
  let props = {
    piece: { id: 'breve', crop: { x: 0, y: 0, w: 90, h: 40 }, w: 40, h: 17.5, content: { kind: 'breve' } },
    label: 'Breve', onStart: vi.fn(), onChange: vi.fn(), onEnd: vi.fn(), onOpenChange: vi.fn(), ...overrides,
  };
  const runtime = {
    useState(initial) { const i = index++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useRef(initial) { return slots[index++] ??= { current: initial }; },
    effect(setup, deps) { const i = index++, old = slots[i]; if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: setup() }; }); },
  };
  const hook = {
    get props() { return props; },
    render(next = {}) { props = { ...props, ...next }; index = 0; hooks.current = runtime; try { return Component(props); } finally { hooks.current = null; } },
    effects() { const pending = effects; effects = []; pending.forEach(run => run()); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  mounted.push(hook); return hook;
}
function open(overrides) {
  const hook = mount(overrides); let tree = hook.render();
  const triggerFocus = vi.fn(), sliderFocus = vi.fn();
  button(tree).ref.current = { focus: triggerFocus, contains: target => target?.inTrigger };
  hook.effects(); button(tree).props.onClick(); tree = hook.render();
  slider(tree).ref.current = { focus: sliderFocus };
  panel(tree).ref.current = { contains: target => target?.inPanel };
  hook.effects(); tree = hook.render();
  return { hook, tree, triggerFocus, sliderFocus };
}

beforeEach(() => {
  windowListeners = new Map(); documentListeners = new Map();
  vi.stubGlobal('window', listenerTarget(windowListeners));
  vi.stubGlobal('document', listenerTarget(documentListeners));
});
afterEach(() => { mounted.splice(0).forEach(hook => hook.unmount()); vi.unstubAllGlobals(); });

describe('consistent object size control', () => {
  it('consumes Escape from Duplicate before the open Tutor guide can handle it', () => {
    const onClear = vi.fn();
    const parent = mount({
      object: { id: 'breve', x: 100, y: 100, w: 60, h: 44 }, kind: 'mark', label: 'Breve',
      viewport: { width: 800, height: 600 }, layout: { left: 0, top: 0, scale: 1 },
      canResize: true, onClear, onDuplicate: vi.fn(),
    }, ObjectToolbar);
    let tree = parent.render();
    const sizeControl = find(tree, node => node.type === ObjectSizeControl);
    const child = open(sizeControl.props);
    tree = parent.render();
    const duplicate = find(tree, node => node.props?.['aria-label'] === 'Duplicate mark');
    const escape = event({ key: 'Escape', target: duplicate, defaultPrevented: false });
    escape.preventDefault.mockImplementation(() => { escape.defaultPrevented = true; });
    tree.props.onKeyDown(escape);
    expect(panel(child.hook.render())).toBeUndefined();
    expect(child.triggerFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(escape.defaultPrevented).toBe(true);
    expect(escape.stopPropagation).toHaveBeenCalledOnce();
    expect(onClear).not.toHaveBeenCalled();
  });
  it('offers a compact labelled action and focuses the continuous input on opening', () => {
    const { tree, hook, sliderFocus } = open();
    expect(button(tree).props['aria-label']).toBe('Breve size');
    expect(button(tree).props['aria-expanded']).toBe(true);
    expect(slider(tree).props.type).toBe('range');
    expect(slider(tree).props.step).toBe('1');
    expect(slider(tree).props['aria-valuetext']).toBe('40 board units wide');
    expect(sliderFocus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(hook.props.onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(panel(tree).props.className).toContain('basis-full');
  });

  it('shares one grab and final width across a whole pointer drag, including release outside', () => {
    const { tree, hook } = open(); const input = slider(tree).props;
    input.onPointerDown(event({ button: 0, pointerId: 4 }));
    input.onChange({ target: { value: '200' } }); input.onChange({ target: { value: '230' } });
    expect(hook.props.onStart).toHaveBeenCalledTimes(1);
    expect(hook.props.onChange).toHaveBeenCalledTimes(2);
    dispatch(windowListeners, 'pointerup', { pointerId: 9 }); input.onPointerUp(event({ pointerId: 9 })); expect(hook.props.onEnd).not.toHaveBeenCalled();
    dispatch(windowListeners, 'pointerup', { pointerId: 4 }); input.onPointerUp(event({ pointerId: 4 }));
    expect(hook.props.onEnd).toHaveBeenCalledExactlyOnceWith(hook.props.onChange.mock.calls.at(-1)[0]);
  });

  it('supports held keyboard adjustment without moving the selected object', () => {
    const { tree, hook } = open(); const input = slider(tree).props;
    const down = event({ key: 'ArrowRight' }); input.onKeyDown(down); input.onChange({ target: { value: '150' } });
    input.onKeyDown(event({ key: 'ArrowRight', repeat: true })); input.onChange({ target: { value: '151' } });
    expect(down.stopPropagation).toHaveBeenCalled(); expect(hook.props.onStart).toHaveBeenCalledTimes(1);
    dispatch(windowListeners, 'keyup', { key: 'ArrowRight' }); input.onKeyUp(event({ key: 'ArrowRight' })); input.onBlur();
    expect(hook.props.onEnd).toHaveBeenCalledTimes(1);
  });

  it('treats a standalone assistive change as one complete gesture', () => {
    const { tree, hook } = open(); slider(tree).props.onChange({ target: { value: '300' } });
    expect(hook.props.onStart).toHaveBeenCalledTimes(1); expect(hook.props.onChange).toHaveBeenCalledTimes(1);
    expect(hook.props.onEnd).toHaveBeenCalledExactlyOnceWith(hook.props.onChange.mock.calls[0][0]);
  });

  it('Escape closes only Size and returns focus; outside input closes without stealing focus', () => {
    const { tree, hook, triggerFocus } = open(); const escape = event({ key: 'Escape' });
    slider(tree).props.onKeyDown(escape); let next = hook.render(); hook.effects();
    expect(panel(next)).toBeUndefined(); expect(escape.preventDefault).toHaveBeenCalled(); expect(escape.stopPropagation).toHaveBeenCalled();
    expect(triggerFocus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    button(next).props.onClick(); next = hook.render(); hook.effects(); triggerFocus.mockClear();
    dispatch(documentListeners, 'pointerdown', { target: { inPanel: true } }); expect(button(hook.render()).props['aria-expanded']).toBe(true);
    dispatch(documentListeners, 'pointerdown', { target: {} }); next = hook.render(); hook.effects();
    expect(panel(next)).toBeUndefined(); expect(triggerFocus).not.toHaveBeenCalled();
  });

  it('finishes once on cancellation, blur, disabled permissions and cleanup using the latest callback', () => {
    const { tree, hook } = open(); const input = slider(tree).props;
    input.onPointerDown(event({ button: 0, pointerId: 4 })); input.onChange({ target: { value: '250' } });
    const latestEnd = vi.fn(); hook.render({ onEnd: latestEnd }); hook.effects();
    dispatch(windowListeners, 'pointercancel', { pointerId: 4 }); dispatch(windowListeners, 'blur', {});
    expect(latestEnd).toHaveBeenCalledTimes(1); expect(hook.props.onStart).toHaveBeenCalledTimes(1);
    slider(hook.render()).props.onPointerDown(event({ button: 0, pointerId: 5 }));
    hook.render({ disabled: true }); hook.effects();
    expect(latestEnd).toHaveBeenCalledTimes(2); expect(panel(hook.render())).toBeUndefined();
    hook.render({ disabled: false }); hook.effects(); button(hook.render()).props.onClick(); hook.render(); hook.effects();
    slider(hook.render()).props.onPointerDown(event({ button: 0, pointerId: 6 })); hook.unmount();
    expect(latestEnd).toHaveBeenCalledTimes(3);
    expect([...windowListeners.values()].every(listeners => listeners.size === 0)).toBe(true);
  });
  it('closes Size before the outer selection when Escape is pressed from another action', () => {
    const { hook, triggerFocus } = open();
    const escape = event({ key: 'Escape', target: { action: 'duplicate' } });
    dispatch(documentListeners, 'keydown', escape);
    const next = hook.render(); hook.effects();
    expect(panel(next)).toBeUndefined();
    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(escape.stopPropagation).toHaveBeenCalledOnce();
    expect(triggerFocus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
