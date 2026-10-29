import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ effects: [], frames: new Map(), nextFrame: 0 }));
vi.mock('react', async (original) => ({
  ...await original(),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
  useRef: (initial) => ({ current: initial }),
  useLayoutEffect: (setup) => runtime.effects.push(setup),
  useEffect: (setup) => runtime.effects.push(setup),
  useId: () => 'sheet-test',
}));
vi.mock('./VideoPanel.jsx', () => ({ default: () => null }));
import { PanelSheet, shortLandscapePanelWidth } from './WhiteboardLayout.jsx';

const panels = [{ id: 'materials', label: 'Materials', content: 'Saved material content' }];
const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const find = (tree, predicate) => nodes(tree).find(predicate);
const labelled = (tree, label) => find(tree, (node) => node.props?.['aria-label'] === label);
function render(state = 'closed', extra = {}) {
  const onState = vi.fn();
  const layout = PanelSheet({ panels, active: 'materials', state, onState, onTab: vi.fn(), panelNodes: { current: {} }, ...extra });
  const tree = find(layout, (node) => node.props?.['data-panel-sheet'] !== undefined);
  return { tree, layout, onState, trigger: find(tree, (node) => node.type === 'button' && node.props['aria-expanded'] !== undefined) };
}
function flushFrames() {
  const pending = [...runtime.frames.values()];
  runtime.frames.clear();
  pending.forEach((callback) => callback());
}
beforeEach(() => {
  runtime.effects = []; runtime.frames.clear(); runtime.nextFrame = 0;
  vi.stubGlobal('window', { innerHeight: 852 });
  vi.stubGlobal('requestAnimationFrame', (callback) => { const id = ++runtime.nextFrame; runtime.frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id) => runtime.frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());

describe('the mobile materials sheet', () => {
  it('reserves space for separate tools and video lanes across short landscape sizes', () => {
    for (const width of [568, 640, 740, 852]) {
      const panel = shortLandscapePanelWidth(width);
      expect(panel).toBeLessThanOrEqual(320);
      expect(width - panel).toBeGreaterThanOrEqual(352);
    }
  });

  it('opens through a native button without pointer gesture handlers', () => {
    const { tree, onState, trigger } = render();
    expect(trigger.type).toBe('button');
    expect(trigger.props.type).toBe('button');
    expect(trigger.props['aria-expanded']).toBe(false);
    expect(trigger.props['aria-controls']).toBe('sheet-test-content');
    trigger.props.onClick();
    expect(onState).toHaveBeenCalledExactlyOnceWith('open');
    expect(nodes(tree).some((node) => node.props?.onPointerDown || node.props?.onPointerUp)).toBe(false);
  });

  it('opens fully on a short screen without requiring a swipe', () => {
    window.innerHeight = 393;
    const { onState, trigger } = render();
    trigger.props.onClick();
    expect(onState).toHaveBeenCalledExactlyOnceWith('full');
  });

  it('offers an explicit close action and returns focus without scrolling the board', () => {
    const { tree, onState, trigger } = render('open');
    const focus = vi.fn();
    trigger.ref.current = { focus };
    labelled(tree, 'Close Materials').props.onClick();
    expect(onState).toHaveBeenCalledExactlyOnceWith('closed');
    expect(focus).not.toHaveBeenCalled();
    flushFrames();
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it('closes with Escape, while preserving nested dialog and handled-key behavior', () => {
    const { tree, onState } = render('open');
    const preventDefault = vi.fn();
    tree.props.onKeyDown({ key: 'Escape', defaultPrevented: true, preventDefault });
    tree.props.onKeyDown({ key: 'Escape', target: { closest: () => ({}) }, preventDefault });
    expect(onState).not.toHaveBeenCalled();
    tree.props.onKeyDown({ key: 'Escape', target: { closest: () => null }, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onState).toHaveBeenCalledExactlyOnceWith('closed');
  });

  it('lets the tutor expand and reduce the sheet with labelled buttons', () => {
    const small = render('open');
    labelled(small.tree, 'Expand Materials panel').props.onClick();
    expect(small.onState).toHaveBeenCalledExactlyOnceWith('full');
    const large = render('full');
    labelled(large.tree, 'Reduce Materials panel').props.onClick();
    expect(large.onState).toHaveBeenCalledExactlyOnceWith('open');
  });


  it('keeps board space stable in short landscape and omits a meaningless expand action', () => {
    const closed = render('closed', { landscape: true });
    const opened = render('full', { landscape: true });
    expect(closed.layout.props.style.height).toBe(opened.layout.props.style.height);
    expect(opened.tree.props.style.width).toBe(320);
    expect(opened.tree.props.style.bottom).toBe(0);
    expect(labelled(opened.tree, 'Close Materials')).toBeDefined();
    expect(nodes(opened.tree).some((node) => /^(Expand|Reduce) /.test(node.props?.['aria-label'] || ''))).toBe(false);
  });

  it('keeps saved content mounted but inaccessible while closed', () => {
    const { tree } = render();
    const body = find(tree, (node) => node.props?.id === 'sheet-test-content');
    expect(body.props['aria-hidden']).toBe(true);
    expect(body.props.inert).toBe('');
    expect(nodes(body).some((node) => node.props?.children === 'Saved material content')).toBe(true);
    // One Materials surface does not invent an extra tab outside its own category tabs.
    expect(nodes(tree).some((node) => node.props?.role === 'tablist')).toBe(false);
    expect(nodes(tree).some((node) => node.props?.role === 'tabpanel')).toBe(false);
  });

  it('cancels deferred focus restoration when the sheet unmounts', () => {
    const { tree, trigger } = render('open');
    const focus = vi.fn();
    trigger.ref.current = { focus };
    const cleanups = runtime.effects.map((setup) => setup());
    labelled(tree, 'Close Materials').props.onClick();
    cleanups.forEach((cleanup) => cleanup?.());
    flushFrames();
    expect(focus).not.toHaveBeenCalled();
  });
});
