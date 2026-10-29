import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWhiteboard } from './useWhiteboard.js';

// Run the production hook with retained state/refs and explicit effect replay, as in
// StrictMode/Fast Refresh. Transport and frame clocks remain controlled by the tests.
const hooks = vi.hoisted(() => ({ current: null }));
vi.mock('react', () => ({
  useState: (value) => hooks.current.useState(value),
  useRef: (value) => hooks.current.useRef(value),
  useEffect: (effect, dependencies) => hooks.current.useEffect(effect, dependencies),
  useCallback: (callback, dependencies) => hooks.current.useMemo(() => callback, dependencies),
  useMemo: (factory, dependencies) => hooks.current.useMemo(factory, dependencies),
}));
const mounted = [];
const changed = (previous, next) => !previous || next.some((item, n) => !Object.is(item, previous[n]));
function mountBoard() {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const slots = [];
  const send = vi.fn();
  let cursor = 0, dirty = true, effects = [], board;
  const runtime = {
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (next) => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; dirty = true; }];
    },
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useMemo(factory, dependencies) {
      const i = cursor++;
      if (changed(slots[i]?.dependencies, dependencies)) slots[i] = { dependencies, value: factory() };
      return slots[i].value;
    },
    useEffect(setup, dependencies) {
      const i = cursor++;
      const previous = slots[i];
      if (changed(previous?.dependencies, dependencies)) effects.push(() => { previous?.cleanup?.(); slots[i] = { setup, dependencies, cleanup: setup() }; });
    },
  };
  const render = () => {
    while (dirty) {
      dirty = false; cursor = 0; hooks.current = runtime;
      try { board = useWhiteboard('tutor', send); } finally { hooks.current = null; }
      const pending = effects; effects = []; pending.forEach((effect) => effect());
    }
  };
  const result = {
    get value() { render(); return board; }, send,
    messages: () => send.mock.calls.map(([message]) => message),
    replay() {
      slots.forEach((slot) => slot.cleanup?.());
      slots.forEach((slot) => { if (slot.setup) slot.cleanup = slot.setup(); });
    },
    unmount() { slots.forEach((slot) => { slot.cleanup?.(); slot.cleanup = null; }); },
  };
  mounted.push(result);
  return result;
}
afterEach(() => {
  mounted.splice(0).forEach((hook) => hook.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('whiteboard transport after effect cleanup and setup', () => {
  it('discards pre-refresh queued moves and resumes all pointer/object channels', () => {
    const hook = mountBoard();
    for (const name of ['p', 'tile', 'piece', 'hand-r']) hook.value.sendThrottled(name, { t: 'before-refresh', name });
    hook.replay();
    vi.advanceTimersByTime(100);
    expect(hook.messages()).toEqual([]);
    for (const name of ['p', 'tile', 'piece', 'hand-r']) hook.value.sendThrottled(name, { t: 'after-refresh', name });
    vi.advanceTimersByTime(34);
    expect(hook.messages()).toEqual(['p', 'tile', 'piece', 'hand-r'].map((name) => ({ t: 'after-refresh', name })));
    // The resumed channel still sends only its newest move in a throttle interval.
    hook.value.sendPointer({ t: 'p', x: 0.2, y: 0.2 });
    hook.value.sendPointer({ t: 'p', x: 0.3, y: 0.4 });
    vi.advanceTimersByTime(34);
    expect(hook.messages().at(-1)).toEqual({ t: 'p', x: 0.3, y: 0.4 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets canceled movement be replaced immediately without replaying its old payload', () => {
    const hook = mountBoard();
    hook.value.sendPointer({ t: 'p', x: 0.1, y: 0.1 });
    hook.value.cancelThrottled('p');
    hook.value.sendPointer({ t: 'p', x: 0.8, y: 0.9 });
    vi.advanceTimersByTime(34);
    expect(hook.messages()).toEqual([{ t: 'p', x: 0.8, y: 0.9 }]);
    hook.value.cancelThrottled('p');
    hook.replay();
    hook.value.sendPointer({ t: 'p', x: 0.4, y: 0.5 });
    vi.advanceTimersByTime(34);
    expect(hook.messages().at(-1)).toEqual({ t: 'p', x: 0.4, y: 0.5 });
  });

  it('flushes and ends pending ink exactly once, then lets a new stroke stream normally', () => {
    const hook = mountBoard();
    hook.value.stroke.start('pen', { x: 100, y: 200 });
    hook.value.stroke.move([{ x: 120, y: 210 }, { x: 140, y: 220 }]);
    const firstId = hook.messages()[0].id;
    expect(hook.messages().map(({ t }) => t)).toEqual(['s']);
    hook.replay();
    expect(hook.messages()).toEqual([
      { t: 's', id: firstId, tool: 'pen', x: 100, y: 200 },
      { t: 'm', id: firstId, pts: [120, 210, 140, 220] },
      { t: 'e', id: firstId },
    ]);
    expect(hook.value.board.strokes[0].done).toBe(true);
    vi.advanceTimersByTime(100);
    expect(hook.messages()).toHaveLength(3);
    hook.value.stroke.start('pen', { x: 300, y: 400 });
    hook.value.stroke.move([{ x: 320, y: 410 }]);
    vi.advanceTimersByTime(41);
    const secondId = hook.messages()[3].id;
    expect(hook.messages().slice(-2)).toEqual([
      { t: 's', id: secondId, tool: 'pen', x: 300, y: 400 },
      { t: 'm', id: secondId, pts: [320, 410] },
    ]);
    hook.value.stroke.end();
    expect(hook.messages().at(-1)).toEqual({ t: 'e', id: secondId });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears every transport timer on unmount without sending queued pointer movement', () => {
    const hook = mountBoard();
    hook.value.sendPointer({ t: 'p', x: 0.5, y: 0.5 });
    hook.value.sendThrottled('piece', { t: 'piece:move', id: 'picture', x: 20, y: 30 });
    hook.unmount();
    vi.advanceTimersByTime(100);
    expect(hook.messages()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
