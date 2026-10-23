import { createContext } from 'react';
import { STAGE, clamp } from './stage.js';

// Zoom and pan for the whiteboard, on each screen separately. The board keeps its 1600 x 1000
// coordinates; a view only decides which part of it shows, and how big, so the other person
// never notices. `view` is null for 'fit the whole board', or { scale, cx, cy }: screen pixels
// per board unit, and the board point in the middle of the screen.

// How far in anyone can zoom: four times the size that fills the screen's longer side.
export const MAX_ZOOM = 4;

// Set by the layout: on narrower screens a board held upright starts filling the height, and
// with the alphabet bar pinned above it (phones), it starts at the writing area below the strip.
// `align: 'end'` sits a board that's shorter than its box at the bottom, leaving the spare room
// on top (tablets held upright put the video there).
export const BoardFit = createContext({ fill: false, bar: false, align: 'center' });

// Where the writing area starts, for a phone that shows the alphabet in its own bar.
export const BELOW_STRIP = 168;

// Where the board sits in a width x height box for a view. Bigger than the box, it never
// leaves a gap at an edge; smaller, it sits in the middle.
// minY: nothing above this stage line ever shows. On phones the alphabet has its own bar, so the
// board's own strip is kept out of view, whatever the zoom, pan or fit.
export function frame(width, height, view, align = 'center', minY = 0) {
  if (!width || !height) return { left: 0, top: 0, width: 0, height: 0, scale: 0, fit: 0, max: 0 };
  const span = STAGE.height - minY; // the height of the stage that may show
  const fit = Math.min(width / STAGE.width, height / span);
  const max = Math.max(width / STAGE.width, height / span) * MAX_ZOOM;
  const scale = view ? clamp(view.scale, fit, max) : fit;
  const w = STAGE.width * scale;
  const h = STAGE.height * scale;
  const shown = span * scale;
  const place = (box, size, centre, end = false) =>
    size <= box ? (end ? box - size : (box - size) / 2) : clamp(box / 2 - centre * scale, box - size, 0);
  const top =
    shown <= height
      ? -minY * scale + (minY ? 0 : align === 'end' ? height - shown : (height - shown) / 2) // with minY, at the top: nothing above it shows
      : clamp(height / 2 - (view ? view.cy : minY + span / 2) * scale, height - h, -minY * scale);
  return {
    left: place(width, w, view ? view.cx : STAGE.width / 2),
    top,
    width: w,
    height: h,
    scale,
    fit,
    max,
  };
}

// The part of the board the box shows, as an SVG viewBox. It runs past the board's edges when
// the board is smaller than the box, so every layer lines up with the same frame.
export const viewBoxOf = (f, width, height) =>
  f.scale ? `${-f.left / f.scale} ${-f.top / f.scale} ${width / f.scale} ${height / f.scale}` : `0 0 ${STAGE.width} ${STAGE.height}`;

// The view that shows board point (x, y) at box point (px, py), at a scale. Pinching uses it to
// keep the spot between the fingers under the fingers.
export const viewAt = (width, height, scale, x, y, px, py) => ({
  scale,
  cx: x + (width / 2 - px) / scale,
  cy: y + (height / 2 - py) / scale,
});

// The board filling the box's height from `top` down, from its left edge.
export function fillView(width, height, top = 0, centreX = null) {
  const scale = height / (STAGE.height - top);
  // From the board's left edge, or centred on a point (the sound boxes) as far as the board allows.
  const half = width / 2 / scale;
  const cx = centreX == null ? half : Math.min(Math.max(centreX, half), STAGE.width - half);
  return { scale, cx, cy: top + (STAGE.height - top) / 2 };
}
