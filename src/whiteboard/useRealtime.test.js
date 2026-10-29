import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRealtime } from './useRealtime.js';

// The hook's transport is exercised with controlled socket events, including events
// already queued when an old connection is closed. No network or room fixtures needed.
const runtime = vi.hoisted(() => ({ effects: [], statuses: [] }));
vi.mock('react', () => ({
  useCallback: (fn) => fn,
  useRef: (current) => ({ current }),
  useState: (initial) => [initial, (value) => runtime.statuses.push(value)],
  useEffect: (setup) => runtime.effects.push(setup),
}));
let cleanup;
const sockets = [];
class Socket {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  send(value) { this.sent.push(JSON.parse(value)); }
  message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
}
function mount() {
  vi.useFakeTimers();
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:3000' } });
  vi.stubGlobal('WebSocket', Socket);
  const receive = vi.fn();
  const hook = useRealtime({ hello: () => ({ t: 'create' }), onMessage: receive });
  cleanup = runtime.effects[0]();
  return { hook, receive };
}
afterEach(() => {
  cleanup?.(); cleanup = null;
  sockets.length = 0; runtime.effects.length = 0; runtime.statuses.length = 0;
  vi.unstubAllGlobals(); vi.useRealTimers();
});
describe('connection authority', () => {
  it('delivers only the active socket after effect replay', () => {
    const { receive, hook } = mount();
    const old = sockets[0]; old.open();
    old.message({ t: 'room', code: '1234' });
    expect(receive).toHaveBeenCalledTimes(1);
    cleanup(); cleanup = runtime.effects[0]();
    const current = sockets[1]; current.open();
    old.message({ t: 'board', reason: 'sync', stale: true });
    old.message({ t: 'hand', by: null, x: 0.1, y: 0.1 });
    current.message({ t: 'board', reason: 'sync', current: true });
    expect(receive.mock.calls.map(([value]) => value)).toEqual([{ t: 'room', code: '1234' }, { t: 'board', reason: 'sync', current: true }]);
    hook.send({ t: 'clear' });
    expect(current.sent).toEqual([{ t: 'create' }, { t: 'clear' }]);
    expect(old.sent).toEqual([{ t: 'create' }]);
  });

  it('ignores a delayed open/close from a disposed socket', () => {
    mount();
    const old = sockets[0];
    cleanup(); cleanup = runtime.effects[0]();
    old.open(); old.close(4000);
    expect(old.sent).toEqual([]);
    expect(runtime.statuses).toEqual([]);
    vi.advanceTimersByTime(10000);
    expect(sockets).toHaveLength(2);
  });

  it('reconnects once and rejects messages from the previous connection', () => {
    const { receive } = mount();
    const old = sockets[0]; old.open(); old.close();
    old.message({ t: 'board', stale: 'during-backoff' });
    expect(receive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    const current = sockets[1]; current.open();
    old.message({ t: 'board', stale: true });
    current.message({ t: 'room', code: '1234' });
    expect(receive).toHaveBeenCalledExactlyOnceWith({ t: 'room', code: '1234' });
    expect(runtime.statuses).toEqual(['open', 'connecting', 'open']);
  });
});
