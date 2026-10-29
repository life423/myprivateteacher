import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';

function StreamVideo({ stream, muted = false, mirrored = false, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={`${mirrored ? '-scale-x-100' : ''} ${className}`} />;
}

function RoundButton({ onClick, label, tone = 'plain', children }) {
  const tones = {
    plain: 'bg-slate-100 text-slate-800 hover:bg-slate-200',
    off: 'bg-amber-100 text-amber-900 hover:bg-amber-200',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
  };
  return (
    <button type='button' onClick={onClick} aria-label={label} title={label} className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 ${tones[tone]}`}>
      {children}
    </button>
  );
}

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const activeStatuses = new Set(['starting', 'waiting', 'connecting', 'connected']);

// Idle video takes one compact row. Opening or hiding the picture never changes the call;
// the same remote media element stays mounted so audio also continues while minimized.
export default function VideoPanel({ call, peerName, fill = false, floating = false, collapse = false }) {
  const on = Boolean(call.localStream);
  const connected = call.status === 'connected';
  const active = on || Boolean(call.remoteStream) || activeStatuses.has(call.status);
  const [open, setOpen] = useState(() => !floating && !collapse && active);
  const [showDetails, setShowDetails] = useState(false);
  const [mediaHeight, setMediaHeight] = useState(null);
  const [compactPicture, setCompactPicture] = useState(false);
  const panel = useRef(null);
  const userMinimized = useRef(false);
  const previousActive = useRef(active);
  const previousCollapse = useRef(collapse);
  const beforeFocus = useRef(open);

  // Open once when a desktop call begins, not whenever stream/status props refresh.
  useEffect(() => {
    const wasActive = previousActive.current;
    previousActive.current = active;
    if (!active) {
      userMinimized.current = false;
      if (wasActive) {
        beforeFocus.current = false;
        setOpen(false);
      }
    } else if (!wasActive && !floating && !collapse && !userMinimized.current) {
      beforeFocus.current = true;
      setOpen(true);
    }
  }, [active, floating, collapse]);

  // Focus mode temporarily folds the picture; explicit actions during focus still win.
  useEffect(() => {
    if (previousCollapse.current === collapse) return;
    previousCollapse.current = collapse;
    if (collapse) {
      beforeFocus.current = open;
      setOpen(false);
    } else {
      setOpen(beforeFocus.current);
    }
  }, [collapse, open]);

  // Keep the media within its real host, leaving the controls and materials usable.
  // Only the viewport changes size: no stream is stopped or automatically minimized.
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element || !open || !active) return undefined;
    const containingHost = element.closest(floating ? 'main' : '[data-workspace-sidebar]');
    const media = element.querySelector('[data-video-media]');
    if (!containingHost || !media) return undefined;
    const measure = () => {
      // A compact landscape layout may provide a smaller lane above the footer.
      const boundary = floating ? element.closest('[data-video-boundary]') : null;
      const host = boundary || containingHost;
      const footer = floating && !boundary ? containingHost.querySelector('[data-board-footer]')?.getBoundingClientRect().height || 0 : 0;
      const chrome = element.getBoundingClientRect().height - media.getBoundingClientRect().height;
      const configured = Number.parseFloat(getComputedStyle(host).getPropertyValue('--video-materials-reserve'));
      const reserve = floating ? (boundary ? 0 : 24 + footer) : Number.isFinite(configured) ? configured : 280;
      const available = Math.max(0, host.clientHeight - reserve);
      setCompactPicture(available < 220);
      const height = Math.max(0, Math.min(media.clientWidth * 0.75, available - chrome));
      setMediaHeight((previous) => previous !== null && Math.abs(previous - height) < 1 ? previous : height);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(containingHost);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    measure();
    return () => observer.disconnect();
  }, [open, active, floating, showDetails, call.problem]);

  const changeOpen = (next) => {
    userMinimized.current = !next;
    beforeFocus.current = next;
    setOpen(next);
  };
  const start = () => {
    changeOpen(true);
    call.start();
  };

  let message = 'Your camera and mic stay off until you start video.';
  if (call.status === 'starting') message = 'Turning on your camera…';
  else if (call.status === 'waiting') message = `Waiting for ${peerName} to start video`;
  else if (call.status === 'connecting') message = 'Connecting…';
  else if (!on && call.peerOnVideo) message = `${capitalise(peerName)} is on video`;

  const Hide = floating ? ChevronDown : ChevronRight;
  const expandedPicture = open && active;
  const compactFloating = floating && !open;
  const startLabel = call.status === 'starting' ? 'Starting…' : call.peerOnVideo ? 'Join video' : 'Start video';
  const startButton = !on && (
    <button
      type='button'
      onClick={start}
      disabled={call.status === 'starting'}
      aria-label={call.peerOnVideo ? `Join ${peerName} on video` : undefined}
      className='inline-flex min-h-11 min-w-0 max-w-full items-center justify-center gap-2 rounded-full bg-emerald-600 px-3 text-sm font-bold text-white hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:opacity-50'
    >
      <Video className='h-4 w-4 shrink-0' aria-hidden='true' />
      <span className='min-w-0 whitespace-normal text-center leading-snug'>{startLabel}</span>
    </button>
  );
  const size = floating ? 'w-full gap-2 p-2 shadow-xl ring-1 ring-slate-200' : `gap-2 p-3 shadow ${fill ? 'w-full' : 'w-64 xl:w-72'}`;

  return (
    <aside ref={panel} aria-label='Video call' data-video-state={open ? 'expanded' : 'compact'} className={`relative flex min-w-0 max-w-full shrink-0 flex-col self-start rounded-2xl bg-white ${size}`}>
      <div className={expandedPicture && compactPicture ? 'absolute right-2 top-2 z-10 flex' : `flex min-h-11 items-center justify-between gap-1 ${floating && open ? 'cursor-grab' : ''}`}>
        {compactFloating && !on ? startButton : (
          <span className={expandedPicture && compactPicture ? 'sr-only' : 'flex min-w-0 items-center gap-1.5 text-sm font-bold text-slate-700'}>
            <Video className='h-4 w-4 shrink-0' aria-hidden='true' />
            Video
            {connected && <span className='h-2 w-2 shrink-0 rounded-full bg-emerald-500' role='img' aria-label='Connected' />}
          </span>
        )}
        {!open && !floating && startButton}
        <button
          type='button'
          onClick={() => changeOpen(!open)}
          aria-expanded={open}
          aria-label={open ? (active ? 'Minimize video (the call keeps going)' : 'Hide video details') : (active ? 'Show video' : 'Show video details')}
          title={open ? (active ? 'Minimize video (the call keeps going)' : 'Hide video details') : (active ? 'Show video' : 'Show video details')}
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 ${expandedPicture && compactPicture ? 'bg-white/90 shadow-sm' : ''}`}
        >
          {open ? <Hide className='h-4 w-4' aria-hidden='true' /> : <ChevronDown className='h-4 w-4' aria-hidden='true' />}
        </button>
      </div>
      {/* Keep this wrapper and remote player mounted when folding, preserving remote audio. */}
      <div data-video-media aria-hidden={!expandedPicture} style={expandedPicture && mediaHeight !== null ? { height: mediaHeight, aspectRatio: 'auto' } : undefined} className={expandedPicture ? 'relative aspect-[4/3] shrink-0 overflow-hidden rounded-xl bg-slate-900' : 'pointer-events-none fixed left-0 top-0 h-px w-px overflow-hidden opacity-0'}>
        {call.remoteStream ? (
          <StreamVideo stream={call.remoteStream} className='h-full w-full object-contain' />
        ) : expandedPicture ? (
          <div className={`flex h-full items-center justify-center p-3 text-center font-semibold text-slate-300 ${floating ? 'text-xs' : 'text-sm'}`}>
            <p className='min-w-0 break-words'>{message}</p>
          </div>
        ) : null}
        {on && expandedPicture && (
          <div className='absolute bottom-2 right-2 w-1/3 overflow-hidden rounded-lg border-2 border-white shadow'>
            <StreamVideo stream={call.localStream} muted mirrored className='aspect-[4/3] w-full object-cover' />
          </div>
        )}
      </div>
      {open && !active && <p className='break-words text-xs leading-relaxed text-slate-600'>{message}</p>}
      {call.problem && <p role='status' className='break-words text-xs font-semibold text-rose-700'>{call.problem}</p>}
      {open && (call.problem || call.status === 'connecting' || showDetails) && call.details?.length > 0 && (
        <div>
          <button
            type='button'
            onClick={() => setShowDetails((was) => !was)}
            aria-expanded={showDetails}
            className='inline-flex min-h-11 max-w-full items-center text-left text-xs font-semibold text-slate-500 hover:text-slate-700 hover:underline'
          >
            {showDetails ? 'Hide connection details' : 'Connection details'}
          </button>
          {showDetails && (
            <ol className='max-h-40 space-y-0.5 overflow-y-auto break-words rounded-lg bg-slate-50 p-2 text-[11px] leading-snug text-slate-600'>
              {call.details.map((d, i) => (
                <li key={i}>
                  <span className='tabular-nums text-slate-400'>{new Date(d.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>{' '}
                  {d.text}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {on ? (
        <div className='flex justify-center gap-2'>
          <RoundButton onClick={call.toggleMic} label={call.micOn ? 'Mute microphone' : 'Unmute microphone'} tone={call.micOn ? 'plain' : 'off'}>
            {call.micOn ? <Mic className='h-5 w-5' aria-hidden='true' /> : <MicOff className='h-5 w-5' aria-hidden='true' />}
          </RoundButton>
          <RoundButton onClick={call.toggleCam} label={call.camOn ? 'Turn camera off' : 'Turn camera on'} tone={call.camOn ? 'plain' : 'off'}>
            {call.camOn ? <Video className='h-5 w-5' aria-hidden='true' /> : <VideoOff className='h-5 w-5' aria-hidden='true' />}
          </RoundButton>
          <RoundButton onClick={call.stop} label='Leave video' tone='danger'>
            <PhoneOff className='h-5 w-5' aria-hidden='true' />
          </RoundButton>
        </div>
      ) : open ? startButton : null}
    </aside>
  );
}
