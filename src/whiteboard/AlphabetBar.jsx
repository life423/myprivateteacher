import { useEffect, useLayoutEffect, useRef } from 'react';
import Hand, { GLOVE_BOX } from './Hand.jsx';
import { BOARD, CELL_WIDTH, LETTERS, STRIP } from './stage.js';
import { usePointerLifecycle } from './pointerLifecycle.js';

// The alphabet on phones: two rows of 13, pinned above the zoomable board and sized to the
// screen, so every letter is always in view. The board's own one-row strip is still there (the
// tutor's screen shows it). The two shared hands move freely over this bar: a hand above the
// board shows here, under the same letter, following the finger rather than jumping letter to
// letter; and a held hand carries on between this bar and the board in one drag, either way.
const ROWS = [LETTERS.slice(0, 13), LETTERS.slice(13)];
const PER_ROW = 13;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Above the board, so shown here rather than on the board.
export const inBar = (hand) => hand.y < BOARD.y;

// Where a hand sits on this bar: its row, and how far across and down that row (0 to 1).
function barSpot(hand) {
  const i = clamp((hand.x - STRIP.x) / CELL_WIDTH, 0, LETTERS.length - 0.001);
  const row = i >= PER_ROW ? 1 : 0;
  return { row, across: (i - row * PER_ROW) / PER_ROW, down: clamp((hand.y - STRIP.y) / STRIP.height, 0, 1) };
}

// A glove at the same size next to the letters as on the board, fingertip exactly on its spot.
// It hangs below the letters, over the board, so when it can be held it catches taps itself,
// anywhere on it; otherwise taps pass through it to the board.
function Glove({ hand, grabbable }) {
  const box = GLOVE_BOX[hand.side];
  const { across, down } = barSpot(hand);
  return (
    <svg
      viewBox={`${box.left} 0 ${box.width} ${box.height}`}
      data-bar-hand={hand.side}
      className={`hand-${hand.side} absolute z-10 overflow-visible ${grabbable ? 'cursor-grab touch-none' : 'pointer-events-none'}`}
      style={{
        width: `${(box.width / CELL_WIDTH) * (100 / PER_ROW)}%`,
        left: `${across * 100}%`,
        top: `${down * 100}%`,
        aspectRatio: `${box.width} / ${box.height}`,
        transform: `translateX(${(box.left / box.width) * 100}%)`,
      }}
      aria-hidden='true'
    >
      <Hand x={0} y={0} side={hand.side} holder={hand.by} />
    </svg>
  );
}

const tone = (pointed) => (pointed ? 'border-2 border-blue-500 bg-blue-100 text-blue-800' : 'border-slate-200 bg-white text-slate-800');

