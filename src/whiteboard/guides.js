import { DEFAULT_LINES } from '../../shared/lines.js';

// Height from the top line to the baseline, in board units. Like handwriting paper, the dashed
// midline sits halfway, and each row leaves a skip space of half that height below it for the
// letters that drop below the baseline (g, p, y). The sizes follow paper rulings (3/4 in for
// K-1, 1/2 in for grades 2-3, 3/8 in for cursive), scaled up for a finger or mouse on a screen:
// about 1 1/2, 1 and 3/4 inch on a laptop.
const BAND = { big: 240, medium: 160, small: 120 };
const PAD = 48; // room kept clear at the top and bottom of the board

// The rows of lines that fit the board, centred top to bottom: [{ top, mid, base }].
export function guideRows(rect, size = DEFAULT_LINES) {
  const band = BAND[size];
  if (!band) return [];
  const pitch = band * 1.5;
  const count = Math.max(1, Math.floor((rect.height - 2 * PAD + band / 2) / pitch));
  const start = rect.y + (rect.height - (count * pitch - band / 2)) / 2;
  return Array.from({ length: count }, (_, i) => {
    const top = start + i * pitch;
    return { top, mid: top + band / 2, base: top + band };
  });
}
