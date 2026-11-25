import { getTeachingMark } from '../../shared/teachingMarks.js';

const ink = '#1e293b';

// The board and each named palette choice share these same clean glyphs.
// All artwork is app-native ink, never a captured worksheet background.
export default function TeachingMarkGlyph({ mark: id, ...props }) {
  const mark = getTeachingMark(id);
  if (!mark) return null;
  const line = { fill: 'none', stroke: ink, strokeWidth: 7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  let glyph;
  switch (mark.id) {
    case 'breve': glyph = <path d='M8 6 Q32 32 56 6' {...line} />; break;
    case 'macron': glyph = <path d='M8 8 H56' {...line} />; break;
    case 'schwa': glyph = <text x='6' y='62' fill={ink} style={{ fontSize: 64, fontWeight: 700 }}>ə</text>; break;
    case 'stress': glyph = <path d='M8 31 L17 8' {...line} strokeWidth='6' />; break;
    case 'cedilla': glyph = <path d='M20 4 L13 13 C29 13 28 30 12 30' {...line} strokeWidth='6' />; break;
    case 'dot': glyph = <circle cx='10' cy='10' r='4.5' fill={ink} />; break;
    case 'circumflex': glyph = <path d='M8 22 L32 6 L56 22' {...line} />; break;
    case 'diaeresis': glyph = <><circle cx='12' cy='10' r='4.5' fill={ink} /><circle cx='36' cy='10' r='4.5' fill={ink} /></>; break;
    case 'silent-letter': glyph = <path d='M8 64 L32 8' {...line} strokeWidth='6' />; break;
    case 'underline': glyph = <path d='M6 8 H90' {...line} strokeWidth='6' />; break;
    case 'syllable-scoop': glyph = <path d='M6 7 Q48 51 90 7' {...line} strokeWidth='6' />; break;
    default: return null;
  }
  return <svg data-teaching-mark={mark.id} width={mark.w} height={mark.h} viewBox={`0 0 ${mark.w} ${mark.h}`} preserveAspectRatio='xMidYMid meet' aria-hidden='true' {...props}>{glyph}</svg>;
}
