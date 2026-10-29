import { describe, expect, it } from 'vitest';
import { TILE_HEIGHT, cleanTileText, duplicateTilePosition, nextHome, snapTile, soundBoxTarget, soundBoxes, tileKind, tileWidth } from './tiles.js';

describe('letter tiles', () => {
  it('accepts letters and graphemes up to four characters', () => {
    expect(['a', 'sh', 'igh', 'a_e', 'tion'].map(cleanTileText)).toEqual(['a', 'sh', 'igh', 'a_e', 'tion']);
    expect(['', 'shrek', '1', 'a b', '_', null].map(cleanTileText)).toEqual([null, null, null, null, null, null]);
  });

  it('colours vowels, consonants and letter teams differently by default', () => {
    expect(['a', 'm', 'sh', 'igh', 'y'].map(tileKind)).toEqual(['vowel', 'consonant', 'team', 'team', 'consonant']);
  });

  it('lines tiles up along the tray and starts a new row when one fills', () => {
    const placed = [];
    for (let i = 0; i < 20; i += 1) placed.push({ text: 'm', ...nextHome(placed, 'm') });
    expect(placed[0]).toMatchObject({ hx: 48, hy: 848 });
    expect(placed[1].hx).toBe(48 + tileWidth('m') + 16);
    const rows = new Set(placed.map((t) => t.hy));
    expect([...rows].sort()).toEqual([848 - TILE_HEIGHT - 16, 848]);
  });
});

describe('sound boxes', () => {
  it('snaps a dropped tile into a free box, and leaves it be when the box is taken', () => {
    const [first] = soundBoxes(3);
    const near = { id: 'a', text: 'sh', x: first.x + 20, y: first.y + 30 };
    const snapped = snapTile(near, 3, [near]);
    expect(snapped.x + tileWidth('sh') / 2).toBe(first.x + first.width / 2);
    expect(snapped.y + TILE_HEIGHT / 2).toBe(first.y + first.height / 2);

    const sitting = { id: 'b', text: 'i', ...snapTile({ id: 'b', text: 'i', x: first.x, y: first.y }, 3, []) };
    expect(snapTile(near, 3, [near, sitting])).toBeNull();
    expect(snapTile({ id: 'c', text: 'p', x: 800, y: 800 }, 3, [])).toBeNull();
    expect(soundBoxes(0)).toEqual([]);
  });
});

it('uses the same free target for the drag preview and authoritative snap', () => {
  const box = soundBoxes(3)[1];
  const tile = { id: 'moving', text: 'sh', x: box.x, y: box.y };
  expect(soundBoxTarget(tile, 3, [tile])).toMatchObject({ index: 1, ...snapTile(tile, 3, [tile]) });
  const occupied = { id: 'other', text: 't', ...snapTile({ ...tile, text: 't' }, 3, []) };
  expect(soundBoxTarget(tile, 3, [occupied])).toBeNull();
});
it('duplicates near an edge without overlapping existing tiles when space is available', () => {
  const tile = { id: 'a', text: 'tion', x: 1372, y: 864 };
  const copy = duplicateTilePosition(tile, [tile]);
  expect(copy.x).toBeGreaterThanOrEqual(24);
  expect(copy.y).toBeGreaterThanOrEqual(24);
  expect(copy.x + tileWidth(tile.text)).toBeLessThanOrEqual(1576);
  expect(copy.y + TILE_HEIGHT).toBeLessThanOrEqual(976);
  expect(copy.x + tileWidth(tile.text) <= tile.x || copy.x >= tile.x + tileWidth(tile.text) || copy.y + TILE_HEIGHT <= tile.y || copy.y >= tile.y + TILE_HEIGHT).toBe(true);
});
