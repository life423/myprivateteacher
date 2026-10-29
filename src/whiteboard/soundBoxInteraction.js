import { soundBoxes } from '../../shared/tiles.js';

export const SOUND_TAP_SLOP = 6;
export const SOUND_TARGET_PX = 44;

// Screen-space target sizes stay usable while zoomed out. Nearest-centre
// resolution avoids choosing the wrong neighbour where expanded edges meet.
export function soundBoxAt(point, count, scale = 1) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !(scale > 0)) return null;
  const minimum = SOUND_TARGET_PX / scale;
  return soundBoxes(count).map((box, index) => {
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const w = Math.max(box.width, minimum), h = Math.max(box.height, minimum);
    return { index, box, cx, cy, w, h };
  }).filter((target) => Math.abs(point.x - target.cx) <= target.w / 2 && Math.abs(point.y - target.cy) <= target.h / 2)
    .sort((a, b) => Math.hypot(point.x - a.cx, point.y - a.cy) - Math.hypot(point.x - b.cx, point.y - b.cy))[0] || null;
}

export function soundBoxButtonRect(box, layout) {
  const w = Math.max(SOUND_TARGET_PX, box.width * layout.scale);
  const h = Math.max(SOUND_TARGET_PX, box.height * layout.scale);
  return { x: layout.left + (box.x + box.width / 2) * layout.scale - w / 2, y: layout.top + (box.y + box.height / 2) * layout.scale - h / 2, w, h };
}

export function soundTapCanFinish(tap, event, state) {
  return Boolean(tap && event.type === 'pointerup' && state.canTap && state.tool === 'none' && !state.pinching &&
    tap.count === state.count && tap.epoch === state.epoch &&
    Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= SOUND_TAP_SLOP &&
    soundBoxAt(state.point, state.count, state.scale)?.index === tap.index);
}
