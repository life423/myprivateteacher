import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceSummary, useVideoCall, whyNoVideo } from './useVideoCall.js';

const ready = { isSecureContext: true, RTCPeerConnection: function RTCPeerConnection() {}, navigator: { mediaDevices: { getUserMedia() {} } } };
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

describe('why video cannot start', () => {
  it('names the real cause', () => {
    expect(whyNoVideo({ ...ready, isSecureContext: false })).toMatch(/https:/);
    expect(whyNoVideo({ ...ready, RTCPeerConnection: undefined })).toMatch(/turned off in this browser/);
    expect(whyNoVideo({ ...ready, navigator: {} })).toMatch(/inside another app/);
    expect(whyNoVideo(ready)).toBeNull();
  });
});

describe('the device and browser', () => {
  it('knows an iPad, which says it is a Mac', () => {
    expect(deviceSummary({ userAgent: SAFARI_MAC, maxTouchPoints: 5 })).toBe('iPad, Safari 17.4');
    expect(deviceSummary({ userAgent: SAFARI_MAC, maxTouchPoints: 0 })).toBe('Mac, Safari 17.4');
  });

  it('knows Chrome on an iPhone and on Windows', () => {
    expect(deviceSummary({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1' })).toBe('iPhone, Chrome 123');
    expect(deviceSummary({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' })).toBe('Windows, Chrome 124');
  });
});


// A minimal hook runner keeps these media/signalling tests independent of a DOM or a camera.
// Browser APIs below are controlled fakes; the production hook and its async handlers run unchanged.
const hookRuntime = vi.hoisted(() => ({ current: null }));
vi.mock('react', () => ({
  useState: (initial) => hookRuntime.current.useState(initial),
  useRef: (initial) => hookRuntime.current.useRef(initial),
  useEffect: (effect, dependencies) => hookRuntime.current.useEffect(effect, dependencies),
}));
const mounted = [];

function mountCall(role = 'tutor', send = vi.fn()) {
  const slots = [];
  let cursor = 0;
  let dirty = true;
  let call;
  let pendingEffects = [];
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
      if (!previous || dependencies.some((item, n) => !Object.is(item, previous.dependencies[n]))) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          slots[i] = { dependencies, cleanup: effect() };
        });
      }
    },
  };
  const render = () => {
    if (!dirty) return;
    dirty = false;
    cursor = 0;
    hookRuntime.current = runtime;
    try { call = useVideoCall(role, send); } finally { hookRuntime.current = null; }
    const effects = pendingEffects;
    pendingEffects = [];
    effects.forEach((effect) => effect());
  };
  const result = {
    get call() { render(); return call; },
    send,
    async flush() {
      for (let i = 0; i < 12; i++) { await Promise.resolve(); render(); }
    },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); },
  };
  mounted.push(result);
  return result;
}

function media() {
  const audio = { kind: 'audio', enabled: true, stop: vi.fn() };
  const video = { kind: 'video', enabled: true, stop: vi.fn() };
  return { getTracks: () => [audio, video], getAudioTracks: () => [audio], getVideoTracks: () => [video] };
}

function browser() {
  const instances = [];
  class PeerConnection {
    constructor() {
      this.signalingState = 'stable';
      this.connectionState = 'new';
      this.tracks = [];
      this.localDescription = null;
      this.remoteDescription = null;
      this.close = vi.fn(() => { this.signalingState = 'closed'; });
      this.addTrack = vi.fn((track) => this.tracks.push(track));
      this.setLocalDescription = vi.fn(async (description) => {
        if (description?.type === 'rollback') { this.signalingState = 'stable'; return; }
        const type = description?.type || (this.signalingState === 'have-remote-offer' ? 'answer' : 'offer');
        this.localDescription = description || { type, sdp: `v=0 ${instances.indexOf(this)}` };
        this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable';
      });
      this.setRemoteDescription = vi.fn(async (description) => {
        this.remoteDescription = description;
        this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
      });
      this.addIceCandidate = vi.fn(async () => {});
      this.restartIce = vi.fn();
      this.getStats = vi.fn(async () => new Map());
      instances.push(this);
    }
  }
  const getUserMedia = vi.fn(async () => media());
  vi.stubGlobal('RTCPeerConnection', PeerConnection);
  vi.stubGlobal('navigator', { userAgent: SAFARI_MAC, mediaDevices: { getUserMedia } });
  vi.stubGlobal('isSecureContext', true);
  return { instances, getUserMedia };
}

