import { useId } from 'react';
import { FRONT_PHOTO_STAND_INS, cardSoundLine } from '../data/articulationCards.js';
import { BANNER, CARD, COLUMN, DIAGRAM, FONT, INSTRUCTION, MOUTH_REGION, PALETTE, PHOTO, SOUND, fitText, titleSize } from './cardLayout.js';

// One complete articulation card, drawn from data: title banner, the large mouth photo (or a
// placeholder until a photo is added), the instruction, the side-view diagram, and the sounds.
// It is a single 1200 x 1200 SVG, so it can be shown at any size or saved as a picture.

const DIAGRAMS = import.meta.glob('../assets/articulation/*.svg', { eager: true, query: '?url', import: 'default' });
const PHOTOS = import.meta.glob('../assets/articulation/photos/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' });

export const diagramFor = (id) => DIAGRAMS[`../assets/articulation/${id}.svg`] || null;
// The photo file for a photo key: src/assets/articulation/photos/<key>.webp (or .jpg, .png).
function fileFor(key) {
  const path = key && Object.keys(PHOTOS).find((file) => file.split('/').pop().split('.')[0] === key);
  return path ? PHOTOS[path] : null;
}

// The front-mouth photo for a card's frontPhotoKey: its own photo, or the closest group's photo
// if it has a stand-in, or null (the card shows its placeholder). Several cards can share one.
export const photoFor = (key) => fileFor(key) || fileFor(FRONT_PHOTO_STAND_INS[key]);

// 'photo' (its own), 'stand-in' (the closest group's) or 'missing'.
export function photoStatus(key) {
  if (fileFor(key)) return 'photo';
  return fileFor(FRONT_PHOTO_STAND_INS[key]) ? 'stand-in' : 'missing';
}

const centreX = COLUMN.x + COLUMN.width / 2;

