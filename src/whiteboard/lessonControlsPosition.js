// Commands float above the guide, but stay inside the currently visible viewport
// (including a tablet's virtual keyboard). This never changes the board layout.
export function lessonControlsPosition(anchor, viewport) {
  const edge = 8;
  const width = Math.max(0, Math.min(320, viewport.width - edge * 2));
  const left = Math.max(viewport.left + edge, Math.min(anchor.right - width, viewport.left + viewport.width - width - edge));
  const minVisibleHeight = Math.min(160, Math.max(0, viewport.height - edge * 2));
  const top = Math.max(viewport.top + edge, Math.min(anchor.bottom + edge, viewport.top + viewport.height - edge - minVisibleHeight));
  return { left, top, width, maxHeight: Math.max(0, viewport.top + viewport.height - top - edge) };
}
