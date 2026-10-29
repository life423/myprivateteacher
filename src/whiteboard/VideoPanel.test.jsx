import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Drive the component's real state/effects through rerenders without requesting media.
const hooks = vi.hoisted(() => ({ current: null }));
vi.mock('react', () => ({
  useState: (value) => hooks.current.useState(value),
  useRef: (value) => hooks.current.useRef(value),
  useEffect: (setup, dependencies) => hooks.current.useEffect(setup, dependencies),
  useLayoutEffect: (setup, dependencies) => hooks.current.useEffect(setup, dependencies),
}));
import VideoPanel from './VideoPanel.jsx';
const mounted = [];
function mount(props = {}, element = null) {
  const call = { localStream: null, remoteStream: null, status: 'off', micOn: true, camOn: true, peerOnVideo: false, details: [], start: vi.fn(), stop: vi.fn(), toggleMic: vi.fn(), toggleCam: vi.fn(), ...props.call };
  let currentProps = { call, peerName: 'student', fill: true, ...props, call };
  const slots = []; let cursor = 0, dirty = true, tree, effects = [];
  const runtime = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (next) => {
        const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; }
      }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(setup, dependencies) {
      const i = cursor++, previous = slots[i];
      if (!previous || dependencies.some((value, n) => !Object.is(value, previous.dependencies[n]))) {
        effects.push(() => { previous?.cleanup?.(); slots[i] = { dependencies, cleanup: setup() }; });
      }
    },
  };
  const render = () => {
    for (let attempts = 0; dirty; attempts++) {
      if (attempts > 10) throw new Error('VideoPanel did not settle');
      dirty = false; cursor = 0; hooks.current = runtime;
      try { tree = VideoPanel(currentProps); } finally { hooks.current = null; }
      if (element) tree.ref.current = element;
      const pending = effects; effects = []; pending.forEach((effect) => effect());
    }
    return tree;
  };
  const panel = {
    call,
    get tree() { return render(); },
    update(next) { currentProps = { ...currentProps, ...next }; dirty = true; return render(); },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); },
  };
  mounted.push(panel); render(); return panel;
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
});
afterEach(() => { mounted.splice(0).forEach((panel) => panel.unmount()); vi.unstubAllGlobals(); });
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
const text = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '';
function button(panel, label) {
  const found = nodes(panel.tree).find((node) => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label));
  expect(found, `Expected button ${label}`).toBeTruthy(); return found;
}
const state = (panel) => panel.tree.props['data-video-state'];
const activeCall = () => ({ localStream: { id: 'local' }, remoteStream: { id: 'remote' }, status: 'connected' });

