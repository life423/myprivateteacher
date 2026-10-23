import { useEffect, useRef, useState } from 'react';

const MEDIA = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' },
};

const PROBLEMS = {
  NotAllowedError: 'Camera and microphone are blocked. Allow them for this site in your browser, then try again.',
  NotFoundError: 'No camera or microphone was found.',
  NotReadableError: 'Your camera or microphone is being used by another app.',
  OverconstrainedError: 'Your camera couldn’t start at this size.',
};

// Why video can't start in this browser, or null if it can. Checked before asking for the camera,
// so the message names the real cause instead of a general "can't do video".
export function whyNoVideo(w = globalThis) {
  if (w.isSecureContext === false) {
    return 'Video needs a secure https:// address. On an http:// address the browser turns the camera off.';
  }
  if (typeof w.RTCPeerConnection !== 'function') {
    return 'Video calls are turned off in this browser. Lockdown Mode or a privacy extension can do this; otherwise, try an up-to-date Safari, Chrome or Edge.';
  }
  if (typeof w.navigator?.mediaDevices?.getUserMedia !== 'function') {
    return 'This browser can’t reach the camera here. If this page opened inside another app, open it in Safari or Chrome.';
  }
  return null;
}

// The device and browser, for the connection details. iPadOS Safari calls itself a Mac, so a Mac
// with a touch screen is an iPad.
export function deviceSummary(nav = globalThis.navigator) {
  const ua = nav?.userAgent || '';
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  const device = ipad ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'computer';
  const browser = /Edg(A|iOS)?\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  const version = (ua.match(/Version\/(\d+(\.\d+)?)/) || ua.match(/(?:Edg|Chrome|CriOS|Firefox|FxiOS)\/(\d+)/) || [])[1];
  return `${device}, ${browser}${version ? ` ${version}` : ''}`;
}

// Older Safari (before iOS and iPadOS 15.4) can't make an offer or answer on its own from
// setLocalDescription(), so make it explicitly there.
async function setLocal(pc, kind) {
  try {
    await pc.setLocalDescription();
  } catch (error) {
    if (pc.signalingState === 'closed') throw error;
    await pc.setLocalDescription(kind === 'offer' ? await pc.createOffer() : await pc.createAnswer());
  }
}

const typeOf = (candidate) => (/ typ (\w+)/.exec(candidate || '') || [])[1] || 'unknown';
const tally = (counts) => Object.entries(counts).map(([type, n]) => `${n} ${type === 'host' ? 'direct' : type === 'srflx' ? 'internet' : type === 'relay' ? 'relay' : type}`).join(', ') || 'none';
const STILL_CONNECTING_MS = 20000;

