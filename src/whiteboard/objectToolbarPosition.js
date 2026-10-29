const clamp = (value, low, high) => Math.max(low, Math.min(value, Math.max(low, high)));
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// Screen pixels, not stage units: the controls stay the same usable size at every zoom.
export function objectToolbarPosition(object, layout, viewport, toolbar, { topInset = 8, reserved = [] } = {}) {
  const width = Math.min(toolbar.width, Math.max(0, viewport.width - 16));
  const height = toolbar.height;
  const minimumTop = clamp(topInset, 8, viewport.height - height - 8);
  const anchor = { x: layout.left + object.x * layout.scale, y: layout.top + object.y * layout.scale, w: object.w * layout.scale, h: object.h * layout.scale };
  const x = clamp(anchor.x + anchor.w / 2 - width / 2, 8, viewport.width - width - 8);
  const above = anchor.y - height - 10;
  const below = anchor.y + anchor.h + 10;
  let y = above >= minimumTop ? above : below + height <= viewport.height - 8 ? below : minimumTop;
  y = clamp(y, minimumTop, viewport.height - height - 8);
  let result = { x, y, w: width, h: height };
  for (const area of reserved) if (overlaps(result, area)) {
    const right = area.x + area.w + 8;
    if (right + width <= viewport.width - 8) result.x = right;
    else result.y = clamp(area.y + area.h + 8, minimumTop, viewport.height - height - 8);
  }
  return { left: result.x, top: result.y };
}
