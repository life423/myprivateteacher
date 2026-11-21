import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ current: null }));
vi.mock('react', () => ({
  useState: value => hooks.current.useState(value), useRef: value => hooks.current.useRef(value),
  useEffect: (setup, deps) => hooks.current.effect(setup, deps), useLayoutEffect: (setup, deps) => hooks.current.effect(setup, deps),
  useId: () => 'board-pages-test',
}));
vi.mock('react-dom', () => ({ createPortal: children => ({ type: 'portal', props: { children } }) }));
import BoardPages from './BoardPages.jsx';

const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' ? [] : [node, ...nodes(node.props?.children)];
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node);
const find = (tree, predicate) => nodes(tree).find(predicate);
const button = (tree, label) => find(tree, node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label));
const trigger = tree => find(tree, node => node.type === 'button' && node.props['aria-haspopup'] === 'dialog');
const dialog = tree => find(tree, node => node.props.role === 'dialog');
const pages = [{ id: 'page-one', title: 'Review sounds' }, { id: 'page-two', title: 'Build words' }];
let listeners, resized, focusTrigger, focusPage, focusCancel, focusDelete, mounted;

beforeEach(() => {
  listeners = new Map(); mounted = [];
  focusTrigger = vi.fn(); focusPage = vi.fn(); focusCancel = vi.fn(); focusDelete = vi.fn();
  vi.stubGlobal('document', { body: {}, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) });
  vi.stubGlobal('window', { innerWidth: 393, innerHeight: 852,
    addEventListener: (type, fn) => { if (type === 'resize') resized = fn; }, removeEventListener: vi.fn() });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
});
afterEach(() => { mounted.forEach(item => item.unmount()); vi.unstubAllGlobals(); });