async function startCall(hook, peerId = 'test-peer') {
  if (peerId) hook.call.handle({ t: 'rtc:ready', id: peerId });
  const starting = hook.call.start();
  await hook.flush();
  hook.call.handle({ t: 'rtc:config', iceServers: [{ urls: 'stun:test.invalid' }] });
  await starting;
  await hook.flush();
}

const readyMessages = (hook) => hook.send.mock.calls.map(([msg]) => msg).filter((msg) => msg.t === 'rtc:ready');
const tickRoom = (hook, role = 'tutor') => {
  expect(hook.call.handle({ t: 'room', role, code: '1234' })).toBe(false);
  expect(hook.call.handle({ t: 'presence', tutor: true, student: true })).toBe(false);
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  mounted.splice(0).forEach((hook) => hook.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a video call recovering its room connection', () => {
  it.each(['tutor', 'student'])('reannounces %s media once after confirmed rejoin, retaining mute and camera settings', async (role) => {
    const { instances, getUserMedia } = browser();
    const hook = mountCall(role);
    tickRoom(hook, role);
    await startCall(hook);
    const stream = hook.call.localStream;
    hook.call.toggleMic();
    hook.call.toggleCam();
    await hook.flush();
    const initialId = readyMessages(hook)[0].id;
    const oldPc = instances[0];
    tickRoom(hook, role);
    hook.call.handle({ t: 'rtc:ready', id: 'test-peer' });
    await hook.flush();
    expect(readyMessages(hook)).toHaveLength(2);
    expect(readyMessages(hook)[1].id).toEqual(expect.any(String));
    expect(readyMessages(hook)[1].id).not.toBe(initialId);
    expect(oldPc.close).toHaveBeenCalledOnce();
    expect(instances).toHaveLength(2);
    expect(instances[1].tracks).toEqual(stream.getTracks());
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(hook.call.localStream).toBe(stream);
    expect(hook.call).toMatchObject({ micOn: false, camOn: false });
    expect(stream.getTracks().every((track) => !track.enabled && track.stop.mock.calls.length === 0)).toBe(true);
    hook.call.handle({ t: 'presence', tutor: true, student: true });
    expect(readyMessages(hook)).toHaveLength(2);
    expect(instances).toHaveLength(2);
  });

  it('waits for the absent peer, then rebuilds on their return without asking for media again', async () => {
    const { instances, getUserMedia } = browser();
    const hook = mountCall();
    tickRoom(hook);
    await startCall(hook);
    hook.call.handle({ t: 'presence', tutor: true, student: false });
    hook.call.peerGone(); // Existing room handler still receives presence.
    expect(hook.call.status).toBe('waiting');
    hook.call.handle({ t: 'presence', tutor: true, student: true });
    hook.call.handle({ t: 'rtc:ready', id: 'test-peer-return' });
    expect(instances).toHaveLength(2);
    expect(readyMessages(hook)).toHaveLength(3);
    expect(readyMessages(hook)[1].id).toBe(readyMessages(hook)[0].id);
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it('acknowledges a new readiness generation once and ignores duplicate announcements', async () => {
    const { instances } = browser();
    const hook = mountCall();
    await startCall(hook);
    hook.call.handle({ t: 'rtc:ready', id: 'peer-1' });
    const afterFirst = instances.length;
    const localId = readyMessages(hook)[0].id;
    expect(readyMessages(hook).at(-1).id).toBe(localId);
    hook.call.handle({ t: 'rtc:ready', id: 'peer-1' });
    expect(instances).toHaveLength(afterFirst);
    expect(readyMessages(hook)).toHaveLength(2);
    hook.call.handle({ t: 'rtc:ready', id: 'peer-2' });
    expect(instances).toHaveLength(afterFirst + 1);
    expect(readyMessages(hook)).toHaveLength(3);
    hook.call.handle({ t: 'rtc:ready', id: 'peer-2' });
    expect(instances).toHaveLength(afterFirst + 1);
    expect(readyMessages(hook)).toHaveLength(3);
    for (const id of ['', 'bad id', 'x'.repeat(65), 42]) hook.call.handle({ t: 'rtc:ready', id });
    expect(instances).toHaveLength(afterFirst + 1);
    expect(readyMessages(hook)).toHaveLength(3);
  });

  it('recovers both callers after stale-socket replacement with no absent-presence event or readiness loop', async () => {
    const { instances, getUserMedia } = browser();
    const wire = [];
    const tutor = mountCall('tutor', vi.fn((msg) => { if (msg.t === 'rtc:ready') wire.push(['student', msg]); }));
    const student = mountCall('student', vi.fn((msg) => { if (msg.t === 'rtc:ready') wire.push(['tutor', msg]); }));
    const peers = { tutor, student };
    const deliver = async () => {
      let count = 0;
      while (wire.length && count < 15) {
        const [to, msg] = wire.shift();
        peers[to].call.handle(msg);
        await peers[to].flush();
        count++;
      }
      expect(wire).toHaveLength(0);
      return count;
    };
    tickRoom(tutor);
    tickRoom(student, 'student');
    await startCall(tutor, null);
    await startCall(student, null);
    expect(await deliver()).toBeLessThanOrEqual(4);
    expect(instances).toHaveLength(2);
    tickRoom(student, 'student'); // Server replaces the student's old socket; tutor always saw present=true.
    expect(await deliver()).toBeLessThanOrEqual(3);
    expect(instances).toHaveLength(4);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(tutor.call.status).toBe('connecting');
    expect(student.call.status).toBe('connecting');
  });

  it.each(['tutor', 'student'])('waits for readiness when %s starts well before the other camera', async (firstRole) => {
    const { instances, getUserMedia } = browser();
    const secondRole = firstRole === 'tutor' ? 'student' : 'tutor';
    const first = mountCall(firstRole);
    const second = mountCall(secondRole);
    await startCall(first, null);
    expect(first.call.status).toBe('waiting');
    expect(instances).toHaveLength(0); // No offer can be discarded by the camera-off peer.
    second.call.handle(readyMessages(first)[0]);
    await startCall(second, null);
    const secondPc = instances[0];
    first.call.handle(readyMessages(second)[0]);
    second.call.handle(readyMessages(first).at(-1));
    expect(instances).toHaveLength(2);
    const firstPc = instances[1];
    await firstPc.onnegotiationneeded();
    await secondPc.onnegotiationneeded();
    first.call.handle({ t: 'rtc:description', description: secondPc.localDescription });
    second.call.handle({ t: 'rtc:description', description: firstPc.localDescription });
    await first.flush();
    await second.flush();
    const tutorPc = firstRole === 'tutor' ? firstPc : secondPc;
    const studentPc = firstRole === 'student' ? firstPc : secondPc;
    const tutorHook = firstRole === 'tutor' ? first : second;
    tutorHook.call.handle({ t: 'rtc:description', description: studentPc.localDescription });
    await tutorHook.flush();
    expect(tutorPc.signalingState).toBe('stable');
    expect(studentPc.signalingState).toBe('stable');
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('never starts a camera during room recovery, and does not echo legacy readiness', async () => {
    const { getUserMedia, instances } = browser();
    const hook = mountCall();
    tickRoom(hook);
    hook.call.handle({ t: 'rtc:ready', id: 'remote-offline-test' });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(instances).toHaveLength(0);
    expect(readyMessages(hook)).toHaveLength(0);
    await startCall(hook);
    const announced = readyMessages(hook).length;
    hook.call.handle({ t: 'rtc:ready' });
    expect(readyMessages(hook)).toHaveLength(announced);
  });

  it.each(['recover', 'stop'])('does not send a late offer after %s replaces or closes its peer connection', async (action) => {
    const { instances } = browser();
    const hook = mountCall();
    await startCall(hook);
    const oldPc = instances[0];
    const held = deferred();
    oldPc.setLocalDescription.mockImplementation(async () => { await held.promise; oldPc.localDescription = { type: 'offer', sdp: 'stale' }; });
    const negotiating = oldPc.onnegotiationneeded();
    if (action === 'recover') tickRoom(hook);
    else hook.call.stop();
    held.resolve();
    await negotiating;
    await hook.flush();
    expect(hook.send.mock.calls.map(([msg]) => msg).filter((msg) => msg.t === 'rtc:description')).toEqual([]);
    expect(hook.call.status).toBe(action === 'stop' ? 'off' : 'waiting');
  });

  it('does not apply queued descriptions or answer an old connection after recovery', async () => {
    const { instances } = browser();
    const hook = mountCall('student');
    await startCall(hook);
    const oldPc = instances[0];
    const held = deferred();
    oldPc.setRemoteDescription.mockImplementation(async () => held.promise);
    hook.call.handle({ t: 'rtc:description', description: { type: 'offer', sdp: 'old-offer' } });
    await hook.flush();
    hook.call.handle({ t: 'rtc:candidate', candidate: { candidate: 'candidate:old typ host' } });
    tickRoom(hook, 'student');
    hook.call.handle({ t: 'rtc:ready', id: 'test-peer' });
    held.resolve();
    await hook.flush();
    expect(oldPc.setLocalDescription).not.toHaveBeenCalled();
    expect(instances[1].addIceCandidate).not.toHaveBeenCalled();
    expect(hook.send.mock.calls.map(([msg]) => msg).filter((msg) => msg.t === 'rtc:description')).toEqual([]);
  });

  it('does not revive a stopped camera when media permission or ICE configuration resolves late', async () => {
    const { instances, getUserMedia } = browser();
    const permission = deferred();
    getUserMedia.mockReturnValueOnce(permission.promise);
    const hook = mountCall();
    const starting = hook.call.start();
    hook.call.stop();
    const stream = media();
    permission.resolve(stream);
    await hook.flush();
    hook.call.handle({ t: 'rtc:config', iceServers: [] });
    await starting;
    expect(stream.getTracks().every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    expect(hook.call.localStream).toBeNull();
    expect(instances).toHaveLength(0);
    const secondStart = hook.call.start();
    await hook.flush();
    hook.call.stop();
    hook.call.handle({ t: 'rtc:config', iceServers: [] });
    await secondStart;
    expect(instances).toHaveLength(0);
    expect(readyMessages(hook)).toHaveLength(0);
  });

  it('drops already-sent descriptions and candidates for either old generation, while accepting legacy messages', async () => {
    const { instances } = browser();
    const hook = mountCall('student');
    await startCall(hook);
    const previousLocalId = readyMessages(hook)[0].id;
    tickRoom(hook, 'student');
    hook.call.handle({ t: 'rtc:ready', id: 'new-peer' });
    const localId = readyMessages(hook).at(-1).id;
    const pc = instances.at(-1);
    const description = { type: 'offer', sdp: 'generation offer' };
    for (const identity of [{ id: 'test-peer', to: localId }, { id: 'new-peer', to: previousLocalId }, { id: 'bad id' }, { to: '<bad>' }]) {
      hook.call.handle({ t: 'rtc:description', ...identity, description });
      hook.call.handle({ t: 'rtc:candidate', ...identity, candidate: { candidate: 'candidate:old typ host' } });
    }
    await hook.flush();
    expect(pc.setRemoteDescription).not.toHaveBeenCalled();
    expect(pc.addIceCandidate).not.toHaveBeenCalled();
    hook.call.handle({ t: 'rtc:description', id: 'new-peer', to: localId, description });
    await hook.flush();
    expect(pc.setRemoteDescription).toHaveBeenCalledWith(description);
    hook.call.handle({ t: 'rtc:candidate', candidate: { candidate: 'candidate:legacy typ host' } });
    await hook.flush();
    expect(pc.addIceCandidate).toHaveBeenCalledOnce();
  });

  it('cancels an old ICE wait without clearing a restarted call’s config response', async () => {
    vi.useFakeTimers();
    const { getUserMedia } = browser();
    const hook = mountCall();
    hook.call.handle({ t: 'rtc:ready', id: 'test-peer' });
    const firstStart = hook.call.start();
    await hook.flush();
    await vi.advanceTimersByTimeAsync(1000);
    hook.call.stop();
    await firstStart;
    const secondStart = hook.call.start();
    await hook.flush();
    await vi.advanceTimersByTimeAsync(4500); // Past the old deadline, before the new one.
    hook.call.handle({ t: 'rtc:config', iceServers: [{ urls: 'turn:relay.test' }] });
    await secondStart;
    await hook.flush();
    expect(hook.call.details.map((entry) => entry.text)).toContain('Relay is ready');
    expect(readyMessages(hook)).toHaveLength(1);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it.each(['tutor', 'student'])('receives a legacy peer’s offer after %s transport recovery without a ready echo', async (role) => {
    const { instances, getUserMedia } = browser();
    const hook = mountCall(role);
    await startCall(hook, null);
    hook.call.handle({ t: 'rtc:ready' });
    tickRoom(hook, role);
    expect(instances.at(-1).signalingState).toBe('closed');
    hook.call.handle({ t: 'rtc:description', description: { type: 'offer', sdp: 'legacy recovery offer' } });
    await hook.flush();
    expect(instances.at(-1).remoteDescription.sdp).toBe('legacy recovery offer');
    expect(instances.at(-1).localDescription.type).toBe('answer');
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it('resends pending ICE setup on confirmed transport recovery without another media request or waiter', async () => {
    vi.useFakeTimers();
    const { getUserMedia } = browser();
    const hook = mountCall();
    const starting = hook.call.start();
    await hook.flush();
    await vi.advanceTimersByTimeAsync(2000);
    tickRoom(hook);
    expect(hook.send.mock.calls.map(([msg]) => msg).filter((msg) => msg.t === 'rtc:config')).toHaveLength(2);
    hook.call.handle({ t: 'rtc:config', iceServers: [{ urls: 'turn:recovered.test' }] });
    await starting;
    await hook.flush();
    expect(hook.call.details.map((entry) => entry.text)).toContain('Relay is ready');
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it('keeps the polite-student collision rollback and the tutor offer intact', async () => {
    const { instances } = browser();
    const tutor = mountCall('tutor');
    const student = mountCall('student');
    await startCall(tutor);
    await startCall(student);
    const [tutorPc, studentPc] = instances;
    await tutorPc.onnegotiationneeded();
    await studentPc.onnegotiationneeded();
    const tutorOffer = tutorPc.localDescription;
    const studentOffer = studentPc.localDescription;
    tutor.call.handle({ t: 'rtc:description', description: studentOffer });
    student.call.handle({ t: 'rtc:description', description: tutorOffer });
    await tutor.flush();
    await student.flush();
    expect(tutorPc.setRemoteDescription).not.toHaveBeenCalled();
    expect(studentPc.setLocalDescription).toHaveBeenCalledWith({ type: 'rollback' });
    expect(studentPc.localDescription.type).toBe('answer');
    tutor.call.handle({ t: 'rtc:description', description: studentPc.localDescription });
    await tutor.flush();
    expect(tutorPc.signalingState).toBe('stable');
    expect(studentPc.signalingState).toBe('stable');
  });
});
