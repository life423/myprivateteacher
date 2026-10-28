import { useId } from 'react';
import { photoFor } from './ArticulationCard.jsx';
import { BANNER, CARD, COLUMN, DIAGRAM, FONT, INSTRUCTION, PALETTE, PHOTO, titleSize } from './cardLayout.js';
import { FEATURE_HEIGHT, FEATURE_TOP, PHONEME_SOUND_AREA, phonemeExampleFit, phonemeFeatureLines, phonemeInstructionFit, phonemeMouthRegions } from './phonemeCardLayout.js';
import { phonemeDiagramUrl } from './phonemeDiagrams.js';

const centreX = COLUMN.x + COLUMN.width / 2;
function TextLines({ lines, size, x = centreX, y, height, weight = 700 }) {
  const step = size * 1.2;
  const first = y + height / 2 - ((lines.length - 1) * step) / 2 + size * 0.35;
  return <text x={x} y={first} textAnchor='middle' fontFamily={FONT} fontSize={size} fontWeight={weight} fill={PALETTE.ink}>{lines.map((line, i) => <tspan key={i} x={x} dy={i ? step : 0}>{line}</tspan>)}</text>;
}

// One original sound-specific card. Outer geometry, colors and typography match
// the existing family cards. Moving sounds expose a genuine start and end view.
export default function PhonemeArticulationCard({ card, className = '' }) {
  const uid = useId().replace(/:/g, '');
  const regions = phonemeMouthRegions(card);
  const keys = [card.photoKey, card.endPhotoKey];
  const instruction = phonemeInstructionFit(card);
  const example = phonemeExampleFit(card);
  const features = phonemeFeatureLines(card);
  const kind = card.kind === 'sequence' ? 'Sound sequence' : card.kind === 'dialect' ? 'Dialect sound' : card.dialectDependent ? 'Accent varies' : card.category === 'vowel' ? 'Vowel sound' : 'Consonant sound';
  return (
    <svg viewBox={`0 0 ${CARD.width} ${CARD.height}`} role='img' aria-label={`${card.title}, ${card.keyword}. ${card.instruction}`} data-phoneme-card={card.id} data-missing-photo={keys.filter((key, i) => i < regions.length && !photoFor(key)).join(',')} data-missing-diagram={[!phonemeDiagramUrl(card) && card.poseKey, card.movement && !phonemeDiagramUrl(card, 'end') && card.endPoseKey].filter(Boolean).join(',')} className={className}>
      <defs>
        {regions.map((r, i) => <clipPath key={r.id} id={`photo-${uid}-${i}`}><rect x={r.x} y={r.y} width={r.w} height={r.h} rx={r.r} /></clipPath>)}
        <clipPath id={`diagram-${uid}`}><rect x={DIAGRAM.x} y={DIAGRAM.y} width={DIAGRAM.size} height={DIAGRAM.size} rx={DIAGRAM.radius} /></clipPath>
      </defs>
      <rect x='2' y='2' width={CARD.width - 4} height={CARD.height - 4} rx={CARD.radius} fill={PALETTE.paper} stroke={PALETTE.edge} strokeWidth='4' />
      <rect x={BANNER.x} y={BANNER.y} width={BANNER.width} height={BANNER.height} rx={BANNER.radius} fill={PALETTE.banner} />
      <text x={600} y={BANNER.y + BANNER.height / 2 + titleSize(card.title) * 0.36} textAnchor='middle' fontFamily={FONT} fontSize={titleSize(card.title)} fontWeight='800' fill={PALETTE.ink}>{card.title}</text>
      <rect x={PHOTO.x} y={PHOTO.y} width={PHOTO.width} height={PHOTO.height} rx={PHOTO.radius} fill={PALETTE.photoBorder} />
      {regions.map((r, i) => {
        const src = photoFor(keys[i]);
        return <g key={r.id}>
          {src ? <image href={src} x={r.x} y={r.y} width={r.w} height={r.h} clipPath={`url(#photo-${uid}-${i})`} preserveAspectRatio='xMidYMid slice' /> : <g><rect x={r.x} y={r.y} width={r.w} height={r.h} rx={r.r} fill='#FFF1F2' /><text x={r.x + r.w / 2} y={r.y + r.h / 2} textAnchor='middle' fontFamily={FONT} fontSize='34' fontWeight='700' fill='#BE123C'>Missing photo: {keys[i]}</text></g>}
          {card.movement && <g><rect x={r.x + 18} y={r.y + 16} width='138' height='55' rx='22' fill='white' fillOpacity='.96' /><text x={r.x + 87} y={r.y + 54} textAnchor='middle' fontFamily={FONT} fontSize='32' fontWeight='700' fill={PALETTE.ink}>{i ? 'End' : 'Start'}</text></g>}
        </g>;
      })}
      {card.movement && <path d='M 420 706 L 420 742 M 406 728 L 420 742 L 434 728' fill='none' stroke={PALETTE.ink} strokeWidth='7' strokeLinecap='round' strokeLinejoin='round' />}
      <TextLines {...instruction} y={INSTRUCTION.y} height={INSTRUCTION.height} />
      <rect x={DIAGRAM.x} y={DIAGRAM.y} width={DIAGRAM.size} height={DIAGRAM.size} rx={DIAGRAM.radius} fill='white' />
      {card.movement ? <g clipPath={`url(#diagram-${uid})`}>
        <image href={phonemeDiagramUrl(card)} x={DIAGRAM.x} y={DIAGRAM.y + 30} width='150' height='236' preserveAspectRatio='xMidYMid meet' />
        <image href={phonemeDiagramUrl(card, 'end')} x={DIAGRAM.x + 170} y={DIAGRAM.y + 30} width='150' height='236' preserveAspectRatio='xMidYMid meet' />
        <text x={DIAGRAM.x + 75} y={DIAGRAM.y + 299} fontFamily={FONT} fontSize='24' textAnchor='middle' fill={PALETTE.ink}>Start</text>
        <text x={DIAGRAM.x + 245} y={DIAGRAM.y + 299} fontFamily={FONT} fontSize='24' textAnchor='middle' fill={PALETTE.ink}>End</text>
        <path d={`M ${DIAGRAM.x + 145} ${DIAGRAM.y + 147} H ${DIAGRAM.x + 175} M ${DIAGRAM.x + 164} ${DIAGRAM.y + 136} L ${DIAGRAM.x + 175} ${DIAGRAM.y + 147} L ${DIAGRAM.x + 164} ${DIAGRAM.y + 158}`} fill='none' stroke={PALETTE.ink} strokeWidth='4' strokeLinecap='round' strokeLinejoin='round' />
      </g> : <image href={phonemeDiagramUrl(card)} x={DIAGRAM.x} y={DIAGRAM.y} width={DIAGRAM.size} height={DIAGRAM.size} clipPath={`url(#diagram-${uid})`} />}
      <rect x={DIAGRAM.x} y={DIAGRAM.y} width={DIAGRAM.size} height={DIAGRAM.size} rx={DIAGRAM.radius} fill='none' stroke={PALETTE.ink} strokeWidth={DIAGRAM.border} />
      <TextLines {...example} y={PHONEME_SOUND_AREA.y} height={PHONEME_SOUND_AREA.height} />
      {features.map((text, i) => <g key={text}><rect x={COLUMN.x + 5} y={FEATURE_TOP + i * 58} width={COLUMN.width - 10} height={FEATURE_HEIGHT} rx='20' fill={i === 0 && card.voiced ? '#EDE9FE' : '#F1F5F9'} /><text x={centreX} y={FEATURE_TOP + i * 58 + 33} textAnchor='middle' fontFamily={FONT} fontSize='27' fontWeight='700' fill={PALETTE.ink}>{text}</text></g>)}
      <text x={centreX} y='1172' textAnchor='middle' fontFamily={FONT} fontSize='22' fontWeight='700' fill='#475569'>{kind}</text>
    </svg>
  );
}
