// Both screens draw the same fixed 1600 x 1000 stage, scaled to fit, so a point
// on the tutor's monitor is the same point on the student's tablet.
export const STAGE = { width: 1600, height: 1000 };
// The board's shape for CSS: it keeps 16:10 and grows as large as the screen allows.
export const BOARD_SHAPE = { aspectRatio: `${STAGE.width} / ${STAGE.height}` };
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const STRIP = { x: 24, y: 24, width: 1552, height: 132 };
export const CELL_WIDTH = STRIP.width / LETTERS.length;
export const BOARD = { x: 24, y: 184, width: 1552, height: 792 };

// With the alphabet strip hidden, the board reaches up into its space. Nothing moves:
// the coordinates, the guide lines, the writing and the tiles all stay where they are.
export const OPEN_BOARD = { x: 24, y: 24, width: 1552, height: 952 };
export const boardRect = (strip) => (strip ? BOARD : OPEN_BOARD);

// On touch screens the fingertip sits this far above the finger, so the child
// can still see the letter they're pointing at.
export const TOUCH_LIFT = 48;

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export const isRoomCode = (value) =>
  typeof value === 'string' && value.length === 4 && [...value].every((c) => c >= '0' && c <= '9');

export function letterAt(x, y, strip = true) {
  if (!strip || y < STRIP.y || y > STRIP.y + STRIP.height) return null;
  const index = Math.floor((x - STRIP.x) / CELL_WIDTH);
  return index >= 0 && index < LETTERS.length ? LETTERS[index] : null;
}

// Where the student's hand waits until someone moves it. Both screens start it here,
// so the tutor always has a hand to grab.