// A one-to-one video call beside the whiteboard. The room's WebSocket only carries the
// setup messages; the audio and video go browser to browser (or through the TURN relay).
// It follows the 'perfect negotiation' pattern: if both sides make an offer at the same
// moment, the student is the polite one and gives way, so the call never deadlocks.
// Camera and microphone stay off until this person clicks Start.
export function useVideoCall(role, send) {
  const polite = role === 'student';
  const [status, setStatus] = useState('off'); // off | starting | waiting | connecting | connected | error
  const [problem, setProblem] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [peerOnVideo, setPeerOnVideo] = useState(false);
  const sendRef = useRef(send);
  sendRef.current = send;
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const iceServers = useRef(null);
  const configWaiter = useRef(null);
  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false);
  const queue = useRef(Promise.resolve());
  const [details, setDetails] = useState([]); // what happened, for the Connection details list
  const found = useRef({}); // this device's routes, by type
  const heard = useRef({}); // the other person's routes, by type

  const note = (text) => setDetails((list) => [...list.slice(-29), { at: Date.now(), text }]);
  // A short line in the server log, so a failed call on someone's device leaves a trace.
  const report = (text) => sendRef.current({ t: 'rtc:report', text: `${deviceSummary()}: ${text}` });

  const closePc = () => {
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      pc.onnegotiationneeded = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    setRemoteStream(null);
  };

  // A fresh connection carrying this person's camera and mic. Adding the tracks makes
  // the browser ask for a negotiation, which sends our offer.
  const buildPc = () => {
    closePc();
    const pc = new RTCPeerConnection({ iceServers: iceServers.current || [] });
    pcRef.current = pc;
    pc.ontrack = ({ streams }) => {
      if (streams[0]) setRemoteStream(streams[0]);
    };
    found.current = {};
    heard.current = {};
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        const type = typeOf(candidate.candidate);
        found.current[type] = (found.current[type] || 0) + 1;
        sendRef.current({ t: 'rtc:candidate', candidate: candidate.toJSON() });
      } else {
        note(`This device found routes: ${tally(found.current)}`);
      }
    };
    pc.onnegotiationneeded = async () => {
      try {
        makingOffer.current = true;
        await setLocal(pc, 'offer');
        sendRef.current({ t: 'rtc:description', description: pc.localDescription });
      } catch (error) {
        console.warn('Could not start call negotiation', error);
        note(`Couldn’t set up the call: ${error.name || 'error'} ${error.message || ''}`.trim());
        report(`offer failed: ${error.name}`);
      } finally {
        makingOffer.current = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return;
      const state = pc.connectionState;
      note(`Connection: ${state}`);
      if (state === 'connected') {
        setStatus('connected');
        setProblem(null);
        describeRoute(pc);
      } else if (state === 'connecting' || state === 'disconnected') setStatus('connecting');
      else if (state === 'failed') {
        note(`No route worked (this device: ${tally(found.current)}; other side: ${tally(heard.current)}). Trying again.`);
        report(`failed; here ${tally(found.current)}; there ${tally(heard.current)}`);
        pc.restartIce(); // try another route (like the TURN relay) before giving up
      }
    };
    for (const track of streamRef.current.getTracks()) pc.addTrack(track, streamRef.current);
    return pc;
  };

  // Once connected: which route the call took (direct, through the internet, or the relay).
  const describeRoute = async (pc) => {
    try {
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach((s) => {
        if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
      });
      if (!pair) stats.forEach((s) => { if (s.type === 'candidate-pair' && (s.selected || s.nominated) && s.state === 'succeeded') pair = s; });
      const local = pair && stats.get(pair.localCandidateId);
      const label = { host: 'directly', srflx: 'over the internet', prflx: 'over the internet', relay: 'through the relay' }[local?.candidateType] || 'by an unknown route';
      note(`Connected ${label}${local?.protocol ? ` (${local.protocol})` : ''}`);
      report(`connected ${label}`);
    } catch {
      report('connected');
    }
  };

  // STUN/TURN servers from our server, with a short-lived TURN login. Falls back to none
  // (direct connections only) if the answer doesn't come.
  const requestIceServers = () => {
    if (iceServers.current) return Promise.resolve(iceServers.current);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        configWaiter.current = null;
        resolve([]);
      }, 5000);
      configWaiter.current = (servers) => {
        clearTimeout(timer);
        configWaiter.current = null;
        iceServers.current = servers;
        resolve(servers);
      };
      sendRef.current({ t: 'rtc:config' });
    });
  };

  const start = async () => {
    if (streamRef.current) return;
    setProblem(null);
    setDetails([]);
    note(`Starting video on ${deviceSummary()}`);
    const why = whyNoVideo();
    if (why) {
      note(why);
      report(`can't start: ${why.slice(0, 60)}`);
      setProblem(why);
      setStatus('error');
      return;
    }
    setStatus('starting');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(MEDIA);
    } catch (error) {
      note(`Camera didn’t start: ${error.name || 'error'}`);
      report(`camera: ${error.name}`);
      setProblem(PROBLEMS[error.name] || 'The camera couldn’t start. Try again.');
      setStatus('error');
      return;
    }
    streamRef.current = stream;
    setLocalStream(stream);
    setMicOn(true);
    setCamOn(true);
    note('Camera and microphone are on');
    const servers = await requestIceServers();
    note(servers.some((s) => [].concat(s.urls).some((u) => u.startsWith('turn'))) ? 'Relay is ready' : 'No relay details: direct connections only');
    buildPc();
    setStatus(peerOnVideo ? 'connecting' : 'waiting');
    sendRef.current({ t: 'rtc:ready' });
  };

  const stop = () => {
    closePc();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLocalStream(null);
    setStatus('off');
    sendRef.current({ t: 'rtc:leave' });
  };

  // The other person left the video, or the room.
  const peerGone = () => {
    setPeerOnVideo(false);
    if (!streamRef.current) return;
    closePc();
    setStatus('waiting');
  };

  const toggleMic = () => {
    const next = !micOn;
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setMicOn(next);
  };

  const toggleCam = () => {
    const next = !camOn;
    streamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setCamOn(next);
  };

  const onDescription = async (description) => {
    const pc = pcRef.current;
    if (!pc || !description) return;
    const collision = description.type === 'offer' && (makingOffer.current || pc.signalingState !== 'stable');
    ignoreOffer.current = !polite && collision;
    if (ignoreOffer.current) return;
    // On a collision the polite side gives way. Newer browsers roll back by themselves inside
    // setRemoteDescription; older Safari needs it done first.
    if (collision && pc.signalingState === 'have-local-offer') await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
    await pc.setRemoteDescription(description);
    if (description.type === 'offer') {
      await setLocal(pc, 'answer');
      sendRef.current({ t: 'rtc:description', description: pc.localDescription });
    }
  };

  const onCandidate = async (candidate) => {
    const pc = pcRef.current;
    if (!pc || !candidate) return;
    const type = typeOf(candidate.candidate);
    heard.current[type] = (heard.current[type] || 0) + 1;
    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      if (!ignoreOffer.current) throw error;
    }
  };

  // Call messages from the server. Returns true when the message was about the call.
  const handle = (msg) => {
    switch (msg.t) {
      case 'rtc:config':
        configWaiter.current?.(Array.isArray(msg.iceServers) ? msg.iceServers : []);
        return true;
      case 'rtc:ready':
        setPeerOnVideo(true);
        // They're starting (or starting again after a refresh), so start a fresh connection too.
        if (streamRef.current) {
          buildPc();
          setStatus('connecting');
        }
        return true;
      case 'rtc:leave':
        peerGone();
        return true;
      case 'rtc:description':
        setPeerOnVideo(true);
        queue.current = queue.current
          .then(() => onDescription(msg.description))
          .catch((error) => {
            console.warn('Call setup failed', error);
            note(`Call setup failed: ${error.name || 'error'} ${error.message || ''}`.trim());
            report(`setup failed: ${error.name}`);
          });
        return true;
      case 'rtc:candidate':
        queue.current = queue.current.then(() => onCandidate(msg.candidate)).catch(() => {});
        return true;
      default:
        return false;
    }
  };

  // Taking too long to connect: say so, and point at the details.
  useEffect(() => {
    if (status !== 'connecting') return undefined;
    const timer = setTimeout(() => {
      setProblem('This is taking longer than usual. The connection details below show where it got stuck.');
      report(`still connecting; here ${tally(found.current)}; there ${tally(heard.current)}`);
    }, STILL_CONNECTING_MS);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(
    () => () => {
      pcRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  return { status, problem, details, localStream, remoteStream, micOn, camOn, peerOnVideo, start, stop, toggleMic, toggleCam, peerGone, handle };
}
