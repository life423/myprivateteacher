// The 16 base articulation cards use American English examples and phonics spellings, not
// IPA transcriptions. Some cards group related sounds: their shared photo/diagram is a
// teaching cue, while tongue height, voicing and airflow can differ between those sounds.
// References: https://www.internationalphoneticassociation.org/content/ipa-vowels
// https://pmc.ncbi.nlm.nih.gov/articles/PMC7842851/ (American English /r/ variants and bracing)
// To add a card: add a pose, add a card here, and map its sounds below.

export const ARTICULATION_CARDS = [
  { id: 'bilabial-closed', frontPhotoKey: 'lips-closed', title: 'Lip Popper', name: 'Bilabial', sounds: ['p', 'b', 'm'], instruction: 'Lips close. Pop for /p/ and /b/; hum for /m/.' },
  { id: 'labiodental', frontPhotoKey: 'lip-to-teeth', title: 'Lip Biter', name: 'Labiodental', sounds: ['f', 'v'], instruction: 'Bottom lip touches upper teeth.' },
  { id: 'interdental', frontPhotoKey: 'tongue-between-teeth', title: 'Tongue Peeker', name: 'Interdental', sounds: ['th', 'dh'], instruction: 'Tongue peeks between the teeth.' },
  { id: 'alveolar-stop', frontPhotoKey: 'neutral-open', title: 'Tongue Tapper', name: 'Alveolar', sounds: ['t', 'd', 'n'], instruction: 'Tongue touches the ridge. Pop for /t/ and /d/; hum for /n/.' },
  { id: 'alveolar-fricative', frontPhotoKey: 'teeth-close', title: 'Snake Sound', name: 'Alveolar fricative', sounds: ['s', 'z'], instruction: 'Teeth close. Air hisses over the tongue.' },
  { id: 'lateral-l', frontPhotoKey: 'neutral-open', title: 'Tongue Lifter', name: 'Lateral', sounds: ['l'], instruction: 'Tongue tip lifts to the ridge.' },
  { id: 'postalveolar', frontPhotoKey: 'slightly-rounded', title: 'Quiet Sound', name: 'Postalveolar fricative', sounds: ['sh', 'zh'], instruction: 'Lips round. Air flows over the tongue.' },
  { id: 'postalveolar-affricate', frontPhotoKey: 'slightly-rounded', title: 'Chomper', name: 'Postalveolar affricate', sounds: ['ch', 'j'], instruction: 'Tongue presses up, then air bursts out.' },
  { id: 'velar', frontPhotoKey: 'neutral-open', title: 'Back Tongue Sound', name: 'Velar', sounds: ['k', 'g', 'ng'], instruction: 'Back of the tongue lifts up.' },
  { id: 'glottal-h', frontPhotoKey: 'neutral-open', title: 'Breathy Sound', name: 'Glottal', sounds: ['h'], instruction: 'Mouth open. Air breathes out.' },
  { id: 'rounded-w', frontPhotoKey: 'strongly-rounded', title: 'Lip Rounder', name: 'Rounded back glide', sounds: ['w'], instruction: 'Lips round into a small circle.' },
  { id: 'rhotic-r', frontPhotoKey: 'rhotic', title: 'R Sound', name: 'Rhotic', sounds: ['r'], instruction: 'Tongue pulls back. Sides brace against back teeth.' },
  { id: 'palatal-y', frontPhotoKey: 'neutral-open', title: 'Y Sound', name: 'Palatal glide', sounds: ['y'], instruction: 'Middle of the tongue lifts up.' },
  { id: 'vowel-front', frontPhotoKey: 'smile-vowel', title: 'Smile Vowel', name: 'Front vowel', sounds: ['ee', 'i', 'e'], instruction: 'Tongue stays forward. Open more for /e/ than /ee/.' },
  { id: 'vowel-open', frontPhotoKey: 'open-vowel', title: 'Open Mouth Vowel', name: 'Open vowel', sounds: ['a', 'ah', 'o'], instruction: 'Jaw drops. Lips stay relaxed and unrounded.' },
  { id: 'vowel-rounded-back', frontPhotoKey: 'strongly-rounded', title: 'Round Vowel', name: 'Rounded back vowel', sounds: ['oh', 'oo'], instruction: 'Lips round. Tongue lifts toward the back.' },
];

// The front-mouth photos. Cards whose visible mouth shape is essentially the same share one
// photo: each card names its photo with frontPhotoKey, and the file is
// src/assets/articulation/photos/<key>.webp (or .jpg, .png). Until a file exists, the card
// shows its placeholder.
export const FRONT_PHOTOS = {
  'lips-closed': 'Lips closed',
  'lip-to-teeth': 'Bottom lip to upper teeth',
  'tongue-between-teeth': 'Tongue between the teeth',
  'teeth-close': 'Teeth close together',
  'slightly-rounded': 'Lips slightly rounded',
  'neutral-open': 'Mouth slightly open',
  'strongly-rounded': 'Lips strongly rounded',
  rhotic: 'R mouth',
  'smile-vowel': 'Smile',
  'open-vowel': 'Mouth wide open',
};

