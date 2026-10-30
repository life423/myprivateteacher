import { describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ current: null }));
vi.mock('react', () => ({
  useState: value => hooks.current.useState(value),
  useRef: value => hooks.current.useRef(value),
  useCallback: fn => fn,
  useLayoutEffect: (setup, deps) => hooks.current.useLayoutEffect(setup, deps),
}));
import { useTutorGuideView } from './useTutorGuideView.js';
function mount(initial = false) {
  const slots = []; let cursor = 0, effects = [], dirty = true, active = initial, result;
  const runtime = {
    useState(value) { const n = cursor++; slots[n] ??= { value }; return [slots[n].value, next => { const value = typeof next === 'function' ? next(slots[n].value) : next; if (!Object.is(value, slots[n].value)) { slots[n].value = value; dirty = true; } }]; },
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useLayoutEffect(setup, deps) { const n = cursor++, old = slots[n]; if (!old || deps.some((v, i) => !Object.is(v, old.deps[i]))) effects.push(() => { old?.cleanup?.(); slots[n] = { deps, cleanup: setup() }; }); },
  };
  const render = () => { while (dirty) { dirty = false; cursor = 0; hooks.current = runtime; try { result = useTutorGuideView(active); } finally { hooks.current = null; } const pending = effects; effects = []; pending.forEach(run => run()); } return result; };
  return { get view() { return render()[0]; }, set(next) { render()[1](next); render(); }, guide(next) { active = next; dirty = true; render(); }, resize() { dirty = true; render(); } };
}
const prior = { scale: 1.3, cx: 700, cy: 450 };
describe('tutor-local docked guide view', () => {
  it('temporarily fits the whole board and restores the previous view on close', () => {
    const board = mount(); board.set(prior); board.guide(true); expect(board.view).toBe(null);
    board.resize(); board.resize(); expect(board.view).toBe(null);
    board.guide(false); expect(board.view).toEqual(prior);
  });
  it('keeps a tutor zoom or pan made while the guide is open', () => {
    const board = mount(); board.set(prior); board.guide(true);
    const chosen = { scale: 0.7, cx: 400, cy: 300 }; board.set(chosen);
    board.guide(false); expect(board.view).toEqual(chosen);
  });
  it('keeps the newly focused lesson picture instead of restoring an earlier view', () => {
    const board = mount(); board.set(prior); board.guide(true);
    const worksheet = { scale: 0.8, cx: 800, cy: 550 }; board.set(worksheet);
    board.resize(); board.guide(false); expect(board.view).toEqual(worksheet);
  });
  it('honors an explicit Fit command even when the temporary view is already fitted', () => {
    const board = mount(); board.set(prior); board.guide(true); board.set(null);
    board.guide(false); expect(board.view).toBe(null);
  });
  it('does not restore a prior page after Stage mounts for a different page or epoch', () => {
    const oldPage = mount(); oldPage.set(prior); oldPage.guide(true);
    const nextPage = mount(true); nextPage.guide(false); expect(nextPage.view).toBe(null);
  });
  it('starts a fresh lease on reopening and leaves inactive views untouched', () => {
    const board = mount(); board.set(prior); board.guide(true); board.guide(false);
    const latest = { scale: 0.9, cx: 600, cy: 300 }; board.set(() => latest);
    board.resize(); expect(board.view).toEqual(latest);
    board.guide(true); board.guide(false); expect(board.view).toEqual(latest);
  });
});
