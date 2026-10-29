// The two shared hands, right and left: one cartoon glove, the left a mirror of the right, both
// the same colour. The pointing fingertip sits exactly on (x, y). While someone holds a hand, a soft
// glow in their colour (the tutor blue, the student violet) shows who has it.
const GLOVE = { glove: '#dbeafe', line: '#1e3a8a', cuff: '#2563eb' };
export const HOLD_GLOW = { tutor: '#3b82f6', student: '#8b5cf6' };
// The glove's picture around its fingertip, shadow included, for each side.
export const GLOVE_BOX = { r: { left: -50, width: 106, height: 152 }, l: { left: -56, width: 106, height: 152 } };

const SMOOTH = 'motion-safe:transition-transform motion-safe:duration-75 motion-safe:ease-linear';

function HandShape({ shadow = false, pose = 'point' }) {
  const glove = shadow ? '#000000' : GLOVE.glove;
  const cuff = shadow ? '#000000' : GLOVE.cuff;
  if (pose === 'grab') {
    return (
      <g stroke={shadow ? 'none' : GLOVE.line} strokeWidth='5' strokeLinejoin='round' strokeLinecap='round'>
        {/* Curled fingers and a tucked thumb: the pointer closes when it picks up a letter. */}
        <path d='M -35 86 V 67 C -35 58 -29 52 -22 52 C -16 52 -12 55 -11 60 V 56 C -11 48 -5 44 2 44 C 10 44 15 49 15 57 V 58 C 16 50 23 48 29 51 C 36 53 39 59 38 66 C 43 59 52 65 51 74 L 48 96 C 46 113 34 124 16 124 H -10 C -27 124 -37 113 -38 98 Z' fill={glove} />
        {!shadow && <path d='M -11 61 V 72 Q -11 79 -4 79 M 15 59 V 72 Q 15 80 22 80 M 38 67 V 77' fill='none' />}
        <path d='M -35 77 C -28 73 -20 76 -16 83 L -6 86 H 7 C 18 86 22 97 15 103 C 12 106 7 107 1 106 L -23 103 C -32 101 -42 96 -43 87 C -44 82 -41 79 -35 77 Z' fill={glove} />
        <rect x='-34' y='116' width='82' height='26' rx='10' fill={cuff} />
      </g>
    );
  }
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

export default function Hand({ x, y, side = 'r', holder = null, smooth = false, pose = 'point' }) {
  const flip = side === 'l' ? 'scale(-1 1)' : undefined;
  return (
    <g
      data-hand={side}
      data-hand-pose={pose === 'grab' ? 'grab' : 'point'}
      data-holder={holder || undefined}
      pointerEvents='none'
      className={smooth ? SMOOTH : ''}
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      {holder && <ellipse cx={side === 'l' ? -2 : 2} cy='70' rx='74' ry='92' fill={HOLD_GLOW[holder] || HOLD_GLOW.tutor} opacity='0.26' />}
      {/* The shadow falls down and to the right for both hands, as from one light. */}
      <g transform='translate(7 9)' opacity='0.18'>
        <g transform={flip}>
          <HandShape shadow pose={pose} />
        </g>
      </g>
      <g transform={flip}>
        <HandShape pose={pose} />
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
