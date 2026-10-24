import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';

function StreamVideo({ stream, muted = false, mirrored = false, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={`${mirrored ? '-scale-x-100' : ''} ${className}`} />;
}

function RoundButton({ onClick, label, tone = 'plain', small = false, children }) {
  const tones = {
    plain: 'bg-slate-100 text-slate-800 hover:bg-slate-200',
    off: 'bg-amber-100 text-amber-900 hover:bg-amber-200',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
  };
  return (
    <button type='button' onClick={onClick} aria-label={label} title={label} className={`rounded-full ${small ? 'p-2' : 'p-2.5'} ${tones[tone]}`}>
      {children}
    </button>
  );
}

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// The video call. In the side column on wide screens (`fill`), or a small floating window
// over the board on narrower ones (`floating`). Hiding it never ends the call, and the other
// person's voice keeps playing. `collapse` (focus mode) tucks it away; it can still be opened.
export default function VideoPanel({ call, peerName, fill = false, floating = false, collapse = false }) {
  // Floating over the board on a phone, it starts folded so the game has the screen; one tap opens it
  const [open, setOpen] = useState(() => !floating);
  const on = Boolean(call.localStream);
  const connected = call.status === 'connected';
  const [showDetails, setShowDetails] = useState(false);
  // Focus mode tucks the video away, and leaving it puts the video back the way it was.
  const before = useRef(open);
  useEffect(() => {
    if (collapse) {
      before.current = open;
      setOpen(false);
    } else {
      setOpen(before.current);
    }
  }, [collapse]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) {
    // The picture is hidden, but the other person's audio keeps playing through this.
    const audio = call.remoteStream ? (
      <StreamVideo stream={call.remoteStream} className='pointer-events-none fixed left-0 top-0 h-px w-px opacity-0' />
    ) : null;
    let button;
    if (floating) {
      button = (
        <button
          type='button'
          onClick={() => setOpen(true)}
          aria-label='Show video'
          title='Show video'
          className='relative flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-700 shadow-lg ring-1 ring-slate-200 hover:bg-violet-50'
        >
          <Video className='h-5 w-5' aria-hidden='true' />
          {connected && <span className='absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white' aria-hidden='true' />}
        </button>
      );
    } else if (fill) {
      button = (
        <button
          type='button'
          onClick={() => setOpen(true)}
          className='flex w-full items-center justify-between rounded-2xl bg-white p-3 text-sm font-bold text-slate-700 shadow hover:bg-violet-50'
        >
          <span className='flex items-center gap-2'>
            <Video className='h-5 w-5' aria-hidden='true' />
            Video
            {connected && <span className='text-xs font-semibold text-emerald-700'>connected</span>}
          </span>
          <span className='text-xs font-semibold text-violet-700'>Show</span>
        </button>
      );
    } else {
      button = (
        <button
          type='button'
          onClick={() => setOpen(true)}
          aria-label='Show video'
          className='flex shrink-0 flex-col items-center gap-1 self-start rounded-2xl bg-white p-2 text-xs font-bold text-slate-700 shadow hover:bg-violet-50'
        >
          <Video className='h-6 w-6' aria-hidden='true' />
          Video
          {connected && <span className='h-2 w-2 rounded-full bg-emerald-500' aria-hidden='true' />}
        </button>
      );
    }
    return (
      <>
        {button}
        {audio}
      </>
    );
  }

  let message = 'Your camera and mic stay off until you start video.';
  if (call.status === 'starting') message = 'Turning on your camera…';
  else if (call.status === 'waiting') message = `Waiting for ${peerName} to start video`;
  else if (call.status === 'connecting') message = 'Connecting…';
  else if (!on && call.peerOnVideo) message = `${capitalise(peerName)} is on video`;

  const Hide = floating ? ChevronDown : ChevronRight;
  const size = floating ? 'w-full gap-2 p-2 shadow-xl ring-1 ring-slate-200' : `gap-3 p-3 shadow ${fill ? 'w-full' : 'w-64 xl:w-72'}`;
  return (
    <aside aria-label='Video call' className={`flex shrink-0 flex-col self-start rounded-2xl bg-white ${size}`}>
      <div className={`flex items-center justify-between ${floating ? 'cursor-grab' : ''}`}>
        <span className='text-sm font-bold text-slate-700'>
          Video
          {connected && <span className='ml-2 text-xs font-semibold text-emerald-700'>connected</span>}
        </span>
        <button
          type='button'
          onClick={() => setOpen(false)}
          aria-label='Hide video (the call keeps going)'
          title='Hide video (the call keeps going)'
          className='rounded-full p-1 text-slate-500 hover:bg-slate-100'
        >
          <Hide className='h-4 w-4' aria-hidden='true' />
        </button>
      </div>
      <div className='relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-900'>
        {call.remoteStream ? (
          <StreamVideo stream={call.remoteStream} className='h-full w-full object-cover' />
        ) : (
          <div className={`flex h-full items-center justify-center p-3 text-center font-semibold text-slate-300 ${floating ? 'text-xs' : 'text-sm'}`}>
            {message}
          </div>
        )}
        {on && (
          <div className='absolute bottom-2 right-2 w-1/3 overflow-hidden rounded-lg border-2 border-white shadow'>
            <StreamVideo stream={call.localStream} muted mirrored className='aspect-[4/3] w-full object-cover' />
          </div>
        )}
      </div>
      {call.problem && (
        <p role='status' className='text-xs font-semibold text-rose-700'>
          {call.problem}
        </p>
      )}
      {/* What happened, step by step: shown when something is wrong or while connecting. */}
      {(call.problem || call.status === 'connecting' || showDetails) && call.details?.length > 0 && (
        <div className='-mt-1'>
          <button
            type='button'
            onClick={() => setShowDetails((was) => !was)}
            aria-expanded={showDetails}
            className='text-xs font-semibold text-slate-500 hover:text-slate-700 hover:underline'
          >
            {showDetails ? 'Hide connection details' : 'Connection details'}
          </button>
          {showDetails && (
            <ol className='mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded-lg bg-slate-50 p-2 text-[11px] leading-snug text-slate-600'>
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
          <RoundButton small={floating} onClick={call.toggleMic} label={call.micOn ? 'Mute microphone' : 'Unmute microphone'} tone={call.micOn ? 'plain' : 'off'}>
            {call.micOn ? <Mic className='h-5 w-5' aria-hidden='true' /> : <MicOff className='h-5 w-5' aria-hidden='true' />}
          </RoundButton>
          <RoundButton small={floating} onClick={call.toggleCam} label={call.camOn ? 'Turn camera off' : 'Turn camera on'} tone={call.camOn ? 'plain' : 'off'}>
            {call.camOn ? <Video className='h-5 w-5' aria-hidden='true' /> : <VideoOff className='h-5 w-5' aria-hidden='true' />}
          </RoundButton>
          <RoundButton small={floating} onClick={call.stop} label='Leave video' tone='danger'>
            <PhoneOff className='h-5 w-5' aria-hidden='true' />
          </RoundButton>
        </div>
      ) : (
        <button
          type='button'
          onClick={call.start}
          disabled={call.status === 'starting'}
          className={`rounded-full bg-emerald-600 font-bold text-white hover:bg-emerald-700 disabled:opacity-50 ${floating ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}
        >
          {call.peerOnVideo ? `Join ${peerName} on video` : 'Start video'}
        </button>
      )}
    </aside>
  );
}
