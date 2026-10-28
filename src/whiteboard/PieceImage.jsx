// One picture piece on the board: a window onto its picture, rounded like the original.
// Nothing is cropped or copied; the browser just shows that part of the picture.
export default function PieceImage({ piece, pic, src, overlap }) {
  if (!pic) return null;
  const { crop } = piece;
  const clip = `piece-clip-${piece.id}`;
  const corner = ((crop.r || 0) * piece.w) / crop.w;
  const overlaps = Boolean(overlap?.above.length || overlap?.below.length);
  return (
    <g data-picture-piece={piece.id} data-overlap={overlaps ? 'true' : 'false'} style={{ filter: 'drop-shadow(0 2px 2px rgb(15 23 42 / 0.16))' }}>
      <svg
        x={piece.x}
        y={piece.y}
        width={piece.w}
        height={piece.h}
        viewBox={`${crop.x} ${crop.y} ${crop.w} ${crop.h}`}
        preserveAspectRatio='none'
        overflow='hidden'
      >
        <defs>
          <clipPath id={clip}>
            <rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} rx={crop.r} />
          </clipPath>
        </defs>
        <image href={src} width={pic.w} height={pic.h} clipPath={`url(#${clip})`} preserveAspectRatio='none' />
      </svg>
      <rect x={piece.x} y={piece.y} width={piece.w} height={piece.h} rx={corner} fill='none' stroke={overlaps ? '#b45309' : '#cbd5e1'} strokeWidth={overlaps ? '2' : '1'} vectorEffect='non-scaling-stroke' />
    </g>
  );
}
