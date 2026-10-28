import * as A from '../assets/articulation/anatomy.js';
import { POSES, arrow, curvedArrow } from '../assets/articulation/poses.js';

const existing = Object.fromEntries(POSES.map((pose) => [pose.id, pose]));
const clone = (key, patch = {}) => ({ ...existing[key], ...patch });

// Schematic vowel surfaces vary independently from the shared lips, teeth,
// palate and jaw. Front is left; the throat is right. They model relative
// tongue height/backness, rather than claiming a photographed speaker's MRI.
function vowelPose(id, title, { jaw, front, frontY, backY, round = false, relaxed = false }) {
  const base = existing[round ? 'vowel-rounded-back' : relaxed ? 'vowel-open' : 'vowel-front'];
  const tongue = `M 182 ${frontY + 30} C 196 ${frontY + 12} 218 ${frontY} 246 ${frontY} C 288 ${(frontY + backY) / 2} 334 ${backY} 366 ${backY + 24} C 384 ${backY + 42} 396 ${backY + 60} 402 252 L 410 310 L 190 310 C 182 260 174 ${frontY + 48} 182 ${frontY + 30} Z`;
  const tongueHighlight = `M 212 ${frontY + 16} C 246 ${frontY + 2} 294 ${backY + 8} 338 ${backY + 14}`;
  return { ...base, id, title, jaw, tongue, tongueHighlight, contacts: [], airflow: [] };
}

const newVowels = [
  vowelPose('vowel-open', 'Low back unrounded vowel', { jaw: 8, front: false, frontY: 218, backY: 195, relaxed: true }),
  vowelPose('vowel-low-central', 'Low central unrounded vowel', { jaw: 8, front: true, frontY: 208, backY: 208, relaxed: true }),
  vowelPose('vowel-near-high-front', 'Near-high front vowel', { jaw: 3, front: true, frontY: 139, backY: 166 }),
  vowelPose('vowel-close-mid-front', 'Close-mid front vowel', { jaw: 4, front: true, frontY: 151, backY: 174 }),
  vowelPose('vowel-mid-front', 'Open-mid front vowel', { jaw: 5, front: true, frontY: 171, backY: 185 }),
  vowelPose('vowel-low-front', 'Near-low front vowel', { jaw: 7, front: true, frontY: 194, backY: 206 }),
  vowelPose('vowel-mid-central', 'Central vowel', { jaw: 4, front: true, frontY: 179, backY: 181, relaxed: true }),
  vowelPose('vowel-open-mid-back', 'Open-mid back rounded vowel', { jaw: 6, front: false, frontY: 199, backY: 163, round: true }),
  vowelPose('vowel-mid-back', 'Close-mid back rounded vowel', { jaw: 4, front: false, frontY: 187, backY: 145, round: true }),
  vowelPose('vowel-near-high-back', 'Near-high back rounded vowel', { jaw: 3, front: false, frontY: 178, backY: 136, round: true }),
];

const nasalAir = [curvedArrow([376, 150], [398, 98], [366, 67]), curvedArrow([366, 67], [258, 42], [132, 43]), arrow([132, 43], [92, 43])];
const nasals = [
  clone('bilabial-closed', { id: 'bilabial-nasal', title: 'Bilabial nasal', nasal: true, airflow: nasalAir }),
  clone('alveolar-stop', { id: 'alveolar-nasal', title: 'Alveolar nasal', nasal: true, airflow: nasalAir }),
  clone('velar', { id: 'velar-nasal', title: 'Velar nasal', nasal: true, airflow: nasalAir }),
];

export const PHONEME_POSES = { ...existing, ...Object.fromEntries([...newVowels, ...nasals].map((pose) => [pose.id, pose])) };

