import { useRef, useState } from 'react';
import { fromWire, toWire } from '../../../shared/phoneme.js';
import { usePhonemeGame } from './usePhonemeGame.js';

// Phoneme Pop on the whiteboard, from the tutor's side. The tutor's copy runs the game and sends
// its state to the student's screen; the student's taps arrive as intents and are applied here.
export function usePhonemeTutor(send) {
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const sendRef = useRef(send);
  sendRef.current = send;
  const latest = useRef({ total: 0 }); // how many words this level has, as of the last render

  const publish = (state) => sendRef.current({ t: 'game', game: { kind: 'phoneme', ...toWire(state, latest.current.total) } });
  const game = usePhonemeGame({
    onChange: (state) => {
      if (activeRef.current) publish(state);
    },
  });
  latest.current.total = game.bank.words[game.state.level]?.length ?? 0;

  const start = () => {
    activeRef.current = true;
    setActive(true);
    publish(game.state);
  };
  const stop = () => {
    activeRef.current = false;
    setActive(false);
    sendRef.current({ t: 'game', game: null });
  };

  // Messages from the server about Phoneme Pop. Returns nothing: other parts of the whiteboard
  // handle the same 'board' message.
  const handle = (msg) => {
    if (msg.t === 'board') {
      const isPhoneme = msg.game?.kind === 'phoneme';
      // A reconnect gets the game that was under way: pick it up, or know it's not on
      activeRef.current = isPhoneme;
      setActive(isPhoneme);
      if (isPhoneme) game.restore(fromWire(msg.game));
    } else if (msg.t === 'game:act' && msg.act?.type && activeRef.current) {
      game.act(msg.act);
    }
  };

  return { active, state: game.state, bank: game.bank, start, stop, act: game.act, handle };
}
