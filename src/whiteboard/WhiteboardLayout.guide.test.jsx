import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ current: null }));
vi.mock('react', async original => ({ ...await original(), useState: value => hooks.current.useState(value), useRef: value => hooks.current.useRef(value), useEffect: (fn, deps) => hooks.current.useEffect(fn, deps), useLayoutEffect: (fn, deps) => hooks.current.useEffect(fn, deps), useId: () => 'guide-layout' }));
vi.mock('./VideoPanel.jsx', () => ({ default: () => null }));
import WhiteboardLayout, { DesktopTools } from './WhiteboardLayout.jsx';
import { TUTOR_GUIDE_WIDTH } from '../lessons/guideLayout.js';
const mounted = [], listeners = new Map();
function mount(initial) {
  const slots = []; let index = 0, effects = [], dirty = true, props = initial, tree;
  const runtime = {
    useState(initial) { const i = index++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useEffect(setup, deps) { const i = index++, old = slots[i]; if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: setup() }; }); },
  };
  const hook = { render(next = props) { if (next !== props) { props = next; dirty = true; } while (dirty) { dirty = false; index = 0; hooks.current = runtime; try { tree = WhiteboardLayout(props); } finally { hooks.current = null; } const pending = effects; effects = []; pending.forEach(fn => fn()); } return tree; }, unmount() { slots.forEach(slot => slot.cleanup?.()); } }; mounted.push(hook); return hook;
}
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const find = (tree, predicate) => nodes(tree).find(predicate);
const rail = tree => find(tree, item => item.type === DesktopTools);
const sidebar = tree => find(tree, item => item.props?.['data-workspace-sidebar'] !== undefined);
const reservation = tree => find(tree, item => item.props?.['data-tutor-guide-reservation'] !== undefined);
const fit = tree => find(tree, item => item.props?.value?.tutorGuideFit !== undefined);
const board = { type: 'Stage', key: 'same-page', props: {} }, tools = { type: 'ToolRail', props: {} };
const props = { board, tools, panels: [{ id: 'materials', label: 'Materials', content: { type: 'MaterialsWorkspace', props: {} } }], guideOpen: false };
beforeEach(() => { listeners.clear(); vi.stubGlobal('window', { innerWidth: 1440, innerHeight: 900, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }); vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn()); });
afterEach(() => { mounted.splice(0).forEach(hook => hook.unmount()); vi.unstubAllGlobals(); });
describe('tutor desktop guide reservation and tools', () => {
  it('replaces the sidebar space without removing its media node or remounting the board provider', () => {
    const hook = mount(props), closed = hook.render(), opened = hook.render({ ...props, guideOpen: true });
    expect(sidebar(closed).props.hidden).toBe(false); expect(sidebar(opened).props.hidden).toBe(true); expect(sidebar(opened).props.inert).toBe('');
    expect(reservation(opened).props.style.width).toBe(TUTOR_GUIDE_WIDTH); expect(reservation(closed)).toBeUndefined();
    expect(fit(opened).type).toBe(fit(closed).type); expect(fit(opened).props.children).toBe(board); expect(fit(closed).props.children).toBe(board);
    expect(fit(opened).props.value.tutorGuideFit).toBe(true); expect(fit(closed).props.value.tutorGuideFit).toBe(false);
    expect(nodes(sidebar(opened)).some(item => item.type?.name === 'default')).toBe(true);
  });
  it('automatically collapses tools, permits reopening, and restores the preceding open choice', () => {
    const hook = mount(props); expect(rail(hook.render()).props.open).toBe(true);
    expect(rail(hook.render({ ...props, guideOpen: true })).props.open).toBe(false);
    rail(hook.render()).props.onToggle(); expect(rail(hook.render()).props.open).toBe(true);
    expect(rail(hook.render({ ...props, guideOpen: false })).props.open).toBe(true);
  });
  it('restores a previously collapsed choice after the tutor temporarily opens tools with the guide', () => {
    const hook = mount(props); rail(hook.render()).props.onToggle(); expect(rail(hook.render()).props.open).toBe(false);
    hook.render({ ...props, guideOpen: true }); rail(hook.render()).props.onToggle(); expect(rail(hook.render()).props.open).toBe(true);
    expect(rail(hook.render({ ...props, guideOpen: false })).props.open).toBe(false);
  });
  it('leaves student layout and tall-tablet arrangement unchanged', () => {
    const student = mount({ ...props, guideOpen: undefined }).render(); expect(rail(student)).toBeUndefined(); expect(reservation(student)).toBeUndefined(); expect(sidebar(student).props.hidden).toBe(false);
    window.innerWidth = 1024; window.innerHeight = 900;
    const tablet = mount({ ...props, guideOpen: true }).render(); expect(rail(tablet)).toBeUndefined(); expect(reservation(tablet)).toBeUndefined(); expect(fit(tablet)).toBeUndefined();
  });
  it('offers a labelled 44px tool opener and retains its single rail while collapsed', () => {
    const onToggle = vi.fn(), tree = DesktopTools({ tools, open: false, onToggle });
    const button = find(tree, item => item.type === 'button'); expect(button.props['aria-label']).toBe('Show tools'); expect(button.props.className).toContain('h-11'); expect(button.props.className).toContain('min-w-11'); button.props.onClick(); expect(onToggle).toHaveBeenCalledOnce();
    const body = find(tree, item => item.props?.inert === ''); expect(body.props.hidden).toBe(true); expect(body.props.children).toBe(tools);
  });
});
