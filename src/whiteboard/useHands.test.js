import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHands } from './useHands.js';
import { STAGE } from './stage.js';

// Exercise the real hook and hand protocol with controlled renders and timers, without
// requiring a browser or a live room. Queued movement behaves like useWhiteboard's throttle.
const hooks = vi.hoisted(() => ({ current: null }));
vi.mock('react', () => ({
  useCallback: (callback) => callback,
  useState: (initial) => hooks.current.useState(initial),
  useRef: (initial) => hooks.current.useRef(initial),
  useEffect: (effect, dependencies) => hooks.current.useEffect(effect, dependencies),
}));
const mounted = [];
function mountHands(me = 'tutor') {
  vi.useFakeTimers();
  const slots = [];
  let cursor = 0;
  let dirty = true;
  let result;
  let effects = [];
  const pending = new Map();
  const send = vi.fn();
  const cancelThrottled = vi.fn((name) => {
    clearTimeout(pending.get(name)?.timer);
    pending.delete(name);
  });
  const sendThrottled = (name, message) => {
    const channel = pending.get(name);
    if (channel) { channel.message = message; return; }
    const next = { message, timer: null };
    next.timer = setTimeout(() => { pending.delete(name); send(next.message); }, 33);
    pending.set(name, next);
  };
  const runtime = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (next) => {
        slots[i].value = typeof next === 'function' ? next(slots[i].value) : next;
        dirty = true;
      }];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect(effect, dependencies) {
      const i = cursor++;
      const previous = slots[i];
      if (!previous || dependencies.some((item, index) => !Object.is(item, previous.dependencies[index]))) {
        effects.push(() => { previous?.cleanup?.(); slots[i] = { dependencies, setup: effect, cleanup: effect() }; });
      }
    },
  };
  const render = () => {
    if (!dirty) return;
    dirty = false;
    cursor = 0;
    hooks.current = runtime;
    try { result = useHands({ me, send, sendThrottled, cancelThrottled }); } finally { hooks.current = null; }
    const nextEffects = effects;
    effects = [];
    nextEffects.forEach((effect) => effect());
  };
  const hook = {
    get value() { render(); return result; }, send, pending, cancelThrottled,
    messages: () => send.mock.calls.map(([message]) => message),
    replayEffects() { slots.forEach((slot) => { if (slot.setup) { slot.cleanup?.(); slot.cleanup = slot.setup(); } }); },
    unmount() { slots.forEach((slot) => { slot.cleanup?.(); slot.cleanup = null; }); },
  };
  mounted.push(hook);
  return hook;
}
const hand = (on, x = 0.5, y = 0.17, letter = null, by = null) => ({ on, x, y, letter, by });
const snapshot = (hook, r, l = hand(false)) => hook.value.handle({ t: 'hands', hands: { r, l } });

afterEach(() => {
  mounted.splice(0).forEach((hook) => hook.unmount());
  vi.useRealTimers();
});

