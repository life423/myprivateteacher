// Local demonstration only: these letters never enter a lesson or call its API.
export const PREVIEW_LETTERS = ['c', 'a', 't'];

export function movePreviewLetter(boxes, source, destination) {
  if (!Number.isInteger(destination) || destination < 0 || destination >= boxes.length) return boxes;
  const letter = source.kind === 'box' ? boxes[source.index] : source.letter;
  if (!PREVIEW_LETTERS.includes(letter)) return boxes;
  if (source.kind === 'box' && source.index === destination) return boxes;
  const next = [...boxes];
  const previous = next.indexOf(letter);
  const replaced = next[destination];
  if (previous !== -1) next[previous] = replaced || null;
  next[destination] = letter;
  return next;
}

export const SOUND_WORDS = [
  { word: 'cat', sounds: ['c', 'a', 't'] },
  { word: 'ship', sounds: ['sh', 'i', 'p'] },
  { word: 'stop', sounds: ['s', 't', 'o', 'p'] },
];
