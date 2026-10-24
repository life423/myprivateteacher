import { useEffect, useRef, useState } from 'react';
import { MessageScreen, StatusPill, TopBar } from '../whiteboard/ui.jsx';
import { useRealtime } from '../whiteboard/useRealtime.js';
import BridgeBoard from './BridgeBoard.jsx';

// The student's bridge: the tutor's game, shown as the tutor sets it. Taps go to the tutor to apply.
const KEY = (code) => `bridge-student-${code}`;

const MESSAGES = {
  'no-room': 'There’s no bridge session with that code. Check the code with your tutor.',
  'room-full': 'Someone else is already in this session.',
  'slow-down': 'Too many tries. Wait a minute and try again.',
};

export default function BridgeStudent({ code }) {
  const [phase, setPhase] = useState('joining'); // joining | in | closed | a reason from the server
  const [game, setGame] = useState(null);
  const [selected, setSelected] = useState(null);
  const keyRef = useRef(null);
  const sendRef = useRef(() => {});

  if (keyRef.current === null) {
    try {
      keyRef.current = sessionStorage.getItem(KEY(code)) || undefined;
    } catch {
      keyRef.current = undefined;
    }
  }

  const { status, send } = useRealtime({
    hello: () => ({ t: 'join', code, key: keyRef.current }),
    onMessage: (msg) => {
      if (msg.t === 'room') {
        keyRef.current = msg.key;
        try {
          sessionStorage.setItem(KEY(code), msg.key);
        } catch {
          // Without storage the student can still play; a reload just means rejoining with the code
        }
        setPhase('in');
      } else if (msg.t === 'board' || msg.t === 'game') {
        setGame(msg.game || null);
      } else if (msg.t === 'closed') {
        setPhase('closed');
      } else if (msg.t === 'error') {
        setPhase(msg.reason);
      }
    },
  });
  sendRef.current = send;

  // A letter that's now in its gap can't be picked any more
  useEffect(() => {
    if (selected && game && !game.tray.includes(selected)) setSelected(null);
  }, [game, selected]);

  const place = (slot, letter) => sendRef.current({ t: 'game:act', act: { a: 'place', slot, letter } });

  if (phase === 'closed') {
    return <MessageScreen title='Session ended'>Your tutor has ended the session. Ask them for a new code.</MessageScreen>;
  }
  if (phase !== 'in' && phase !== 'joining') {
    return <MessageScreen title='Can’t join'>{MESSAGES[phase] || 'Please try again in a moment.'}</MessageScreen>;
  }

  return (
    <div className='min-h-dvh bg-gradient-to-b from-sky-50 to-violet-50'>
      <TopBar back='/bridge' title='Alphabet Bridge'>
        <StatusPill tone={status === 'open' && phase === 'in' ? 'good' : 'wait'}>
          {status === 'open' && phase === 'in' ? 'Connected' : 'Connecting…'}
        </StatusPill>
      </TopBar>
      <main className='mx-auto max-w-3xl px-4 py-8'>
        <BridgeBoard game={game} selected={selected} onSelect={setSelected} onPlace={place} />
      </main>
    </div>
  );
}
