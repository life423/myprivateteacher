// Magic Select: find the separate pictures and blocks of text on a worksheet image, in the
// browser, with no libraries. Works on a small copy (up to 400px on the long side) for speed;
// boxes come back in that copy's pixels, so the caller scales them to the original.
//
// 1. Paper colour: the most common colour on the page.
// 2. Mark every pixel that isn't paper, ignoring a frame around the page.
// 3. Pictures: groups of touching marked pixels, exactly as drawn, that are sizeable in both
//    directions. Two pictures only merge if they really touch.
// 4. Text: everything else, with hairline gaps bridged so letters join into lines and blocks.
// 5. Each region gets a box, how much of the box it fills, and (for pictures) corner rounding.

const PAPER_TOLERANCE = 36; // summed RGB difference still counted as paper

export function paperColour({ data }) {
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = 0;
  let bestCount = -1;
  for (const [key, n] of counts) if (n > bestCount) [best, bestCount] = [key, n];
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    if (key === best && data[i + 3] >= 128) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  }
  return n ? [r / n, g / n, b / n] : [255, 255, 255];
}

export function inkMask(image, paper = paperColour(image)) {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    if (data[i + 3] < 128) continue; // transparent counts as paper
    const d = Math.abs(data[i] - paper[0]) + Math.abs(data[i + 1] - paper[1]) + Math.abs(data[i + 2] - paper[2]);
    if (d > PAPER_TOLERANCE) mask[p] = 1;
  }
  return mask;
}

// A frame around the page (a screenshot edge, a scan border): bands along an edge that are
// almost all ink with mostly paper just inside. Treat them as paper so the frame can't
// join up with things near the edge. A full-bleed photo isn't a frame: no paper inside it.
function shaveFrame(mask, width, height) {
  const rowShare = (y) => { let n = 0; for (let x = 0; x < width; x++) n += mask[y * width + x]; return n / width; };
  const colShare = (x) => { let n = 0; for (let y = 0; y < height; y++) n += mask[y * width + x]; return n / height; };
  const sides = [
    { lines: height, share: (i) => rowShare(i), clear: (i) => mask.fill(0, i * width, (i + 1) * width) },
    { lines: height, share: (i) => rowShare(height - 1 - i), clear: (i) => mask.fill(0, (height - 1 - i) * width, (height - i) * width) },
    { lines: width, share: (i) => colShare(i), clear: (i) => { for (let y = 0; y < height; y++) mask[y * width + i] = 0; } },
    { lines: width, share: (i) => colShare(width - 1 - i), clear: (i) => { for (let y = 0; y < height; y++) mask[y * width + width - 1 - i] = 0; } },
  ];
  for (const side of sides) {
    const limit = Math.ceil(side.lines * 0.08);
    let t = 0;
    while (t < limit && side.share(t) > 0.85) t++;
    if (t > 0 && t < limit && side.share(t) < 0.5) for (let i = 0; i < t; i++) side.clear(i);
  }
}

// Grows marked areas by radius pixels (a square), in a horizontal pass then a vertical one.
function dilate(mask, width, height, radius) {
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let on = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius) && !on; k++) on = mask[row + k];
      tmp[row + x] = on;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let on = 0;
      for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius) && !on; k++) on = tmp[k * width + x];
      out[y * width + x] = on;
    }
  }
  return out;
}

// Corner rounding: walk diagonally in from a box corner until we meet ink. For a rounded
// corner of radius r that walk is about r(1 - 1/√2) steps long, so r ≈ steps × 3.41.
function cornerRadius(mask, width, box) {
  const corners = [
    [box.x, box.y, 1, 1],
    [box.x + box.w - 1, box.y, -1, 1],
    [box.x, box.y + box.h - 1, 1, -1],
    [box.x + box.w - 1, box.y + box.h - 1, -1, -1],
  ];
  const steps = corners.map(([x, y, dx, dy]) => {
    let k = 0;
    while (k < Math.min(box.w, box.h) / 2 && !mask[(y + k * dy) * width + (x + k * dx)]) k++;
    return k;
  });
  const k = steps.sort((a, b) => a - b)[1]; // second-smallest: one odd corner can't inflate it
  return k <= 1 ? 0 : Math.min(Math.round(k * 3.41), Math.floor(Math.min(box.w, box.h) / 2));
}

