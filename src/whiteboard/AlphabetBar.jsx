import { useRef } from 'react';
import Hand, { GLOVE_BOX } from './Hand.jsx';
import { CELL_WIDTH, LETTERS, STRIP } from './stage.js';

// The alphabet on phones: two rows of 13, pinned above the zoomable board and sized to the
// screen, so every letter is always in view. The board's own one-row strip is still there
// (the tutor's screen shows it). The two shared hands show here on the letters they point at,
// the same gloves as on the board at the same size next to the letters; holding a hand here
// and sliding along the letters moves it from letter to letter on both screens.
const ROWS = [LETTERS.slice(0, 13), LETTERS.slice(13)];

// A glove drawn over a letter, fingertip on the letter's centre. On the board a letter is
// CELL_WIDTH wide, so here the glove is that many letter-widths wide.
function gloveStyle(side) {
  const box = GLOVE_BOX[side];
  const width = (box.width / CELL_WIDTH) * 100;
  return { width: `${width}%`, left: `${50 - (-box.left / box.width) * width}%`, top: '50%', aspectRatio: `${box.width} / ${box.height}` };
}

function Glove({ side, holder }) {
  const box = GLOVE_BOX[side];
  return (
    <svg
      viewBox={`${box.left} 0 ${box.width} ${box.height}`}
      className={`hand-${side} pointer-events-none absolute z-10 overflow-visible`}
      style={gloveStyle(side)}
      aria-hidden='true'
    >
      <Hand x={0} y={0} side={side} holder={holder} />
    </svg>
  );
}

// Where a letter sits on the shared board's strip.
export const letterPoint = (letter) => {
  const i = LETTERS.indexOf(letter);
  return { x: STRIP.x + (i + 0.5) * CELL_WIDTH, y: STRIP.y + STRIP.height / 2, letter };
};

// A letter a hand points at lights up in the hands' blue, as on the board.
const tone = (pointed) =>
  pointed ? 'border-2 border-blue-500 bg-blue-100 text-blue-800' : 'border-slate-200 bg-white text-slate-800';

const letterUnder = (event) => document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-letter]')?.dataset.letter;

export default function AlphabetBar({ hands = [], canHold = false, handActions = null, me = 'student' }) {
  const held = useRef(new Map()); // pointer id -> the side of the hand it holds
  const holdable = (h) => !h.by || h.by === me || me === 'tutor';

  const release = (event) => {
    const side = held.current.get(event.pointerId);
    if (!side) return;
    held.current.delete(event.pointerId);
    handActions?.drop(side);
  };

  return (
    <div
      role='group'
      aria-label='Alphabet'
      className='grid shrink-0 touch-none select-none gap-1 rounded-2xl bg-white p-1.5 shadow'
      onPointerDown={(event) => {
        if (!canHold || !handActions) return;
        const letter = letterUnder(event);
        const taken = new Set(held.current.values());
        const hand = [...hands].reverse().find((h) => h.letter === letter && !taken.has(h.side) && holdable(h));
        if (!hand || !handActions.grab(hand.side)) return;
        held.current.set(event.pointerId, hand.side);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // works without capture too
        }
      }}
      onPointerMove={(event) => {
        const side = held.current.get(event.pointerId);
        if (!side) return;
        const hand = hands.find((h) => h.side === side);
        if (!hand || (hand.by && hand.by !== me)) {
          held.current.delete(event.pointerId); // switched off, or the tutor took it
          return;
        }
        const letter = letterUnder(event);
        if (letter && letter !== hand.letter) handActions.move(side, letterPoint(letter));
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      {ROWS.map((row, r) => (
        <div key={r} className='grid gap-1' style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}>
          {row.map((letter) => {
            const here = hands.filter((h) => h.letter === letter);
            const grabbable = canHold && here.some(holdable);
            return (
              <span
                key={letter}
                data-letter={letter}
                className={`relative flex h-9 items-center justify-center rounded-lg border text-lg font-extrabold sm:h-12 sm:rounded-xl sm:text-2xl ${tone(here.length > 0)} ${grabbable ? 'cursor-grab' : ''}`}
              >
                {letter}
                {here.map((h) => (
                  <Glove key={h.side} side={h.side} holder={h.by} />
                ))}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
