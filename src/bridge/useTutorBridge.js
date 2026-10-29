import { useRef, useState } from 'react';
import { DEFAULT_SETTINGS, applyAct, cleanSettings, newRound } from '../../shared/bridge.js';

// The tutor's side of the bridge, inside the whiteboard. `game` is null while the bridge is put
// away. This copy is the one that counts: it's what the student's screen follows, and the
// student's taps arrive here to be applied.
export function useTutorBridge(send, { context, isCurrentContext } = {}) {
  const [game, setGame] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [selected, setSelected] = useState(null);
  const gameRef = useRef(null);
  const settingsRef = useRef(settings);

  // Sets the game here and on the student's screen
  const commit = (next, origin = context) => {
    if (isCurrentContext && !isCurrentContext(origin)) return;
    gameRef.current = next;
    setGame(next);
    send({ t: 'game', game: next }, origin);
  };

  const start = () => {
    setSelected(null);
    commit(newRound(settingsRef.current));
  };
  const stop = () => {
    if (isCurrentContext && !isCurrentContext(context)) return;
    setSelected(null);
    gameRef.current = null;
    setGame(null);
    send({ t: 'game', game: null }, context);
  };
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
  const changeSettings = (patch) => {
    const next = cleanSettings({ ...settingsRef.current, ...patch });
    settingsRef.current = next;
    setSettings(next);
  };

  // Messages from the server that concern the bridge. Returns nothing: the whiteboard still
  // handles the same 'board' message for its own pieces.
  const handle = (msg) => {
    if (msg.t === 'board') {
      // A reconnect gets the game that was under way (or none). Phoneme Pop is a different game.
      const bridge = msg.game && msg.game.kind !== 'phoneme' ? msg.game : null;
      gameRef.current = bridge;
      setGame(bridge);
      setSelected(null);
    } else if (msg.t === 'game:act' && msg.act?.a) {
      const next = applyAct(gameRef.current, msg.act);
      if (gameRef.current && next !== gameRef.current) commit(next, msg.pageId ? { pageId: msg.pageId, pageEpoch: msg.pageEpoch } : context);
    }
  };

  return { game, settings, selected, setSelected, start, stop, place, showNext, changeSettings, handle };
}