describe('borrowing the existing shared glove for an alphabet letter', () => {
  it('hides one original locally, moves it through the shared protocol, and leaves it at a successful drop', () => {
    const hook = mountHands();
    snapshot(hook, hand(true, 0.6, 0.17, 'A'));
    expect(hook.value.beginLetterPickup('C', { x: 170, y: 75 })).toBe('r');
    expect(hook.value.visible).toEqual([]);
    expect(hook.value.hands.r).toMatchObject({ on: true, by: 'tutor', x: 170, y: 75, letter: 'C' });
    hook.value.moveLetterPickup({ x: 800, y: 600 });
    hook.value.restore();
    expect(hook.messages().at(-1)).toMatchObject({ t: 'hands', r: true, at: { r: { x: 0.5, y: 0.6 } } });
    hook.value.finishLetterPickup({ x: 820, y: 620 });
    expect(hook.messages().slice(-2)).toEqual([
      { t: 'hand', side: 'r', a: 'move', x: 0.5125, y: 0.62, letter: null },
      { t: 'hand', side: 'r', a: 'drop' },
    ]);
    expect(hook.value.visible).toHaveLength(1);
    expect(hook.value.hands.r).toMatchObject({ on: true, by: null, x: 820, y: 620 });
    expect(hook.pending.size).toBe(0);
    const count = hook.messages().length;
    vi.advanceTimersByTime(5000);
    expect(hook.messages()).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('prefers the matching left glove and restores its exact origin on cancellation', () => {
    const hook = mountHands();
    snapshot(hook, hand(true, 0.6, 0.17, 'B'), hand(true, 0.2, 0.1, 'A'));
    expect(hook.value.beginLetterPickup('A', { x: 50, y: 50 })).toBe('l');
    expect(hook.value.visible.map(({ side }) => side)).toEqual(['r']);
    hook.value.moveLetterPickup({ x: 900, y: 700 });
    hook.value.finishLetterPickup();
    expect(hook.value.hands.l).toEqual({ on: true, by: null, x: 320, y: 100, letter: 'A' });
    expect(hook.messages().slice(-2)).toEqual([
      { t: 'hand', side: 'l', a: 'move', x: 0.2, y: 0.1, letter: 'A' },
      { t: 'hand', side: 'l', a: 'drop' },
    ]);
    const count = hook.messages().length;
    vi.advanceTimersByTime(5000);
    expect(hook.messages()).toHaveLength(count);
  });

  it('falls back to the right glove and never takes a peer-held glove, even as tutor', () => {
    const hook = mountHands();
    snapshot(hook, hand(true), hand(true));
    expect(hook.value.beginLetterPickup('Z', { x: 1500, y: 80 })).toBe('r');
    hook.value.finishLetterPickup();
    snapshot(hook, hand(true, 0.6, 0.17, 'Z', 'student'), hand(false));
    hook.send.mockClear();
    expect(hook.value.beginLetterPickup('Z', { x: 1500, y: 80 })).toBeNull();
    expect(hook.messages()).toEqual([]);
    expect(hook.value.visible).toHaveLength(1);
    snapshot(hook, hand(false), hand(false));
    hook.send.mockClear();
    expect(hook.value.beginLetterPickup('Z', { x: 1500, y: 80 })).toBeNull();
    expect(hook.messages()).toEqual([]);
    expect(hook.value.hands.r.on).toBe(false);
  });

  it('can borrow a locally held glove without leaving a second keepalive timer', () => {
    const hook = mountHands();
    expect(hook.value.grab('r')).toBe(true);
    expect(hook.value.beginLetterPickup('A', { x: 50, y: 50 })).toBe('r');
    vi.advanceTimersByTime(2033);
    expect(hook.messages().filter((message) => message.a === 'grab')).toHaveLength(3); // two grabs, one keepalive
    hook.value.finishLetterPickup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts authoritative takeover without restoring over the new owner', () => {
    const hook = mountHands('student');
    hook.value.beginLetterPickup('A', { x: 50, y: 50 });
    hook.value.moveLetterPickup({ x: 700, y: 600 });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.25, 0.3, null, 'tutor') });
    hook.send.mockClear();
    hook.value.finishLetterPickup();
    expect(hook.value.visible).toHaveLength(1);
    expect(hook.value.hands.r).toMatchObject({ by: 'tutor', x: 400, y: 300 });
    vi.advanceTimersByTime(5000);
    expect(hook.messages()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps optimistic coordinates in an ownership acknowledgement snapshot, then cancels when switched off', () => {
    const hook = mountHands();
    hook.value.beginLetterPickup('A', { x: 50, y: 50 });
    hook.value.moveLetterPickup({ x: 777, y: 555 });
    snapshot(hook, hand(true, 0.6, 0.17, null, 'tutor'));
    expect(hook.value.hands.r).toMatchObject({ x: 777, y: 555, by: 'tutor' });
    expect(hook.value.visible).toEqual([]);
    snapshot(hook, hand(false));
    hook.send.mockClear();
    hook.value.finishLetterPickup();
    vi.advanceTimersByTime(5000);
    expect(hook.value.visible).toEqual([]);
    expect(hook.messages()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('restores and releases on unmount with no delayed moves or keepalive left behind', () => {
    const hook = mountHands();
    snapshot(hook, hand(true, 0.3, 0.12, 'H'));
    hook.value.beginLetterPickup('A', { x: 50, y: 50 });
    hook.value.moveLetterPickup({ x: 500, y: 500 });
    hook.unmount();
    expect(hook.messages().slice(-2)).toEqual([
      { t: 'hand', side: 'r', a: 'move', x: 0.3, y: 0.12, letter: 'H' },
      { t: 'hand', side: 'r', a: 'drop' },
    ]);
    const count = hook.messages().length;
    vi.advanceTimersByTime(5000);
    expect(hook.messages()).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses mobile row letters when supplied, rather than recalculating them from desktop coordinates', () => {
    const hook = mountHands();
    hook.value.beginLetterPickup('P', { x: 50, y: 50 });
    hook.value.moveLetterPickup({ x: 50, y: 50, letter: 'P' });
    vi.advanceTimersByTime(33);
    expect(hook.messages().at(-1)).toMatchObject({ a: 'move', letter: 'P', x: 0.0313, y: 0.05 });
    hook.value.finishLetterPickup({ x: STAGE.width / 2, y: STAGE.height / 2 });
  });

  it('keeps a second pickup held when the first drop acknowledgement arrives late', () => {
    const hook = mountHands();
    hook.value.beginLetterPickup('A', { x: 50, y: 50 });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.03125, 0.05, 'A', 'tutor') });
    hook.value.finishLetterPickup({ x: 800, y: 600 });
    hook.value.beginLetterPickup('B', { x: 110, y: 50 });
    hook.value.moveLetterPickup({ x: 950, y: 650 });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.5, 0.6, null, null) });
    expect(hook.value.visible).toEqual([]);
    expect(hook.value.hands.r).toMatchObject({ by: 'tutor', x: 950, y: 650 });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.06875, 0.05, 'B', 'tutor') });
    expect(hook.value.visible).toEqual([]);
    expect(hook.value.hands.r).toMatchObject({ by: 'tutor', x: 950, y: 650 });
    hook.value.finishLetterPickup({ x: 1000, y: 700 });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.625, 0.7) });
    expect(hook.value.visible).toHaveLength(1);
    expect(hook.value.hands.r).toMatchObject({ by: null, x: 1000, y: 700 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores both older grab and drop echoes when a new pickup starts before either arrives', () => {
    const hook = mountHands();
    hook.value.beginLetterPickup('A', { x: 50, y: 50 });
    hook.value.finishLetterPickup({ x: 800, y: 600 });
    hook.value.beginLetterPickup('B', { x: 110, y: 50 });
    hook.value.moveLetterPickup({ x: 950, y: 650 });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.03125, 0.05, 'A', 'tutor') });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.5, 0.6) });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.06875, 0.05, 'B', 'tutor') });
    expect(hook.value.visible).toEqual([]);
    expect(hook.value.hands.r).toMatchObject({ by: 'tutor', x: 950, y: 650 });
    // After the current grab is acknowledged, an unsolicited release is authoritative.
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.4, 0.4) });
    expect(hook.value.visible).toHaveLength(1);
    expect(hook.value.hands.r).toMatchObject({ by: null, x: 640, y: 400 });
    hook.send.mockClear();
    hook.value.finishLetterPickup();
    vi.advanceTimersByTime(5000);
    expect(hook.messages()).toEqual([]);
  });

  it('does not reclose or rewind a completed glove on its delayed own grab echo', () => {
    const hook = mountHands();
    hook.value.beginLetterPickup('A', { x: 50, y: 50 });
    hook.value.finishLetterPickup({ x: 800, y: 600 });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.6, 0.17, null, 'tutor') });
    expect(hook.value.hands.r).toMatchObject({ by: null, x: 800, y: 600 });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.5, 0.6) });
    expect(hook.value.hands.r).toMatchObject({ by: null, x: 800, y: 600 });
  });

  it('lets peer ownership and reconnect snapshots override pending local echoes', () => {
    const hook = mountHands();
    hook.value.beginLetterPickup('A', { x: 50, y: 50 });
    hook.value.finishLetterPickup({ x: 800, y: 600 });
    hook.value.beginLetterPickup('B', { x: 110, y: 50 });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.3, 0.4, null, 'student') });
    expect(hook.value.visible).toHaveLength(1);
    expect(hook.value.hands.r).toMatchObject({ by: 'student', x: 480, y: 400 });
    expect(vi.getTimerCount()).toBe(0);
    snapshot(hook, hand(true));
    hook.value.beginLetterPickup('C', { x: 170, y: 50 });
    hook.value.handle({ t: 'board', hands: { r: hand(true, 0.2, 0.3), l: hand(false) } });
    expect(hook.value.visible).toHaveLength(1);
    expect(hook.value.hands.r).toMatchObject({ by: null, x: 320, y: 300 });
    hook.send.mockClear();
    hook.value.finishLetterPickup();
    vi.advanceTimersByTime(5000);
    expect(hook.messages()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });


  it('restores the visible original and reconciles retained React state when effects replay during a carry', () => {
    const hook = mountHands();
    snapshot(hook, hand(true, 0.3, 0.12, 'H'));
    hook.value.beginLetterPickup('A', { x: 50, y: 50 });
    hook.value.moveLetterPickup({ x: 700, y: 600 });
    expect(hook.value.visible).toEqual([]);
    expect(hook.value.hands.r).toMatchObject({ by: 'tutor', x: 700, y: 600 });
    hook.replayEffects();
    expect(hook.value.visible).toHaveLength(1);
    expect(hook.value.hands.r).toEqual({ on: true, by: null, x: 480, y: 120, letter: 'H' });
    expect(hook.messages().slice(-2)).toEqual([
      { t: 'hand', side: 'r', a: 'move', x: 0.3, y: 0.12, letter: 'H' },
      { t: 'hand', side: 'r', a: 'drop' },
    ]);
    expect(hook.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const count = hook.messages().length;
    vi.advanceTimersByTime(5000);
    expect(hook.messages()).toHaveLength(count);
    expect(hook.value.beginLetterPickup('B', { x: 110, y: 50 })).toBe('r');
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.3, 0.12, 'H', 'tutor') });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.3, 0.12, 'H') });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.06875, 0.05, 'B', 'tutor') });
    expect(hook.value.visible).toEqual([]);
    expect(hook.value.hands.r).toMatchObject({ by: 'tutor', x: 110, y: 50 });
    hook.value.finishLetterPickup();
    expect(hook.value.visible).toHaveLength(1);
    expect(hook.value.hands.r).toMatchObject({ by: null, x: 480, y: 120 });
  });

});
