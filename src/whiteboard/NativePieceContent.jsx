import { cleanPieceContent, nativePieceMetrics } from '../../shared/pieces.js';

// Native teaching ink has no photograph, paper, frame or shadow. The same
// inherited font, size, weight and ink color are used by the board's letter tiles.
export default function NativePieceContent({ content: value, x = 0, y = 0, width, height }) {
  const content = cleanPieceContent(value);
  const metrics = nativePieceMetrics(content);
  if (!metrics) return null;
  return <svg data-native-piece={content.kind} x={x} y={y} width={width ?? metrics.w} height={height ?? metrics.h} viewBox={`0 0 ${metrics.w} ${metrics.h}`} preserveAspectRatio='none' overflow='visible' aria-hidden='true'>
    {content.kind === 'breve'
      ? <path d='M8 6 Q32 32 56 6' fill='none' stroke='#1e293b' strokeWidth='7' strokeLinecap='round' />
      : <text x='8' y='72' fill='#1e293b' style={{ fontSize: 64, fontWeight: 700 }}>{content.text}</text>}
  </svg>;
}