// Connected groups of marked pixels. Returns each group's box and pixel count, plus the
// label of every pixel. `measure` is the mask whose pixels count toward the boxes (the
// grouping can run on a grown copy while the boxes stay tight to the real ink).
function components(mask, width, height, measure = mask) {
  const label = new Int32Array(width * height).fill(-1);
  const stack = new Int32Array(width * height);
  const parts = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start] !== -1) continue;
    const id = parts.length;
    let minX = width, minY = height, maxX = -1, maxY = -1, count = 0, top = 0;
    stack[top++] = start;
    label[start] = id;
    while (top) {
      const p = stack[--top];
      const x = p % width, y = (p - x) / width;
      if (measure[p]) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (x > 0 && mask[p - 1] && label[p - 1] === -1) { label[p - 1] = id; stack[top++] = p - 1; }
      if (x < width - 1 && mask[p + 1] && label[p + 1] === -1) { label[p + 1] = id; stack[top++] = p + 1; }
      if (y > 0 && mask[p - width] && label[p - width] === -1) { label[p - width] = id; stack[top++] = p - width; }
      if (y < height - 1 && mask[p + width] && label[p + width] === -1) { label[p + width] = id; stack[top++] = p + width; }
    }
    parts.push(maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, ink: count });
  }
  return { parts, label };
}

const within = (inner, outer) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

export function findRegions(image, { minAreaShare = 0.004 } = {}) {
  const { width, height } = image;
  const ink = inkMask(image);
  shaveFrame(ink, width, height);
  const minArea = minAreaShare * width * height;
  const big = (r) => r && r.w * r.h >= minArea;
  // A picture is sizeable in both directions; a word or a line of text is short.
  const pictureLike = (r) => big(r) && Math.min(r.w, r.h) >= 0.08 * Math.min(width, height);

  // Pictures, banners and boxed drawings: found exactly as drawn, with no gap-bridging,
  // so two pictures only merge if they really touch.
  const { parts, label } = components(ink, width, height);
  const pictures = parts.filter(pictureLike);

  // Everything else (letters, words, dots, dashes) is grouped into lines and blocks of text.
  // Only these small bits are bridged, so a line of text can't swallow a picture.
  const bits = new Uint8Array(ink.length);
  for (let p = 0; p < ink.length; p++) if (ink[p] && !pictureLike(parts[label[p]])) bits[p] = 1;
  const bridge = Math.max(1, Math.round(Math.max(width, height) / 130));
  const text = components(dilate(bits, width, height, bridge), width, height, bits)
    .parts.filter(big)
    .filter((t) => !pictures.some((pic) => within(t, pic))); // marks drawn inside a picture belong to it

  const done = (kind) => ({ ink: count, ...r }) => ({
    ...r,
    kind,
    fill: count / (r.w * r.h),
    radius: kind === 'picture' ? cornerRadius(ink, width, r) : 0, // text copies stay square
  });
  return [...pictures.map(done('picture')), ...text.map(done('text'))];
}

// Precise photo crops refine automatic selection, rather than disabling the rest
// of a teaching card. Remove automatic fragments/frames that cross a known photo,
// keep the title, instructions, diagram and sound text, then use the exact crop.
// This is for tutor selection only: student permissions still come from the
// server's predefined regions and explicit offers.
export function mergePictureRegions(automatic = [], precise = []) {
  const valid = (r) => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0;
  const photos = precise.filter(valid).map((r) => ({ ...r, kind: 'picture' }));
  const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  return [...automatic.filter(valid).filter((region) => !photos.some((photo) => intersects(region, photo))), ...photos];
}

// The region under a tap: the smallest box containing the point.
export function regionAt(regions, x, y) {
  let best = null;
  for (const r of regions) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h && (!best || r.w * r.h < best.w * best.h)) best = r;
  }
  return best;
}
