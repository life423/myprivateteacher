// Phoneme Pop on the whiteboard: the game's state as it travels between the tutor's screen and the
// student's (as JSON, so the solved words are a list), and the actions a student may send. Shared by
// the browser and the server, which checks what a student sends before passing it on.

export const INTENTS = new Set(['toggleTile', 'split', 'check', 'hear', 'next', 'chooseLevel', 'showNext']);
const MAX_LEVEL = 99;
const MAX_ID = 80;

// The game state as plain JSON. `total` is how many words the level has, for the progress bar.
export function toWire(state, total = 0) {
  return { ...state, solved: [...state.solved], total };
}

// Back to the shape the game uses (solved is a Set). The extra fields are dropped.
export function fromWire(wire) {
  const { kind, total, ...state } = wire; // eslint-disable-line no-unused-vars
  return { ...state, solved: new Set(wire.solved || []) };
}

// A student's action, checked: a known kind, with the right fields. Anything else is null.
export function cleanIntent(intent) {
  if (!intent || typeof intent !== 'object' || !INTENTS.has(intent.type)) return null;
  if (intent.type === 'toggleTile') {
    return typeof intent.id === 'string' && intent.id.length > 0 && intent.id.length <= MAX_ID ? { type: 'toggleTile', id: intent.id } : null;
  }
  if (intent.type === 'chooseLevel') {
    return Number.isInteger(intent.level) && intent.level > 0 && intent.level <= MAX_LEVEL ? { type: 'chooseLevel', level: intent.level } : null;
  }
  return { type: intent.type };
}