describe('compact video panel', () => {
  it('starts idle in one compact row with a direct Start video action and no permission request', () => {
    const panel = mount();
    expect(state(panel)).toBe('compact');
    expect(nodes(panel.tree).some((node) => node.props?.className?.includes('aspect-[4/3]'))).toBe(false);
    expect(panel.call.start).not.toHaveBeenCalled();
    button(panel, 'Start video').props.onClick();
    expect(panel.call.start).toHaveBeenCalledOnce();
    expect(state(panel)).toBe('expanded');
  });

  it('fits expanded media and call controls inside a short landscape board', () => {
    const media = { clientWidth: 192, getBoundingClientRect: () => ({ height: 144 }) };
    const host = { clientHeight: 181, querySelector: () => null };
    const element = { closest: (selector) => selector === 'main' ? host : null, querySelector: () => media, getBoundingClientRect: () => ({ height: 264 }) };
    const panel = mount({ floating: true, call: activeCall() }, element);
    button(panel, 'Show video').props.onClick();
    expect(panel.tree.props.children[1].props.style.height).toBe(37);
    expect(37 + 120 + 24).toBe(host.clientHeight);
    expect(panel.tree.props.children[0].props.className).toContain('absolute');
    expect(panel.tree.props.children[0].props.children[0].props.className).toBe('sr-only');
    expect(state(panel)).toBe('expanded');
    expect(panel.call.stop).not.toHaveBeenCalled();
  });

  it('uses the compact video lane without subtracting its existing edge and footer allowance again', () => {
    const media = { clientWidth: 192, getBoundingClientRect: () => ({ height: 144 }) };
    const main = { clientHeight: 230 };
    const boundary = { clientHeight: 154 };
    const element = { closest: (selector) => selector === 'main' ? main : boundary, querySelector: () => media, getBoundingClientRect: () => ({ height: 264 }) };
    const panel = mount({ floating: true, call: activeCall() }, element);
    button(panel, 'Show video').props.onClick();
    expect(panel.tree.props.children[1].props.style.height).toBe(34);
  });

  it('reserves room for Materials and honors the desktop layout budget', () => {
    const media = { clientWidth: 256, getBoundingClientRect: () => ({ height: 192 }) };
    const host = { clientHeight: 504 };
    const element = { closest: () => host, querySelector: () => media, getBoundingClientRect: () => ({ height: 320 }) };
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '300' }));
    const panel = mount({ call: activeCall() }, element);
    expect(panel.tree.props.children[1].props.style.height).toBe(76);
    expect(76 + 128 + 300).toBe(host.clientHeight);
    expect(panel.call.start).not.toHaveBeenCalled(); expect(panel.call.stop).not.toHaveBeenCalled();
  });

  it('keeps a peer invitation concise in both compact and expanded layouts', () => {
    const panel = mount({ floating: true, fill: false, peerName: 'your student', call: { peerOnVideo: true } });
    const join = button(panel, 'Join your student on video');
    expect(text(join)).toBe('Join video');
    expect(join.props.className).toContain('min-w-0 max-w-full');
    expect(join.props.className).not.toContain('shrink-0');
    expect(join.props.children[1].props.className).toContain('whitespace-normal');
    button(panel, 'Show video details').props.onClick();
    expect(text(button(panel, 'Join your student on video'))).toBe('Join video');
    expect(panel.call.start).not.toHaveBeenCalled();
    button(panel, 'Join your student on video').props.onClick();
    expect(panel.call.start).toHaveBeenCalledOnce();
  });

  it('keeps optional idle details secondary and never starts devices when those details open', () => {
    const panel = mount();
    button(panel, 'Show video details').props.onClick();
    expect(text(panel.tree)).toContain('Your camera and mic stay off until you start video.');
    expect(panel.call.start).not.toHaveBeenCalled();
    expect(nodes(panel.tree).filter((node) => node.type === 'button' && text(node) === 'Start video')).toHaveLength(1);
    button(panel, 'Hide video details').props.onClick();
    expect(state(panel)).toBe('compact');
  });

  it('keeps remote playback and call controls available after minimizing an active call', () => {
    const panel = mount({ call: activeCall() });
    expect(state(panel)).toBe('expanded');
    const frame = panel.tree.props.children[1];
    const player = frame.props.children[0];
    button(panel, 'Minimize video (the call keeps going)').props.onClick();
    expect(state(panel)).toBe('compact');
    const hiddenFrame = panel.tree.props.children[1];
    expect(hiddenFrame.type).toBe(frame.type);
    expect(hiddenFrame.props['aria-hidden']).toBe(true);
    expect(hiddenFrame.props.children[0].type).toBe(player.type);
    expect(hiddenFrame.props.children[0].props.stream).toBe(player.props.stream);
    expect(hiddenFrame.props.children[0].props.muted).not.toBe(true);
    const controls = nodes(panel.tree).filter((node) => typeof node.type === 'function' && node.type.name === 'RoundButton');
    expect(controls.map((node) => node.props.label)).toEqual(['Mute microphone', 'Turn camera off', 'Leave video']);
    controls[0].props.onClick(); controls[1].props.onClick();
    expect(panel.call.toggleMic).toHaveBeenCalledOnce(); expect(panel.call.toggleCam).toHaveBeenCalledOnce();
    expect(panel.call.stop).not.toHaveBeenCalled();
    button(panel, 'Show video').props.onClick(); expect(state(panel)).toBe('expanded');
  });

  it('respects explicit minimize through status and stream refreshes', () => {
    const panel = mount({ call: activeCall() });
    button(panel, 'Minimize video (the call keeps going)').props.onClick();
    panel.update({ call: { ...panel.call, status: 'connecting' } });
    panel.update({ call: { ...panel.call, remoteStream: { id: 'new-remote' }, status: 'connected' } });
    expect(state(panel)).toBe('compact');
    expect(panel.call.stop).not.toHaveBeenCalled();
  });

  it('opens a new desktop call once and returns to compact after the call ends', () => {
    const panel = mount();
    panel.update({ call: { ...panel.call, status: 'starting' } });
    expect(state(panel)).toBe('expanded');
    button(panel, 'Minimize video (the call keeps going)').props.onClick();
    panel.update({ call: { ...panel.call, ...activeCall() } });
    expect(state(panel)).toBe('compact');
    panel.update({ call: { ...panel.call, status: 'off', localStream: null, remoteStream: null } });
    expect(state(panel)).toBe('compact');
    panel.update({ call: { ...panel.call, ...activeCall() } });
    expect(state(panel)).toBe('expanded');
  });

  it('preserves the mobile floating folded default while Start video remains one action', () => {
    const panel = mount({ floating: true, fill: false });
    expect(state(panel)).toBe('compact');
    button(panel, 'Start video').props.onClick();
    expect(panel.call.start).toHaveBeenCalledOnce();
    expect(state(panel)).toBe('expanded');
    const alreadyActive = mount({ floating: true, fill: false, call: activeCall() });
    expect(state(alreadyActive)).toBe('compact');
    button(alreadyActive, 'Show video').props.onClick(); expect(state(alreadyActive)).toBe('expanded');
  });

  it('temporarily folds for focus mode and restores the previous expanded view', () => {
    const panel = mount({ call: activeCall() });
    panel.update({ collapse: true }); expect(state(panel)).toBe('compact');
    panel.update({ collapse: false }); expect(state(panel)).toBe('expanded');
    expect(panel.call.start).not.toHaveBeenCalled(); expect(panel.call.stop).not.toHaveBeenCalled();
  });

  it('keeps a user-minimized view folded after leaving focus mode', () => {
    const panel = mount({ call: activeCall() });
    panel.update({ collapse: true });
    button(panel, 'Show video').props.onClick();
    button(panel, 'Minimize video (the call keeps going)').props.onClick();
    panel.update({ collapse: false }); expect(state(panel)).toBe('compact');
  });

  it('keeps errors visible when compact and gives primary and call controls 44px targets', () => {
    const panel = mount({ call: { problem: 'Camera permission denied', status: 'error' } });
    expect(nodes(panel.tree).find((node) => node.props?.role === 'status').props.children).toBe('Camera permission denied');
    expect(button(panel, 'Start video').props.className).toContain('min-h-11');
    const active = mount({ call: activeCall() });
    for (const node of nodes(active.tree).filter((item) => typeof item.type === 'function' && item.type.name === 'RoundButton')) {
      expect(node.type(node.props).props.className).toContain('h-11 w-11');
    }
  });
});