export default function AlphabetBar({ hands = [], canHold = false, handActions = null, me = 'student', api = null, stageApi = null }) {
  const rows = useRef([]);
  const held = useRef(new Map()); // pointer id -> the side of the hand it holds
  const pointers = usePointerLifecycle(event => movePointer(event), event => finishPointer(event));
  const handEpoch = handActions?.interactionEpoch;
  const previousHandEpoch = useRef(handEpoch);
  useEffect(() => {
    if (previousHandEpoch.current !== handEpoch) pointers.cancelAll('authority');
    previousHandEpoch.current = handEpoch;
  }, [handEpoch, pointers]);
  const holdable = (h) => !h.by || h.by === me || me === 'tutor';

  // A point on this bar, in the board's strip coordinates (or null off the bar).
  const pointAt = (clientX, clientY) => {
    const [a, b] = rows.current.map((el) => el?.getBoundingClientRect());
    if (!a?.width || !b?.width || !a.height || !b.height) return null;
    if (clientX < a.left - 4 || clientX > a.right + 4 || clientY < a.top - 6 || clientY > b.bottom + 6) return null;
    const row = clientY < (a.bottom + b.top) / 2 ? 0 : 1;
    const r = row ? b : a;
    const i = row * PER_ROW + clamp((clientX - r.left) / r.width, 0, 0.9999) * PER_ROW;
    return { x: STRIP.x + i * CELL_WIDTH, y: STRIP.y + clamp((clientY - r.top) / r.height, 0, 1) * STRIP.height, letter: LETTERS[Math.floor(i)] };
  };
  // The board's hand drags ask this bar where a finger over it points.
  useLayoutEffect(() => {
    if (!api) return undefined;
    const publicApi = { pointAt };
    api.current = publicApi;
    return () => { if (api.current === publicApi) api.current = null; };
  });

  const finishPointer = (event) => {
    const side = held.current.get(event.pointerId);
    if (!side) return;
    held.current.delete(event.pointerId);
    if (event.type === 'pointerup') {
      const point = pointAt(event.clientX, event.clientY) || stageApi?.current?.pointAt(event.clientX, event.clientY);
      if (point) handActions?.move(side, { x: point.x, y: point.y, letter: point.letter ?? null });
    }
    handActions?.drop(side);
  };
  const movePointer = (event) => {
    const side = held.current.get(event.pointerId);
    if (!side) return;
    const hand = hands.find((h) => h.side === side);
    if (!hand || (hand.by && hand.by !== me)) {
      held.current.delete(event.pointerId);
      return;
    }
    const point = pointAt(event.clientX, event.clientY) || stageApi?.current?.pointAt(event.clientX, event.clientY);
    if (point) handActions.move(side, { x: point.x, y: point.y, letter: point.letter ?? null });
  };

  return (
    <div
      role='group'
      aria-label='Alphabet'
      className='grid shrink-0 touch-none select-none gap-1 rounded-2xl bg-white p-1.5 shadow'
      onPointerDown={(event) => {
        if (!canHold || event.button !== 0) return;
        pointers.start(event);
        const p = pointAt(event.clientX, event.clientY);
        const taken = new Set(held.current.values());
        // A press on a glove holds that hand; otherwise the hand nearest the finger, within
        // about a letter's width of it.
        const tapped = event.target.closest?.('[data-bar-hand]')?.dataset.barHand;
        let best = canHold && handActions && tapped ? hands.find((h) => h.side === tapped && !taken.has(h.side) && holdable(h)) || null : null;
        let distance = best ? 0 : Infinity;
        if (canHold && handActions && !best && p) {
          for (const h of hands) {
            if (!inBar(h) || taken.has(h.side) || !holdable(h)) continue;
            const d = Math.hypot((h.x - p.x) / CELL_WIDTH, (h.y - p.y) / STRIP.height);
            if (d < distance) [best, distance] = [h, d];
          }
        }
        if (!best || distance > 1.5 || !handActions?.grab(best.side)) return;
        held.current.set(event.pointerId, best.side);
        pointers.capture(event);
        if (p) handActions.move(best.side, p);
      }}
      onPointerMove={movePointer}
      onPointerUp={pointers.end}
      onPointerCancel={pointers.end}
      onLostPointerCapture={event => pointers.cancel(event.pointerId, 'capture-lost')}
    >
      {ROWS.map((row, r) => (
        <div
          key={r}
          ref={(el) => {
            rows.current[r] = el;
          }}
          className='relative grid gap-1'
          style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}
        >
          {row.map((letter) => (
            <span
              key={letter}
              data-letter={letter}
              className={`flex h-9 items-center justify-center rounded-lg border text-lg font-extrabold sm:h-12 sm:rounded-xl sm:text-2xl ${tone(
                hands.some((h) => h.letter === letter),
              )}`}
            >
              {letter}
            </span>
          ))}
          {hands
            .filter((h) => inBar(h) && barSpot(h).row === r)
            .map((h) => (
              <Glove key={h.side} hand={h} grabbable={canHold && holdable(h)} />
            ))}
        </div>
      ))}
    </div>
  );
}
