import { useCallback, useEffect, useRef, useState } from 'react';
import { STAGE } from './stage.js';

// The two shared hands, right (r) and left (l), as the server has them, plus this person's
// holding: grab, move, let go. Positions here are stage units. While a hand is held, this
// screen tells the server every 2 seconds, so a held hand never lets go on its own; if the
// tutor takes it (or it's switched off), the hand stops following this person at once.
export const SIDES = ['l', 'r'];
const KEEP_HOLDING_MS = 2000;
const round4 = (n) => Math.round(n * 10000) / 10000;
const fromServer = (h) => ({
  on: Boolean(h?.on),
  x: (h?.x ?? 0.5) * STAGE.width,
  y: (h?.y ?? 0.19) * STAGE.height,
  letter: h?.letter ?? null,
  by: h?.by ?? null,
});
const START = { r: fromServer({ on: true, x: 0.6 }), l: fromServer({ on: false, x: 0.4 }) };

export function useHands({ me, send, sendThrottled }) {
  const [hands, setHands] = useState(START);
  const live = useRef(hands);
  live.current = hands;
  const latest = useRef({}); // where this person last moved each hand, ahead of the next render
  const holding = useRef({}); // side -> the timer saying we still hold it

  const stopHolding = (side) => {
    clearInterval(holding.current[side]);
    delete holding.current[side];
  };
  useEffect(() => () => SIDES.forEach(stopHolding), []);
  const update = (side, change) => setHands((was) => ({ ...was, [side]: { ...was[side], ...change } }));

  // Messages from the server. Returns true when the message was only about hands.
  const handle = useCallback(
    (msg) => {
      const all = msg.t === 'hands' || msg.t === 'board' ? msg.hands : null;
      if (all) {
        setHands({ r: fromServer(all.r), l: fromServer(all.l) });
        SIDES.forEach((side) => all[side]?.by !== me && stopHolding(side));
        return msg.t === 'hands';
      }
      if (msg.t !== 'hand' || !SIDES.includes(msg.side)) return false;
      const hand = fromServer(msg);
      if (hand.by !== me) stopHolding(msg.side);
      // While you hold it, where it is comes from you, not the server's copy.
      if (hand.by === me && holding.current[msg.side]) update(msg.side, { on: hand.on, by: me });
      else update(msg.side, hand);
      return true;
    },
    [me],
  );

  // Takes hold of a hand. The tutor can take one from the student; the student can't take the tutor's.
  const grab = useCallback(
    (side) => {
      const hand = live.current[side];
      if (!hand?.on || (hand.by && hand.by !== me && me !== 'tutor')) return false;
      latest.current[side] = { x: hand.x, y: hand.y, letter: hand.letter };
      update(side, { by: me });
      send({ t: 'hand', side, a: 'grab' });
      stopHolding(side);
      holding.current[side] = setInterval(() => send({ t: 'hand', side, a: 'grab' }), KEEP_HOLDING_MS);
      return true;
    },
    [me, send],
  );

  const move = useCallback(
    (side, p) => {
      if (!holding.current[side]) return;
      const at = { x: p.x, y: p.y, letter: p.letter ?? null };
      latest.current[side] = at;
      update(side, at);
      sendThrottled(`hand-${side}`, { t: 'hand', side, a: 'move', x: round4(at.x / STAGE.width), y: round4(at.y / STAGE.height), letter: at.letter });
    },
    [sendThrottled],
  );

  // Lets go: the hand stays exactly where it was let go, on both screens.
  const drop = useCallback(
    (side) => {
      if (!holding.current[side]) return;
      stopHolding(side);
      const at = latest.current[side];
      if (at) send({ t: 'hand', side, a: 'move', x: round4(at.x / STAGE.width), y: round4(at.y / STAGE.height), letter: at.letter });
      send({ t: 'hand', side, a: 'drop' });
      update(side, { by: null });
    },
    [send],
  );

  const show = useCallback(
    (side, on) => {
      if (!on) stopHolding(side);
      update(side, on ? { on } : { on, by: null });
      send({ t: 'hands', [side]: on });
    },
    [send],
  );

  // After a server restart the tutor hands back which hands were out, and where.
  const restore = useCallback(() => {
    const h = live.current;
    const at = Object.fromEntries(SIDES.map((s) => [s, { x: round4(h[s].x / STAGE.width), y: round4(h[s].y / STAGE.height), letter: h[s].letter }]));
    send({ t: 'hands', r: h.r.on, l: h.l.on, at });
  }, [send]);

  // The hands that are out, for drawing: left first, so the right sits on top where they meet.
  const visible = SIDES.filter((s) => hands[s].on).map((s) => ({ side: s, ...hands[s] }));
  const letters = visible.map((h) => h.letter).filter(Boolean);

  return { hands, visible, letters, handle, grab, move, drop, show, restore };
}
