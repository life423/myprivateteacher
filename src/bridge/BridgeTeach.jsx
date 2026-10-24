import { useRef, useState } from 'react';
import { MessageScreen, StatusPill, TopBar } from '../whiteboard/ui.jsx';
import { useRealtime } from '../whiteboard/useRealtime.js';
import BridgeBoard from './BridgeBoard.jsx';
import { DEFAULT_SETTINGS, MAX_DISTRACTORS, MAX_GAPS, MAX_LENGTH, MIN_LENGTH, applyAct, cleanSettings, newRound } from '../../shared/bridge.js';

// The tutor's bridge. This copy of the game is the one that counts: the student's taps arrive
// here, the tutor's board applies them, and the result is sent back to the student's screen.
const SAVED = 'bridge-tutor';

function loadSaved() {
  try {
    return JSON.parse(sessionStorage.getItem(SAVED)) || {};
  } catch {
    return {};
  }
}

const options = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export default function BridgeTeach() {
  const [room, setRoom] = useState(loadSaved); // { code, key } once the server has given us a room
  const [game, setGame] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [selected, setSelected] = useState(null);
  const [student, setStudent] = useState(false);
  const [error, setError] = useState(null);
  const [ended, setEnded] = useState(false);
  const roomRef = useRef(room);
  const gameRef = useRef(null);
  const settingsRef = useRef(settings);
  const sendRef = useRef(() => {});

  // Sets the game here and on the student's screen
  const commit = (next) => {
    gameRef.current = next;
    setGame(next);
    sendRef.current({ t: 'game', game: next });
  };

  const { status, send } = useRealtime({
    hello: () => ({ t: 'create', code: roomRef.current.code, key: roomRef.current.key }),
    onMessage: (msg) => {
      if (msg.t === 'room') {
        const saved = { code: msg.code, key: msg.key };
        roomRef.current = saved;
        setRoom(saved);
        sessionStorage.setItem(SAVED, JSON.stringify(saved));
        // A brand-new room has no game yet: start the first bridge. (A reconnect gets the board instead.)
        if (msg.fresh) commit(newRound(settingsRef.current));
      } else if (msg.t === 'board') {
        // Coming back after a reconnect: keep the game that was under way. A new room starts a bridge.
        if (msg.game) {
          gameRef.current = msg.game;
          setGame(msg.game);
        } else {
          commit(newRound(settingsRef.current));
        }
      } else if (msg.t === 'presence') {
        setStudent(Boolean(msg.student));
      } else if (msg.t === 'game:act') {
        const next = applyAct(gameRef.current, msg.act);
        if (next !== gameRef.current) commit(next);
      } else if (msg.t === 'closed') {
        sessionStorage.removeItem(SAVED);
        setEnded(true);
      } else if (msg.t === 'error') {
        setError(msg.reason);
      }
    },
  });
  sendRef.current = send;

  const place = (slot, letter) => {
    const next = applyAct(gameRef.current, { a: 'place', slot, letter });
    if (next === gameRef.current) return;
    commit(next);
    if (next.placed[slot] !== undefined) setSelected(null);
  };
  // The tutor shows the next gap, so the student can see how it's done
  const showNext = () => {
    const current = gameRef.current;
    const slot = current?.slots.find((s) => current.placed[s] === undefined);
    if (slot !== undefined) commit(applyAct(current, { a: 'show', slot }));
  };
  const newBridge = () => {
    setSelected(null);
    commit(newRound(settingsRef.current));
  };
  const changeSettings = (patch) => {
    const next = cleanSettings({ ...settingsRef.current, ...patch });
    settingsRef.current = next;
    setSettings(next);
  };

  if (ended) {
    return (
      <MessageScreen title='Session ended'>
        The bridge session is over. Start a new one whenever you like.
      </MessageScreen>
    );
  }
  if (error) {
    return <MessageScreen title='Could not start'>{error === 'plan' ? 'Your tutor account needs a current plan to start a session.' : 'Please try again in a moment.'}</MessageScreen>;
  }

  const connected = status === 'open' && room.code;
  return (
    <div className='min-h-dvh bg-gradient-to-b from-sky-50 to-violet-50'>
      <TopBar back='/bridge' title='Alphabet Bridge'>
        <StatusPill tone={connected ? (student ? 'good' : 'wait') : 'bad'}>
          {!connected ? 'Connecting…' : student ? 'Student here' : 'Waiting for student'}
        </StatusPill>
      </TopBar>
      <main className='mx-auto max-w-4xl px-4 py-6'>
        <p className='text-center text-lg text-slate-700'>
          Student code: <strong className='font-mono text-3xl tracking-[0.3em] text-violet-700'>{room.code || '····'}</strong>
        </p>

        <div className='mt-6'>
          <BridgeBoard game={game} selected={selected} onSelect={setSelected} onPlace={place} />
        </div>

        <section className='mx-auto mt-8 max-w-2xl rounded-3xl bg-white p-5 shadow' aria-label='Tutor controls'>
          <div className='grid gap-4 sm:grid-cols-3'>
            <label className='flex flex-col gap-1 text-sm font-semibold text-slate-700'>
              Letters in the row
              <select
                value={settings.length}
                onChange={(e) => changeSettings({ length: Number(e.target.value) })}
                className='rounded-xl border-2 border-slate-200 px-3 py-2 text-base font-normal'
              >
                {options(MIN_LENGTH, MAX_LENGTH).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className='flex flex-col gap-1 text-sm font-semibold text-slate-700'>
              Missing letters
              <select
                value={settings.gaps}
                onChange={(e) => changeSettings({ gaps: Number(e.target.value) })}
                className='rounded-xl border-2 border-slate-200 px-3 py-2 text-base font-normal'
              >
                {options(1, Math.min(MAX_GAPS, settings.length - 1)).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className='flex flex-col gap-1 text-sm font-semibold text-slate-700'>
              Extra letters to avoid
              <select
                value={settings.distractors}
                onChange={(e) => changeSettings({ distractors: Number(e.target.value) })}
                className='rounded-xl border-2 border-slate-200 px-3 py-2 text-base font-normal'
              >
                {options(0, MAX_DISTRACTORS).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          <div className='mt-5 flex flex-wrap justify-center gap-3'>
            <button type='button' onClick={showNext} disabled={!game} className='rounded-full bg-amber-500 px-5 py-2 font-bold text-white shadow hover:bg-amber-600 disabled:opacity-40'>
              Show me the next gap
            </button>
            <button type='button' onClick={newBridge} disabled={!game} className='rounded-full bg-violet-600 px-5 py-2 font-bold text-white shadow hover:bg-violet-700 disabled:opacity-40'>
              New bridge
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
