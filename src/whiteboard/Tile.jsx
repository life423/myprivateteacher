import { TILE_HEIGHT, tileWidth } from '../../shared/tiles.js';

// Default colour groups. Each tile stores its kind, so a tutor's own scheme can replace these later.
export const TILE_COLORS = {
  vowel: { fill: '#fde68a', edge: '#d97706' },
  consonant: { fill: '#ffffff', edge: '#94a3b8' },
  team: { fill: '#bfdbfe', edge: '#3b82f6' },
};
const HOLDER = { tutor: '#2563eb', student: '#7c3aed' };
const SMOOTH = 'motion-safe:transition-transform motion-safe:duration-100 motion-safe:ease-out';

// A letter tile. While someone holds it, it lifts and takes their colour on its edge.
export default function Tile({ tile, mine, selected = false, removable = false }) {
  const width = tileWidth(tile.text);
  const colors = TILE_COLORS[tile.kind] || TILE_COLORS.consonant;
  const lifted = Boolean(tile.heldBy);
  const draggingHere = tile.heldBy === mine;
  let edge = colors.edge;
  if (lifted) edge = HOLDER[tile.heldBy];
  if (selected) edge = '#7c3aed';
  return (
    <g
      data-letter-tile={tile.id}
      pointerEvents='none'
      className={draggingHere ? '' : SMOOTH}
      style={{ transform: `translate(${tile.x}px, ${tile.y}px)` }}
    >
      <rect x={lifted ? 6 : 3} y={lifted ? 10 : 5} width={width} height={TILE_HEIGHT} rx='18' fill='#0f172a' opacity={lifted ? 0.22 : 0.12} />
      <rect width={width} height={TILE_HEIGHT} rx='18' fill={colors.fill} stroke={edge} strokeWidth={lifted || selected ? 6 : 3} />
      <text
        x={width / 2}
        y={TILE_HEIGHT / 2 + 2}
        textAnchor='middle'
        dominantBaseline='central'
        fill='#1e293b'
        style={{ fontSize: 64, fontWeight: 700 }}
      >
        {tile.text}
      </text>
      {removable && (
        <g transform={`translate(${width} 0)`}>
          <circle r='20' fill='#ffffff' stroke='#94a3b8' strokeWidth='3' />
          <path d='M -7 -7 L 7 7 M 7 -7 L -7 7' stroke='#475569' strokeWidth='4' strokeLinecap='round' />
        </g>
      )}
    </g>
  );
}
