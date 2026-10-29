// Letter tiles and sound (Elkonin) boxes, shared by the browser and the server so
// both place and snap tiles identically. Everything is in the whiteboard's fixed
// 1600 x 1000 stage coordinates.

export const MAX_TILES = 60;
export const MAX_TILE_LETTERS = 4;
export const TILE_HEIGHT = 112;
export const TILE_GAP = 16;
export const BOX_COUNTS = [0, 2, 3, 4, 5]; // 0 means the boxes are off

// Tiles can sit anywhere on the working area: the board, plus the strip's space.
export const WORK = { left: 24, top: 24, right: 1576, bottom: 976 };
const TRAY = { left: 48, right: 1552, bottom: WORK.bottom - 16, rows: 6 };
// The boxes sit in the middle of the board (y 184 to 976), so there's as much room above them,
// for marking each sound with a symbol, as below them for writing the word.
const BOARD_MIDDLE = (184 + 976) / 2;
const BOX = { width: 200, height: 150, gap: 24, top: BOARD_MIDDLE - 150 / 2, snapMargin: 30 };

const round1 = (n) => Math.round(n * 10) / 10;

export const tileWidth = (text) => 84 + 40 * (Math.max(1, String(text).length) - 1);

// Default colour groups. Each tile stores its kind, so a tutor's own scheme can override it later.
export function tileKind(text) {
  if (text.length > 1) return 'team';
  return 'aeiouAEIOU'.includes(text) ? 'vowel' : 'consonant';
}

// Letters (and _ for split digraphs such as a_e), 1 to 4 characters, at least one letter.
export function cleanTileText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length < 1 || text.length > MAX_TILE_LETTERS) return null;
  const chars = [...text];
  const allowed = chars.every((c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_');
  return allowed && chars.some((c) => c !== '_') ? text : null;
}

// A tile's home on the tray: rows along the bottom of the board, filling left to right, then upward.
export function nextHome(placed, text) {
  const width = tileWidth(text);
  let y = TRAY.bottom - TILE_HEIGHT;
  for (let row = 0; row < TRAY.rows; row += 1) {
    let x = TRAY.left;
    for (const t of placed) if (t.hy === y) x = Math.max(x, t.hx + tileWidth(t.text) + TILE_GAP);
    if (x + width <= TRAY.right) return { hx: x, hy: y };
    y -= TILE_HEIGHT + TILE_GAP;
  }
  return { hx: TRAY.left, hy: TRAY.bottom - TILE_HEIGHT };
}

export function clampTile(text, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: round1(Math.min(WORK.right - tileWidth(text), Math.max(WORK.left, x))),
    y: round1(Math.min(WORK.bottom - TILE_HEIGHT, Math.max(WORK.top, y))),
  };
}

// The sound boxes: a centred row in the middle of the board.
export function soundBoxes(count) {
  if (!BOX_COUNTS.includes(count) || count === 0) return [];
  const total = count * BOX.width + (count - 1) * BOX.gap;
  const left = 800 - total / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: left + i * (BOX.width + BOX.gap),
    y: BOX.top,
    width: BOX.width,
    height: BOX.height,
  }));
}

// Where a dropped tile settles: centred in the sound box under its middle, if that box is free.
export function soundBoxTarget(tile, count, tiles) {
  const width = tileWidth(tile.text);
  const cx = tile.x + width / 2;
  const cy = tile.y + TILE_HEIGHT / 2;
  const m = BOX.snapMargin;
  for (const [index, box] of soundBoxes(count).entries()) {
    if (cx < box.x - m || cx > box.x + box.width + m || cy < box.y - m || cy > box.y + box.height + m) continue;
    const bx = box.x + box.width / 2;
    const by = box.y + box.height / 2;
    const taken = tiles.some(
      (t) => t.id !== tile.id && Math.abs(t.x + tileWidth(t.text) / 2 - bx) < 2 && Math.abs(t.y + TILE_HEIGHT / 2 - by) < 2,
    );
    return taken ? null : { index, box, x: round1(bx - width / 2), y: round1(by - TILE_HEIGHT / 2) };
  }
  return null;
}

// Preview and release use the same target, including the server's occupancy rule.
export function snapTile(tile, count, tiles) {
  const target = soundBoxTarget(tile, count, tiles);
  return target ? { x: target.x, y: target.y } : null;
}

// Find a nearby free copy position, including when the original sits at a board edge.
export function duplicateTilePosition(tile, tiles) {
  const width = tileWidth(tile.text);
  const candidates = [];
  const add = (x, y) => { const at = clampTile(tile.text, x, y); if (at) candidates.push(at); };
  for (let row = -7; row <= 7; row += 1) for (let col = -16; col <= 16; col += 1) {
    if (row || col) add(tile.x + col * (width + TILE_GAP), tile.y + row * (TILE_HEIGHT + TILE_GAP));
  }
  candidates.sort((a, b) => Math.hypot(a.x - tile.x, a.y - tile.y) - Math.hypot(b.x - tile.x, b.y - tile.y));
  const free = candidates.find(at => tiles.every(other => at.x >= other.x + tileWidth(other.text) + 4 || at.x + width + 4 <= other.x || at.y >= other.y + TILE_HEIGHT + 4 || at.y + TILE_HEIGHT + 4 <= other.y));
  return free || clampTile(tile.text, tile.x + 24, tile.y + 24);
}
