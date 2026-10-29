import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHands } from './useHands.js';

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

describe('shared pointing hands', () => {
  it('keeps enabled hands visible while they are held and commits the final pose atomically', () => {
    const hook = mountHands();
    expect(hook.value.visible.map(hand => hand.side)).toEqual(['r']);
    expect(hook.value.grab('r')).toBe(true);
    hook.value.move('r', { x: 800, y: 500, letter: null });
    expect(hook.value.visible[0]).toMatchObject({ side: 'r', by: 'tutor', x: 800, y: 500 });
    hook.value.drop('r');
    expect(hook.messages().at(-1)).toEqual({ t: 'hand', side: 'r', a: 'drop', x: 0.5, y: 0.5, letter: null });
    expect(hook.pending.size).toBe(0);
    expect(hook.value.visible[0]).toMatchObject({ by: null, x: 800, y: 500 });
    const count = hook.messages().length;
    vi.advanceTimersByTime(5000);
    expect(hook.messages()).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves the pointing letter through display, restoration, and release', () => {
    const hook = mountHands();
    snapshot(hook, hand(true, 0.2, 0.1, 'H'), hand(true, 0.7, 0.2, 'Q'));
    expect(hook.value.letters).toEqual(['Q', 'H']);
    hook.value.grab('l');
    hook.value.move('l', { x: 640, y: 100, letter: 'K' });
    hook.value.restore();
    expect(hook.messages().at(-1)).toMatchObject({ t: 'hands', r: true, l: true, at: { l: { x: 0.4, y: 0.1, letter: 'K' } } });
    hook.value.drop('l');
    expect(hook.messages().at(-1)).toMatchObject({ a: 'drop', side: 'l', x: 0.4, y: 0.1, letter: 'K' });
  });

  it('allows tutor takeover, rejects student takeover, and never grabs a disabled hand', () => {
    const student = mountHands('student');
    snapshot(student, hand(true, 0.6, 0.17, null, 'tutor'));
    expect(student.value.grab('r')).toBe(false);
    expect(student.value.grab('l')).toBe(false);
    expect(student.messages()).toEqual([]);
    const tutor = mountHands();
    snapshot(tutor, hand(true, 0.6, 0.17, null, 'student'));
    expect(tutor.value.grab('r')).toBe(true);
    expect(tutor.messages().at(-1)).toMatchObject({ a: 'grab', side: 'r' });
  });

  it('keeps only one ownership keepalive timer when regrabbing the same hand', () => {
    const hook = mountHands();
    hook.value.grab('r'); hook.value.grab('r');
    vi.advanceTimersByTime(2033);
    expect(hook.messages().filter(message => message.a === 'grab')).toHaveLength(3);
    hook.value.drop('r');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let a delayed previous release cancel a new direct hold', () => {
    const hook = mountHands();
    hook.value.grab('r');
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.6, 0.17, null, 'tutor') });
    hook.value.move('r', { x: 800, y: 500 }); hook.value.drop('r');
    hook.value.grab('r'); hook.value.move('r', { x: 1000, y: 700 });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.5, 0.5) });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.5, 0.5, null, 'tutor') });
    expect(hook.value.hands.r).toMatchObject({ by: 'tutor', x: 1000, y: 700 });
    hook.value.drop('r');
    expect(hook.messages().at(-1)).toMatchObject({ a: 'drop', x: 0.625, y: 0.7 });
  });

  it('does not re-hold a completed gesture when its own grab acknowledgement is delayed', () => {
    const hook = mountHands();
    hook.value.grab('r'); hook.value.move('r', { x: 800, y: 500 }); hook.value.drop('r');
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.6, 0.17, null, 'tutor') });
    expect(hook.value.hands.r).toMatchObject({ by: null, x: 800, y: 500 });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.5, 0.5) });
    expect(hook.value.hands.r).toMatchObject({ by: null, x: 800, y: 500 });
  });

  it.each(['clear', 'restore'])('preserves an ongoing direct hold through a routine %s snapshot', reason => {
    const hook = mountHands();
    hook.value.grab('r');
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.6, 0.17, null, 'tutor') });
    hook.value.move('r', { x: 700, y: 500 });
    const epoch = hook.value.interactionEpoch;
    hook.value.handle({ t: 'board', reason, hands: { r: hand(true, 0.6, 0.17, null, 'tutor'), l: hand(false) } });
    expect(hook.value.interactionEpoch).toBe(epoch);
    expect(hook.value.hands.r).toMatchObject({ by: 'tutor', x: 700, y: 500 });
  });

  it.each(['peer', 'disabled'])('stops a direct hold and queued motion when authority changes (%s)', reason => {
    const hook = mountHands('student');
    hook.value.grab('r'); hook.value.move('r', { x: 800, y: 600 });
    const epoch = hook.value.interactionEpoch;
    hook.value.handle({ t: 'hand', side: 'r', ...hand(reason !== 'disabled', 0.25, 0.3, null, reason === 'peer' ? 'tutor' : null) });
    expect(hook.value.interactionEpoch).toBeGreaterThan(epoch);
    hook.send.mockClear(); hook.value.drop('r'); vi.advanceTimersByTime(5000);
    expect(hook.messages()).toEqual([]);
    expect(hook.value.hands.r).toMatchObject({ x: 400, y: 300 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['sync', undefined])('ends local gestures at a synchronization boundary (%s)', reason => {
    const hook = mountHands();
    hook.value.grab('r'); hook.value.move('r', { x: 800, y: 600 });
    const epoch = hook.value.interactionEpoch;
    hook.value.handle({ t: 'board', reason, hands: { r: hand(true, 0.2, 0.3), l: hand(false) } });
    expect(hook.value.interactionEpoch).toBeGreaterThan(epoch);
    hook.send.mockClear(); hook.value.drop('r'); vi.advanceTimersByTime(5000);
    expect(hook.messages()).toEqual([]);
    expect(hook.value.hands.r).toMatchObject({ by: null, x: 320, y: 300 });
  });

  it('cancels queued work on disconnect without writing into a replacement connection', () => {
    const hook = mountHands();
    hook.value.grab('r'); hook.value.move('r', { x: 800, y: 600 });
    const epoch = hook.value.interactionEpoch;
    hook.send.mockClear(); hook.value.disconnect(); hook.value.drop('r');
    vi.advanceTimersByTime(5000);
    expect(hook.value.interactionEpoch).toBeGreaterThan(epoch);
    expect(hook.messages()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the last displayed pose on effect cleanup and can resume after replay', () => {
    const hook = mountHands();
    hook.value.grab('r'); hook.value.move('r', { x: 800, y: 500 });
    hook.replayEffects();
    expect(hook.messages().at(-1)).toEqual({ t: 'hand', side: 'r', a: 'drop', x: 0.5, y: 0.5, letter: null });
    expect(hook.value.hands.r).toMatchObject({ by: null, x: 800, y: 500 });
    expect(hook.pending.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    hook.value.grab('r'); hook.value.move('r', { x: 960, y: 600 });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.6, 0.17, null, 'tutor') });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.5, 0.5) });
    hook.value.handle({ t: 'hand', side: 'r', ...hand(true, 0.5, 0.5, null, 'tutor') });
    expect(hook.value.hands.r).toMatchObject({ by: 'tutor', x: 960, y: 600 });
    hook.unmount(); expect(vi.getTimerCount()).toBe(0);
  });

  it('turning off a held hand cancels motion and invalidates its local gesture', () => {
    const hook = mountHands();
    hook.value.grab('r'); hook.value.move('r', { x: 800, y: 500 });
    const epoch = hook.value.interactionEpoch;
    hook.value.show('r', false);
    expect(hook.value.visible).toEqual([]);
    expect(hook.value.interactionEpoch).toBeGreaterThan(epoch);
    const count = hook.messages().length;
    vi.advanceTimersByTime(5000);
    expect(hook.messages()).toHaveLength(count);
    expect(hook.messages().at(-1)).toEqual({ t: 'hands', r: false });
  });

  it('ignores malformed movement rather than poisoning the final pose', () => {
    const hook = mountHands();
    hook.value.grab('r'); hook.value.move('r', { x: NaN, y: 500 }); hook.value.drop('r');
    expect(hook.messages().at(-1)).toMatchObject({ a: 'drop', x: 0.6, y: 0.17 });
  });
});
