import { useCallback, useEffect, useRef, useState } from 'react';
import { STAGE, letterAt } from './stage.js';

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
  y: (h?.y ?? 0.17) * STAGE.height,
  letter: h?.letter ?? null,
  by: h?.by ?? null,
});
const START = { r: fromServer({ on: true, x: 0.6 }), l: fromServer({ on: false, x: 0.4 }) };
const pickupPoint = (point) => ({ x: point.x, y: point.y, letter: point.letter === undefined ? letterAt(point.x, point.y) : point.letter });
const isPoint = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y);

export function useHands({ me, send, sendThrottled, cancelThrottled = null }) {
  const [hands, setHands] = useState(START);
  const live = useRef(hands);
  const latest = useRef({}); // where this person last moved each hand, ahead of the next render
  const holding = useRef({}); // side -> the timer saying we still hold it
  const pickup = useRef(null); // an existing shared glove temporarily drawn by the local pickup cursor
  // Grab/drop echoes alternate on this ordered socket. Counters retain their order without
  // an unbounded queue, even when another local gesture starts before the last echo arrives.
  const ownership = useRef({ l: { version: 0, pending: 0, nextBy: null }, r: { version: 0, pending: 0, nextBy: null } });
  const [pickupSide, setPickupSide] = useState(null);
  const [interactionEpoch, setInteractionEpoch] = useState(0);
  const transport = useRef({ me, send, cancelThrottled });
  transport.current = { me, send, cancelThrottled };

  const replace = (next) => {
    live.current = next;
    setHands(next);
  };
  const update = (side, change) => replace({ ...live.current, [side]: { ...live.current[side], ...change } });
  const cancelMove = (side) => transport.current.cancelThrottled?.(`hand-${side}`);
  const stopHolding = (side) => {
    clearInterval(holding.current[side]);
    delete holding.current[side];
  };
  const clearPickup = (side, revoked = false) => {
    if (pickup.current?.side !== side) return;
    pickup.current = null;
    setPickupSide(null);
    if (revoked) setInteractionEpoch((epoch) => epoch + 1);
  };
  const resetOwnership = (side) => { ownership.current[side] = { version: 0, pending: 0, nextBy: null }; };
  const expectOwnership = (side, by) => {
    const intent = ownership.current[side];
    if (!intent.pending) intent.nextBy = by;
    intent.version += 1;
    intent.pending += 1;
  };
  const staleOwnershipEcho = (side, by) => {
    const intent = ownership.current[side];
    if (!intent.pending || intent.nextBy !== by) return false;
    const version = intent.version - intent.pending + 1;
    intent.pending -= 1;
    intent.nextBy = by === me ? null : me;
    return version < intent.version;
  };
  // Release and final pose are one authoritative operation, outside the motion budget.
  const sendDrop = (side, at) => transport.current.send({ t: 'hand', side, a: 'drop', x: round4(at.x / STAGE.width), y: round4(at.y / STAGE.height), letter: at.letter });

  useEffect(() => {
    // Fast Refresh can replay this effect while retaining React state. Its cleanup has
    // already restored the live glove; reconcile the drawing state when setup runs again.
    if (!pickup.current) { setPickupSide(null); setHands(live.current); }
    return () => {
      const borrowed = pickup.current;
      pickup.current = null;
      SIDES.forEach((side) => {
        const owned = holding.current[side] && live.current[side].by === transport.current.me;
        cancelMove(side);
        stopHolding(side);
        if (!owned) return;
        const at = borrowed?.side === side ? borrowed.origin : latest.current[side] || live.current[side];
        latest.current[side] = at;
        live.current = { ...live.current, [side]: { ...live.current[side], ...at, by: null } };
        // The socket may survive effect replay. Its eventual release must not cancel
        // a pickup begun after setup runs again.
        expectOwnership(side, null);
        sendDrop(side, at);
      });
    };
  }, []);

  // Messages from the server. Returns true when the message was only about hands.
  const handle = useCallback(
    (msg) => {
      const all = msg.t === 'hands' || msg.t === 'board' ? msg.hands : null;
      if (all) {
        // Clear/restore update an existing room. Only a new synchronization boundary
        // invalidates local gestures. Untagged snapshots support older servers safely.
        const syncing = msg.t === 'board' && !['clear', 'restore'].includes(msg.reason);
        if (syncing) setInteractionEpoch((epoch) => epoch + 1);
        const next = { r: fromServer(all.r), l: fromServer(all.l) };
        SIDES.forEach((side) => {
          if (syncing) {
            // A true synchronization snapshot starts a new authority boundary.
            resetOwnership(side);
            cancelMove(side);
            stopHolding(side);
            clearPickup(side);
          } else if (!next[side].on || (next[side].by && next[side].by !== me)) {
            resetOwnership(side);
            cancelMove(side);
            stopHolding(side);
            clearPickup(side, true);
          } else if (ownership.current[side].pending) next[side] = live.current[side];
          else if (next[side].by !== me) {
            cancelMove(side);
            stopHolding(side);
            clearPickup(side, true);
          } else if (holding.current[side]) Object.assign(next[side], latest.current[side]);
        });
        replace(next);
        return msg.t === 'hands';
      }
      if (msg.t !== 'hand' || !SIDES.includes(msg.side)) return false;
      const hand = fromServer(msg);
      if (!hand.on || (hand.by && hand.by !== me)) resetOwnership(msg.side);
      else if (staleOwnershipEcho(msg.side, hand.by)) return true;
      if (!hand.on || hand.by !== me) {
        resetOwnership(msg.side);
        cancelMove(msg.side);
        stopHolding(msg.side);
        clearPickup(msg.side, true); // A new owner is authoritative; never restore over their hand.
      }
      // While you hold it, where it is comes from you, not the server's copy.
      if (hand.on && hand.by === me && holding.current[msg.side]) update(msg.side, { on: hand.on, by: me });
      else update(msg.side, hand);
      return true;
    },
    [me],
  );

  // No gesture or queued motion belongs to a disconnected transport. Do not send
  // restoration on the next socket; its synchronization will supply authoritative hands.
  const disconnect = useCallback(() => {
    SIDES.forEach((side) => { resetOwnership(side); cancelMove(side); stopHolding(side); });
    pickup.current = null;
    setPickupSide(null);
    replace(Object.fromEntries(SIDES.map((side) => [side, { ...live.current[side], by: null }])));
    setInteractionEpoch((epoch) => epoch + 1);
  }, []);

  // Takes hold of a hand. The tutor can take one from the student; the student can't take the tutor's.
  const grab = useCallback(
    (side) => {
      const hand = live.current[side];
      if (!hand?.on || (hand.by && hand.by !== me && me !== 'tutor')) return false;
      cancelMove(side);
      latest.current[side] = { x: hand.x, y: hand.y, letter: hand.letter };
      if (hand.by !== me) expectOwnership(side, me);
      update(side, { by: me });
      send({ t: 'hand', side, a: 'grab' });
      stopHolding(side);
      holding.current[side] = setInterval(() => transport.current.send({ t: 'hand', side, a: 'grab' }), KEEP_HOLDING_MS);
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
      cancelMove(side);
      clearPickup(side);
      if (!holding.current[side]) return;
      stopHolding(side);
      const at = latest.current[side] || live.current[side];
      expectOwnership(side, null);
      sendDrop(side, at);
      update(side, { by: null });
    },
    [send],
  );

  // A successful letter drop leaves the borrowed glove there; cancellation returns it to
  // its original point. Either way, the original shared hand is released, never cloned.
  const finishLetterPickup = useCallback(
    (point = null) => {
      const borrowed = pickup.current;
      if (!borrowed) return;
      const { side, origin } = borrowed;
      if (!holding.current[side] || !live.current[side].on || live.current[side].by !== me) {
        cancelMove(side);
        stopHolding(side);
        clearPickup(side, true);
        return;
      }
      const at = isPoint(point) ? pickupPoint(point) : origin;
      latest.current[side] = at;
      update(side, at);
      drop(side);
    },
    [me, drop],
  );

  // Borrow a glove only if it is already out and nobody else holds it. A letter drag can
  // still proceed with an ordinary cursor when this returns null; hidden gloves stay off.
  const beginLetterPickup = useCallback(
    (text, point) => {
      finishLetterPickup();
      if (!isPoint(point)) return null;
      const available = ['r', 'l'].filter((side) => live.current[side].on && (!live.current[side].by || live.current[side].by === me));
      const side = available.find((side) => live.current[side].letter === text) ?? available[0];
      if (!side) return null;
      const { x, y, letter } = live.current[side];
      if (!grab(side)) return null;
      pickup.current = { side, origin: { x, y, letter } };
      setPickupSide(side);
      move(side, { x: point.x, y: point.y, letter: text });
      return side;
    },
    [me, finishLetterPickup, grab, move],
  );

  const moveLetterPickup = useCallback(
    (point) => {
      const borrowed = pickup.current;
      if (!borrowed || !isPoint(point)) return;
      move(borrowed.side, pickupPoint(point));
    },
    [move],
  );

  const show = useCallback(
    (side, on) => {
      if (!on) {
        if (pickup.current?.side === side) finishLetterPickup();
        cancelMove(side);
        stopHolding(side);
      }
      update(side, on ? { on } : { on, by: null });
      send({ t: 'hands', [side]: on });
    },
    [send, finishLetterPickup],
  );

  // After a server restart the tutor hands back which hands were out, and where.
  const restore = useCallback(() => {
    const h = live.current;
    const at = Object.fromEntries(SIDES.map((s) => [s, { x: round4(h[s].x / STAGE.width), y: round4(h[s].y / STAGE.height), letter: h[s].letter }]));
    send({ t: 'hands', r: h.r.on, l: h.l.on, at });
  }, [send]);

  // The borrowed hand remains in raw state, but the pickup cursor draws it locally.
  const visible = SIDES.filter((s) => hands[s].on && s !== pickupSide).map((s) => ({ side: s, ...hands[s] }));
  const letters = visible.map((h) => h.letter).filter(Boolean);

  return { hands, visible, letters, interactionEpoch, disconnect, handle, grab, move, drop, show, restore, beginLetterPickup, moveLetterPickup, finishLetterPickup };
}