// Lines of text centred in an area of the right column.
function TextBlock({ text, area, fit, part }) {
  const { size, lines } = fit || fitText(text, { height: area.height });
  const step = size * 1.2;
  const first = area.y + area.height / 2 - ((lines.length - 1) * step) / 2 + size * 0.35;
  return (
    <text data-card-part={part} x={centreX} y={first} textAnchor='middle' fontFamily={FONT} fontSize={size} fontWeight='700' fill={PALETTE.ink}>
      {lines.map((line, i) => (
        <tspan key={i} x={centreX} dy={i === 0 ? 0 : step}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

// Until a real photo is added: a calm front view of lips in the photo's exact place.
function MouthPlaceholder({ id }) {
  const { x, y, w, h } = MOUTH_REGION;
  const cx = x + w / 2;
  const cy = y + h * 0.54;
  return (
    <g>
      <defs>
        <radialGradient id={`skin-${id}`} cx='50%' cy='48%' r='70%'>
          <stop offset='0%' stopColor='#F9DCC7' />
          <stop offset='100%' stopColor='#EBB894' />
        </radialGradient>
      </defs>
      <rect x={x} y={y} width={w} height={h} fill={`url(#skin-${id})`} />
      <g transform={`translate(${cx} ${cy})`}>
        <path d='M -220 0 C -160 -44 -96 -82 -44 -74 C -22 -70 -9 -58 0 -58 C 9 -58 22 -70 44 -74 C 96 -82 160 -44 220 0 C 120 16 -120 16 -220 0 Z' fill='#D97F7E' />
        <path d='M -220 0 C -120 16 120 16 220 0 C 168 74 84 116 0 118 C -84 116 -168 74 -220 0 Z' fill='#EA9894' />
        <path d='M -206 2 C -112 20 112 20 206 2' fill='none' stroke='#A85858' strokeWidth='8' strokeLinecap='round' />
        <path d='M -70 48 C -30 60 30 60 70 48' fill='none' stroke='#F6B9B3' strokeWidth='12' strokeLinecap='round' />
      </g>
      <path d={`M ${cx - 90} ${y + h - 120} C ${cx - 40} ${y + h - 96} ${cx + 40} ${y + h - 96} ${cx + 90} ${y + h - 120}`} fill='none' stroke='#D99C78' strokeWidth='10' strokeLinecap='round' />
      <rect x={cx - 170} y={y + h - 76} width='340' height='52' rx='26' fill='#FFFFFF' fillOpacity='0.85' />
      <text x={cx} y={y + h - 41} textAnchor='middle' fontFamily={FONT} fontSize='28' fontWeight='700' fill='#64748B'>
        Photo coming soon
      </text>
    </g>
  );
}

// Both the original families and the new teaching cards use this exact frame.
// A card has one full-height mouth photograph and one anatomy diagram; movement
// cues belong in the instruction and diagram rather than additional photo panels.
export function ArticulationCardFrame({
  title, instruction, soundText, photo, diagram, instructionFit, soundFit,
  className = '', svgProps = {},
}) {
  const uid = useId().replace(/:/g, '');
  const size = titleSize(title);
  const m = MOUTH_REGION;
  return (
    <svg
      viewBox={`0 0 ${CARD.width} ${CARD.height}`}
      className={className}
      role='img'
      aria-label={`${title}: ${instruction} ${soundText}`}
      {...svgProps}
    >
      <defs>
        <clipPath id={`photo-${uid}`}>
          <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={m.r} />
        </clipPath>
        <clipPath id={`diagram-${uid}`}>
          <rect x={DIAGRAM.x} y={DIAGRAM.y} width={DIAGRAM.size} height={DIAGRAM.size} rx={DIAGRAM.radius} />
        </clipPath>
      </defs>
      <rect x='2' y='2' width={CARD.width - 4} height={CARD.height - 4} rx={CARD.radius} fill={PALETTE.paper} stroke={PALETTE.edge} strokeWidth='4' />

      <rect data-card-part='banner' x={BANNER.x} y={BANNER.y} width={BANNER.width} height={BANNER.height} rx={BANNER.radius} fill={PALETTE.banner} />
      <text data-card-part='title' x={BANNER.x + BANNER.width / 2} y={BANNER.y + BANNER.height / 2 + size * 0.36} textAnchor='middle' fontFamily={FONT} fontSize={size} fontWeight='800' fill={PALETTE.ink}>
        {title}
      </text>

      <rect x={PHOTO.x} y={PHOTO.y} width={PHOTO.width} height={PHOTO.height} rx={PHOTO.radius} fill={PALETTE.photoBorder} />
      <g clipPath={`url(#photo-${uid})`}>
        {photo ? (
          <image data-card-part='photo' href={photo} x={m.x} y={m.y} width={m.w} height={m.h} preserveAspectRatio='xMidYMid slice' />
        ) : (
          <MouthPlaceholder id={uid} />
        )}
      </g>

      <TextBlock text={instruction} area={INSTRUCTION} fit={instructionFit} part='instruction' />

      <rect x={DIAGRAM.x} y={DIAGRAM.y} width={DIAGRAM.size} height={DIAGRAM.size} rx={DIAGRAM.radius} fill={PALETTE.paper} />
      {diagram && (
        <image data-card-part='diagram' href={diagram} x={DIAGRAM.x} y={DIAGRAM.y} width={DIAGRAM.size} height={DIAGRAM.size} clipPath={`url(#diagram-${uid})`} />
      )}
      <rect x={DIAGRAM.x} y={DIAGRAM.y} width={DIAGRAM.size} height={DIAGRAM.size} rx={DIAGRAM.radius} fill='none' stroke={PALETTE.ink} strokeWidth={DIAGRAM.border} />

      <TextBlock text={soundText} area={SOUND} fit={soundFit} part='sound' />
    </svg>
  );
}

export default function ArticulationCard({ card, className = '' }) {
  return <ArticulationCardFrame
    title={card.title}
    instruction={card.instruction}
    soundText={cardSoundLine(card)}
    photo={photoFor(card.frontPhotoKey)}
    diagram={diagramFor(card.id)}
    className={className}
    svgProps={{ 'data-card': card.id }}
  />;
}
