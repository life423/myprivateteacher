// The two shared hands, right and left: one cartoon glove, the left a mirror of the right, both
// the same colour. The fingertip sits exactly on (x, y). While someone holds a hand, a soft
// glow in their colour (the tutor blue, the student violet) shows who has it.
const GLOVE = { glove: '#dbeafe', line: '#1e3a8a', cuff: '#2563eb' };
export const HOLD_GLOW = { tutor: '#3b82f6', student: '#8b5cf6' };
// The glove's picture around its fingertip, shadow included, for each side.
export const GLOVE_BOX = { r: { left: -50, width: 106, height: 152 }, l: { left: -56, width: 106, height: 152 } };

const SMOOTH = 'motion-safe:transition-transform motion-safe:duration-75 motion-safe:ease-linear';

function HandShape({ shadow = false }) {
  const glove = shadow ? '#000000' : GLOVE.glove;
  const cuff = shadow ? '#000000' : GLOVE.cuff;
  return (
    <g stroke={shadow ? 'none' : GLOVE.line} strokeWidth='5' strokeLinejoin='round' strokeLinecap='round'>
      <rect x='-13' y='0' width='26' height='74' rx='13' fill={glove} />
      <rect x='-46' y='64' width='32' height='24' rx='12' fill={glove} transform='rotate(-28 -30 76)' />
      <rect x='-30' y='54' width='74' height='68' rx='24' fill={glove} />
      {!shadow && <path d='M 2 74 Q 14 69 26 74 M 2 90 Q 15 85 28 90 M 4 106 Q 15 101 26 106' fill='none' />}
      <rect x='-34' y='116' width='82' height='26' rx='10' fill={cuff} />
    </g>
  );
}

export default function Hand({ x, y, side = 'r', holder = null, smooth = false }) {
  const flip = side === 'l' ? 'scale(-1 1)' : undefined;
  return (
    <g
      data-hand={side}
      data-holder={holder || undefined}
      pointerEvents='none'
      className={smooth ? SMOOTH : ''}
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      {holder && <ellipse cx={side === 'l' ? -2 : 2} cy='70' rx='74' ry='92' fill={HOLD_GLOW[holder] || HOLD_GLOW.tutor} opacity='0.26' />}
      {/* The shadow falls down and to the right for both hands, as from one light. */}
      <g transform='translate(7 9)' opacity='0.18'>
        <g transform={flip}>
          <HandShape shadow />
        </g>
      </g>
      <g transform={flip}>
        <HandShape />
      </g>
    </g>
  );
}

// A small glove, for buttons.
export function GloveIcon({ side = 'r', className = '' }) {
  const box = GLOVE_BOX[side];
  return (
    <svg viewBox={`${box.left} 0 ${box.width} ${box.height}`} className={className} aria-hidden='true'>
      <Hand x={0} y={0} side={side} />
    </svg>
  );
}