const shape = (d, fill, width = A.STROKE.outline) => `<path d='${d}' fill='${fill}' stroke='${A.COLORS.outline}' stroke-width='${width}' stroke-linecap='round' stroke-linejoin='round'/>`;
const line = (d, color = A.COLORS.outline, width = A.STROKE.outline) => `<path d='${d}' fill='none' stroke='${color}' stroke-width='${width}' stroke-linecap='round' stroke-linejoin='round'/>`;
const safe = (text) => String(text).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' })[c]);
const nasalPalate = 'M 336 87 C 350 90 362 102 369 122 C 374 139 377 154 371 164 C 365 169 358 165 358 155 C 360 137 354 118 341 108 L 331 100 Z';
// The open nasal passage is shown above the hard palate on nasal cards, so the
// airflow arrow travels through a visible cavity rather than through solid skin.
const nasalCavity = 'M 410 142 L 381 142 C 394 118 392 96 375 82 C 345 63 267 60 171 61 C 145 61 131 53 130 43 L 132 23 C 144 33 162 34 190 34 C 284 34 362 42 393 61 L 410 73 Z';

export function phonemeDiagramSvg(card, phase = 'start') {
  const key = phase === 'end' ? card.endPoseKey : card.poseKey;
  const pose = PHONEME_POSES[key];
  if (!pose) return null;
  const jaw = pose.jaw ? ` transform='rotate(${-pose.jaw} ${A.JAW_HINGE.x} ${A.JAW_HINGE.y})'` : '';
  // Stops show a closure and a dashed release cue; nasals have their own
  // lowered soft palate and upward nose route instead of an oral release.
  const release = card.airflow === 'stop' && phase === 'start' ? [arrow([96, 155], [56, 155])] : [];
  const oralAir = pose.nasal ? [] : pose.airflow || [];
  const nasal = Boolean(pose.nasal);
  return [
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${A.VIEW_BOX}' width='400' height='400' role='img' aria-label='${safe(card.title)}: ${phase} mouth position'>`,
    `<g transform='${A.FRAMING}'>`,
    `<path d='${A.SKIN}' fill='${A.COLORS.skin}'/>`,
    shape(A.MOUTH, A.COLORS.interior, A.STROKE.detail),
    ...(nasal ? [shape(nasalCavity, A.COLORS.interior, A.STROKE.detail)] : []),
    shape(nasal ? nasalPalate : A.SOFT_PALATE, A.COLORS.skin, A.STROKE.detail),
    `<g id='tongue'>`, shape(pose.tongue, A.COLORS.tongue), line(pose.tongueHighlight, A.COLORS.tongueHighlight, 6), `</g>`,
    `<g id='jaw'${jaw}>`, `<path d='${A.JAW_FILL}' fill='${A.COLORS.skin}'/>`, line(A.FLOOR, A.COLORS.outline, A.STROKE.detail), line(A.CHIN),
    shape(A.LOWER_TOOTH, A.COLORS.teeth, A.STROKE.detail), shape(pose.lowerLip, A.COLORS.tongue), `</g>`,
    shape(A.UPPER_TOOTH, A.COLORS.teeth, A.STROKE.detail), shape(pose.upperLip, A.COLORS.tongue), line(A.PROFILE),
    ...(pose.contacts || []).map(({ x, y, r = 9 }) => `<circle cx='${x}' cy='${y}' r='${r}' fill='${A.COLORS.contact}' fill-opacity='0.35' stroke='${A.COLORS.contact}' stroke-width='3'/>`),
    ...oralAir.map((d) => line(d, A.COLORS.airflow, A.STROKE.airflow)),
    ...(nasal ? [`<g data-airflow='nasal'>${nasalAir.map((d) => line(d, A.COLORS.airflow, A.STROKE.airflow)).join('')}</g>`] : []),
    ...(release.length ? [`<g stroke-dasharray='5 5' data-airflow='release'>${release.map((d) => line(d, A.COLORS.airflow, A.STROKE.airflow)).join('')}</g>`] : []),
    `</g></svg>`,
  ].join('\n');
}

export const phonemeDiagramUrl = (card, phase = 'start') => {
  const svg = phonemeDiagramSvg(card, phase);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
};