function mount(overrides = {}) {
  const slots = []; let index = 0, effects = [], dirty = false;
  const actions = { add: vi.fn(), duplicate: vi.fn(), switch: vi.fn(), remove: vi.fn(() => true) };
  const props = { pages, pageId: pages[1].id, actions, ...overrides };
  const runtime = {
    useState(initial) { const i = index++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => {
      const value = typeof next === 'function' ? next(slots[i].value) : next;
      if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; }
    }]; },
    useRef(initial) { return slots[index++] ??= { current: initial }; },
    effect(setup, deps) { const i = index++, old = slots[i]; if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: setup() }; }); },
  };
  const hook = {
    actions,
    render(patch = {}) {
      Object.assign(props, patch); index = 0; hooks.current = runtime;
      let tree;
      try { tree = BoardPages(props); } finally { hooks.current = null; }
      trigger(tree).ref.current = { focus: focusTrigger, contains: value => value?.inTrigger,
        getBoundingClientRect: () => ({ left: 30, top: 790, right: 150, bottom: 834 }) };
      if (dialog(tree)) dialog(tree).ref.current = { contains: value => value?.inDialog, querySelector: selector => ({
        focus: selector.includes('cancel-delete') ? focusCancel : selector.includes('delete-page') ? focusDelete : focusPage,
      }) };
      return tree;
    },
    flush() { const pending = effects; effects = []; pending.forEach(run => run()); },
    settle(patch = {}) { let tree; Object.assign(props, patch); for (let n = 0; n < 10; n++) {
      dirty = false; tree = hook.render(); hook.flush(); if (!dirty) return tree;
    } throw new Error('BoardPages did not settle'); },
    open() { const tree = hook.settle(); trigger(tree).props.onClick(); return hook.settle(); },
    confirm() { const tree = hook.open(); button(tree, 'Delete page').props.onClick(); return hook.settle(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  mounted.push(hook); return hook;
}

describe('board page deletion', () => {
  it('opens a named confirmation without deleting, with Cancel focused first', () => {
    const hook = mount(); const tree = hook.confirm();
    expect(dialog(tree).props['aria-label']).toBe('Delete “Build words”?');
    expect(text(tree)).toContain('This cannot be undone.');
    expect(text(tree)).toContain('Saved lessons stay in your profile.');
    expect(focusCancel).toHaveBeenCalledWith({ preventScroll: true });
    expect(hook.actions.remove).not.toHaveBeenCalled();
  });

  it('Cancel returns to the chooser without changing any page', () => {
    const hook = mount(); button(hook.confirm(), 'Cancel').props.onClick();
    expect(dialog(hook.settle()).props['aria-label']).toBe('Board pages');
    expect(hook.actions.remove).not.toHaveBeenCalled();
    expect(hook.actions.switch).not.toHaveBeenCalled();
    expect(focusDelete).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('closing with the footer trigger resets a confirmation before reopening', () => {
    const hook = mount(); const confirmation = hook.confirm();
    trigger(confirmation).props.onClick(); expect(dialog(hook.settle())).toBeUndefined();
    trigger(hook.settle()).props.onClick();
    expect(dialog(hook.settle()).props['aria-label']).toBe('Board pages');
    expect(hook.actions.remove).not.toHaveBeenCalled();
  });

  it('Escape cancels confirmation before closing the chooser or another overlay', () => {
    const hook = mount(); const tree = hook.confirm();
    const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    dialog(tree).props.onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(dialog(hook.settle()).props['aria-label']).toBe('Board pages');
    expect(hook.actions.remove).not.toHaveBeenCalled();
    listeners.get('keydown')({ key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(dialog(hook.settle())).toBeUndefined();
    expect(focusTrigger).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('submits only the confirmed page, prevents repeats, and waits for acknowledgement', () => {
    const hook = mount(); button(hook.confirm(), 'Delete page').props.onClick();
    const waiting = hook.settle({ pending: true });
    expect(hook.actions.remove).toHaveBeenCalledExactlyOnceWith('page-two');
    expect(button(waiting, 'Deleting…').props.disabled).toBe(true);
    expect(button(waiting, 'Cancel').props.disabled).toBe(true);
    button(waiting, 'Deleting…').props.onClick();
    expect(hook.actions.remove).toHaveBeenCalledOnce();
    const complete = hook.settle({ pages: [pages[0]], pageId: pages[0].id, pending: false });
    expect(dialog(complete)).toBeUndefined();
    expect(focusTrigger).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('disables deleting the final page and explains why', () => {
    const hook = mount({ pages: [pages[0]], pageId: pages[0].id }); const tree = hook.open();
    expect(button(tree, 'Delete page').props.disabled).toBe(true);
    expect(button(tree, 'Delete page').props['aria-describedby']).toBe('board-pages-test-keep-page');
    expect(text(tree)).toContain('Keep at least one page.');
    button(tree, 'Delete page').props.onClick(); expect(hook.actions.remove).not.toHaveBeenCalled();
    expect(dialog(hook.settle()).props['aria-label']).toBe('Board pages');
  });

  it('cannot delete a different page after the active page changes during confirmation', () => {
    const hook = mount(); hook.confirm();
    const tree = hook.settle({ pageId: pages[0].id });
    expect(dialog(tree)).toBeUndefined(); expect(hook.actions.remove).not.toHaveBeenCalled();
  });

  it('keeps a failed request visible and lets the tutor retry after a connection error', () => {
    const hook = mount(); hook.actions.remove.mockReturnValueOnce(false);
    button(hook.confirm(), 'Delete page').props.onClick();
    const failed = hook.settle();
    expect(text(find(failed, node => node.props.role === 'alert'))).toContain('Reconnect');
    expect(dialog(failed).props['aria-label']).toBe('Delete “Build words”?');
    button(failed, 'Delete page').props.onClick(); hook.settle({ pending: true });
    const rejected = hook.settle({ pending: false, error: 'The board change was not confirmed. Try again.' });
    expect(button(rejected, 'Delete page').props.disabled).toBe(false);
    expect(text(rejected)).toContain('Try again.');
  });

  it('disables a confirmed deletion while disconnected or another page command is pending', () => {
    const hook = mount(); hook.confirm(); const tree = hook.settle({ ready: false });
    expect(button(tree, 'Delete page').props.disabled).toBe(true);
    button(tree, 'Delete page').props.onClick(); expect(hook.actions.remove).not.toHaveBeenCalled();
  });

  it('does not focus a hidden portal, and viewport changes do not steal focus', () => {
    const hook = mount(); trigger(hook.settle()).props.onClick();
    const hidden = hook.render(); expect(dialog(hidden).props.style.visibility).toBe('hidden');
    hook.flush(); expect(focusPage).not.toHaveBeenCalled();
    hook.settle(); expect(focusPage).toHaveBeenCalledOnce();
    focusPage.mockClear(); resized(); hook.settle(); expect(focusPage).not.toHaveBeenCalled();
  });

  it('outside pointer input dismisses confirmation without deleting or stealing focus', () => {
    const hook = mount(); hook.confirm(); listeners.get('pointerdown')({ target: {} });
    expect(dialog(hook.settle())).toBeUndefined();
    expect(hook.actions.remove).not.toHaveBeenCalled(); expect(focusTrigger).not.toHaveBeenCalled();
  });

  it('keeps the chooser within a narrowed and offset visual viewport', () => {
    window.visualViewport = { width: 240, height: 600, offsetLeft: 50, offsetTop: 20,
      addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const hook = mount(); const tree = hook.open();
    expect(dialog(tree).props.style.width).toBe(224);
    expect(dialog(tree).props.style.left).toBe(58);
    expect(dialog(tree).props.style.maxHeight).toBe(584);
    expect(window.innerHeight - dialog(tree).props.style.bottom).toBe(612);
  });

  it('hands focus to the new footer when an accepted deletion remounts Stage', () => {
    const hook = mount(); button(hook.confirm(), 'Delete page').props.onClick(); hook.settle({ pending: true });
    hook.unmount();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    const focusNewFooter = vi.fn(); document.querySelector = vi.fn(() => ({ focus: focusNewFooter }));
    requestAnimationFrame.mock.calls[0][0]();
    expect(document.querySelector).toHaveBeenCalledWith('[data-board-pages] button[aria-haspopup="dialog"]');
    expect(focusNewFooter).toHaveBeenCalledWith({ preventScroll: true });
  });
});