// A group without its own photo yet can borrow the closest group's photo instead of showing
// the placeholder. Remove an entry once that group has its own photo.
export const FRONT_PHOTO_STAND_INS = {};

// How each sound is written on a card. Two sounds share the spelling th, so they say which.
export const SOUND_LABELS = { th: '/th/ as in think', dh: '/th/ as in this', j: '/j/ as in jump', y: '/y/ as in yes', a: '/a/ as in cat', o: '/o/ as in hot', oh: '/oh/ as in go' };
export const soundLabel = (sound) => SOUND_LABELS[sound] || `/${sound}/`;

// The line at the bottom of a card: Makes the /f/ and /v/ sounds.
export function cardSoundLine(card) {
  const labels = card.sounds.map(soundLabel);
  const list = labels.length < 3 ? labels.join(' and ') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
  return `Makes the ${list} sound${labels.length > 1 ? 's' : ''}.`;
}

// Every sound: its card, whether the voice is on, whether air goes through the nose, and how to say it.
const sound = (card, voiced, instruction, extra = {}) => ({ card, voiced, instruction, ...extra });
export const articulationPoses = {
  p: sound('bilabial-closed', false, 'Press your lips together, then release the air.'),
  b: sound('bilabial-closed', true, 'Press your lips together, then release the air with your voice on.'),
  m: sound('bilabial-closed', true, 'Close your lips and let the sound come through your nose.', { nasal: true }),
  f: sound('labiodental', false, 'Gently touch your bottom lip to your upper teeth and blow air.'),
  v: sound('labiodental', true, 'Touch your bottom lip to your upper teeth and turn your voice on.'),
  th: sound('interdental', false, 'Put your tongue between your teeth and blow air, as in think.'),
  dh: sound('interdental', true, 'Put your tongue between your teeth and turn your voice on, as in this.'),
  t: sound('alveolar-stop', false, 'Tap your tongue tip behind your top teeth and let the air pop.'),
  d: sound('alveolar-stop', true, 'Tap your tongue tip behind your top teeth with your voice on.'),
  n: sound('alveolar-stop', true, 'Hold your tongue tip behind your top teeth and hum through your nose.', { nasal: true }),
  s: sound('alveolar-fricative', false, 'Keep your teeth close and hiss like a snake.'),
  z: sound('alveolar-fricative', true, 'Keep your teeth close and buzz like a bee.'),
  l: sound('lateral-l', true, 'Lift your tongue tip behind your top teeth and let the sound flow around it.'),
  sh: sound('postalveolar', false, 'Round your lips and push the air out quietly, like shh.'),
  zh: sound('postalveolar', true, 'Round your lips and turn your voice on, as in treasure.'),
  ch: sound('postalveolar-affricate', false, 'Press your tongue up, then let the air burst out, like a sneeze: ch.'),
  j: sound('postalveolar-affricate', true, 'Press your tongue up and burst it out with your voice on, as in jump.'),
  k: sound('velar', false, 'Lift the back of your tongue and let the air pop.'),
  g: sound('velar', true, 'Lift the back of your tongue and pop it with your voice on.'),
  ng: sound('velar', true, 'Lift the back of your tongue and hum through your nose, as in sing.', { nasal: true }),
  h: sound('glottal-h', false, 'Open your mouth and breathe out, like fogging a window.'),
  w: sound('rounded-w', true, 'Round your lips into a small circle, then open them.'),
  r: sound('rhotic-r', true, 'Pull your tongue back. Raise its tip or front toward the roof, leaving a gap, and brace its sides against your back teeth or gums.'),
  y: sound('palatal-y', true, 'Lift the middle of your tongue toward the roof of your mouth.'),
  ee: sound('vowel-front', true, 'Smile wide with your tongue high and forward, as in see.'),
  i: sound('vowel-front', true, 'Smile a little with your tongue high, as in sit.'),
  e: sound('vowel-front', true, 'Open a little more with your tongue forward, as in bed.'),
  a: sound('vowel-open', true, 'Drop your jaw and open wide, as in cat.'),
  ah: sound('vowel-open', true, 'Drop your jaw and say ah, like at the doctor.'),
  o: sound('vowel-open', true, 'Drop your jaw with relaxed, unrounded lips, as in hot.'),
  oh: sound('vowel-rounded-back', true, 'Round your lips as you glide from oh toward oo, as in go.'),
  oo: sound('vowel-rounded-back', true, 'Round your lips into a small circle, as in moon.'),
};
