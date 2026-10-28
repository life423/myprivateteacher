import { boardRect } from './stage.js';

// Anchor the floating control to the writing paper below an internal alphabet,
// using the current board-to-screen transform so zoom, pan and fitting agree.
// An external alphabet is already outside Stage; no extra offset is needed.
export function pictureLayersTop(layout, { strip = true, externalAlphabet = false, floatingTools = false } = {}) {
  // In a landscape compact layout the Tools trigger occupies top 12px + 48px.
  const minimum = floatingTools ? 68 : 8;
  if (!strip || externalAlphabet || !layout?.scale) return minimum;
  const top = layout.top + boardRect(true).y * layout.scale + 8;
  return Number.isFinite(top) ? Math.max(minimum, top) : minimum;
}
