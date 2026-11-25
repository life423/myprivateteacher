import { afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ current: null }));
vi.mock('react', () => ({ useState: value => hooks.current.useState(value), useEffect: (setup, deps) => hooks.current.effect(setup, deps) }));
import TeachingMarks from './TeachingMarks.jsx';

const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' ? [] : [node, ...nodes(node.props?.children)];
const find = (tree, predicate) => nodes(tree).find(predicate);
const buttons = tree => nodes(tree).filter(node => node.type === 'button');
const button = (tree, label) => find(tree, node => node.type === 'button' && node.props['aria-label'] === label);
const status = tree => find(tree, node => node.props.role === 'status');
const mounted = [];
function mount(props = {}) {
  const slots = []; let index = 0, effects = [];
  const runtime = {
    useState(initial) { const i = index++; slots[i] ??= { value: initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    effect(setup, deps) { const i = index++, old = slots[i]; if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: setup() }; }); },
  };
  const view = {
    render(patch = {}) {
      Object.assign(props, patch); index = 0; hooks.current = runtime;
      let tree; try { tree = TeachingMarks(props); } finally { hooks.current = null; }
      const pending = effects; effects = []; pending.forEach(run => run()); return tree;
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  mounted.push(view); return view;
}
afterEach(() => { mounted.splice(0).forEach(view => view.unmount()); vi.useRealTimers(); });

describe('teaching mark choices', () => {
  it('selects preparation marks without adding anything to the board', () => {
    const onToggle = vi.fn(), onAdd = vi.fn();
    const view = mount({ selected: ['breve'], onToggle, onAdd });
    let tree = view.render();
    expect(button(tree, 'Breve').props['aria-pressed']).toBe(true);
    expect(button(tree, 'Macron').props['aria-pressed']).toBe(false);
    expect(onToggle).not.toHaveBeenCalled(); expect(onAdd).not.toHaveBeenCalled();
    button(tree, 'Macron').props.onClick();
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('macron'); expect(onAdd).not.toHaveBeenCalled();
    tree = view.render({ selected: ['breve', 'macron'] });
    expect(button(tree, 'Macron').props['aria-pressed']).toBe(true);
  });

  it('offers only prepared marks and adds exactly the explicitly chosen mark', () => {
    const onAdd = vi.fn(() => 'piece-added'), view = mount({ marks: ['breve', 'schwa'], onAdd, label: 'Prepared teaching marks' });
    let tree = view.render();
    expect(tree.props['aria-label']).toBe('Prepared teaching marks');
    expect(buttons(tree).map(node => node.props['aria-label'])).toEqual(['Add Breve', 'Add Schwa']);
    expect(onAdd).not.toHaveBeenCalled();
    button(tree, 'Add Schwa').props.onClick(); tree = view.render();
    expect(onAdd).toHaveBeenCalledExactlyOnceWith('schwa');
    expect(status(tree).props.children).toBe('Schwa added');
  });

  it('keeps a failed addition retryable and gives compact feedback', () => {
    const onAdd = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce('piece-added');
    const view = mount({ marks: ['breve'], onAdd });
    button(view.render(), 'Add Breve').props.onClick();
    const failure = view.render();
    expect(status(failure).props.children).toContain('could not be added');
    expect(button(failure, 'Add Breve').props.disabled).toBe(false);
    button(failure, 'Add Breve').props.onClick();
    expect(status(view.render()).props.children).toBe('Breve added');
  });

  it('filters choices without changing or clearing the teacher’s saved selection', () => {
    const selected = ['breve', 'schwa'], onToggle = vi.fn();
    const view = mount({ selected, onToggle, query: 'scoop' });
    expect(buttons(view.render()).map(node => node.props['aria-label'])).toEqual(['Syllable scoop']);
    expect(button(view.render({ query: '' }), 'Breve').props['aria-pressed']).toBe(true);
    expect(selected).toEqual(['breve', 'schwa']); expect(onToggle).not.toHaveBeenCalled();
  });

  it('keeps unavailable mark controls disabled and hides empty prepared collections', () => {
    const tree = mount({ marks: ['breve', 'unknown'], onAdd: vi.fn(), disabled: true }).render();
    expect(buttons(tree)).toHaveLength(1); expect(button(tree, 'Add Breve').props.disabled).toBe(true);
    expect(mount({ marks: [] }).render()).toBeNull();
  });

  it('expires placement feedback instead of leaving a permanent instruction row', () => {
    vi.useFakeTimers();
    const view = mount({ marks: ['dot'], onAdd: () => 'piece-added' });
    button(view.render(), 'Add Dot above').props.onClick();
    expect(status(view.render()).props.children).toBe('Dot above added');
    vi.advanceTimersByTime(4000);
    expect(status(view.render())).toBeUndefined();
  });
});
