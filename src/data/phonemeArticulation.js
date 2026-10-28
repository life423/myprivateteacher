// An original General American teaching inventory, separate from the older 16
// mouth-position families in articulationCards.js. This is not an official Take
// Flight deck or a claim of clinical validation. The number describes teaching
// targets, not a universal analysis of English phonemes across all dialects.
// Consonant places/manners and vowel movement are informed by the primary
// phonetics references below. Instructions and wording are original.

export const ARTICULATION_INVENTORY = {
  name: 'General American phoneme articulation',
  coreConsonants: 24,
  coreVowels: 16,
  supplementalSequences: 6,
  supplementalDialectTargets: 1,
  scope: '40 core sound targets and 7 supplemental teaching targets. Vowel contrasts and r-controlled sequences vary by accent.',
  note: 'Each card models one sound or an explicitly labeled sequence. Photos show external mouth cues; diagrams explain internal placement. A shared photograph does not mean two sounds are identical.',
  affiliation: 'Original teaching materials; not an official Take Flight product or an endorsement by Scottish Rite for Children.',
  references: [
    { title: 'UC Irvine: The Consonants of American English', url: 'https://ocw.uci.edu/upload/files/consonants.pdf' },
    { title: 'UC Irvine: The Vowels of American English', url: 'https://ocw.uci.edu/upload/files/vowels.pdf' },
    { title: 'International Phonetic Association: Vowels', url: 'https://www.internationalphoneticassociation.org/content/ipa-vowels' },
    { title: 'University of Iowa: Sounds of Speech', url: 'https://soundsofspeech.uiowa.edu/english' },
    { title: 'Seeing Speech: Articulatory phonetics', url: 'https://seeingspeech.ac.uk/ipa-charts/' },
  ],
};

export const AIRFLOW_LABELS = {
  stop: 'Air stops, then releases through the mouth.',
  fricative: 'Air continues through a narrow passage.',
  affricate: 'Air stops, then releases with friction.',
  nasal: 'Air continues through the nose.',
  lateral: 'Air continues around the sides of the tongue.',
  approximant: 'Air flows through a narrowed mouth passage.',
  vowel: 'Air flows without a consonant closure.',
  sequence: 'The mouth moves between the component sounds.',
};

const consonant = (target) => ({
  kind: 'phoneme', inventory: 'core', category: 'consonant', nasal: false,
  ...target,
});
const vowel = (target) => ({
  kind: 'phoneme', inventory: 'core', category: 'vowel', voiced: true,
  nasal: false, airflow: 'vowel', manner: 'vowel',
  ...target,
});
const sequence = (target) => ({
  kind: 'sequence', inventory: 'supplemental', category: 'sequence',
  voiced: true, nasal: false, airflow: 'sequence', manner: 'sequence',
  ...target,
});

const ARTICULATION_TARGETS = [
  consonant({
    id: 'p', title: 'P sound', ipa: 'p', keyword: 'pig', graphemes: ['p', 'pp'],
    voiced: false, airflow: 'stop', manner: 'stop', place: 'both lips',
    instruction: 'Close your lips, then release a quick puff.',
    photoKey: 'lips-closed', poseKey: 'bilabial-closed',
    photoNote: 'Shows the closed-lip phase before release.',
    note: 'Press your lips together, then release a quick puff. Keep your voice off.',
  }),
  consonant({
    id: 'b', title: 'B sound', ipa: 'b', keyword: 'bat', graphemes: ['b', 'bb'],
    voiced: true, airflow: 'stop', manner: 'stop', place: 'both lips',
    instruction: 'Close your lips, then release the air.',
    photoKey: 'lips-closed', poseKey: 'bilabial-closed',
    photoNote: 'Shows the closed-lip phase before release.',
    note: 'Close your lips, turn your voice on, then release the air.',
  }),
  consonant({
    id: 't', title: 'T sound', ipa: 't', keyword: 'top', graphemes: ['t', 'tt'],
    voiced: false, airflow: 'stop', manner: 'stop', place: 'tooth ridge',
    instruction: 'Touch the tooth ridge with your tongue tip, then release.',
    photoKey: 'neutral-open', poseKey: 'alveolar-stop',
    note: 'Touch the ridge behind your top teeth with your tongue tip, then release. Voice off.',
  }),
  consonant({
    id: 'd', title: 'D sound', ipa: 'd', keyword: 'dog', graphemes: ['d', 'dd'],
    voiced: true, airflow: 'stop', manner: 'stop', place: 'tooth ridge',
    instruction: 'Touch the tooth ridge with your tongue tip, then release.',
    photoKey: 'neutral-open', poseKey: 'alveolar-stop',
    note: 'Touch the ridge behind your top teeth with your tongue tip, then release. Voice on.',
  }),
  consonant({
    id: 'k', title: 'K sound', ipa: 'k', keyword: 'cat', graphemes: ['c', 'k', 'ck'],
    voiced: false, airflow: 'stop', manner: 'stop', place: 'soft roof',
    instruction: 'Lift the back of your tongue to the soft roof, then release.',
    photoKey: 'neutral-open', poseKey: 'velar',
    note: 'Lift the back of your tongue to the soft roof of your mouth, then release. Voice off.',
  }),
  consonant({
    id: 'g', title: 'G sound', ipa: 'ɡ', keyword: 'goat', graphemes: ['g', 'gg'],
    voiced: true, airflow: 'stop', manner: 'stop', place: 'soft roof',
    instruction: 'Lift the back of your tongue to the soft roof, then release.',
    photoKey: 'neutral-open', poseKey: 'velar',
    note: 'Lift the back of your tongue to the soft roof of your mouth, then release. Voice on.',
  }),
  consonant({
    id: 'f', title: 'F sound', ipa: 'f', keyword: 'fan', graphemes: ['f', 'ff', 'ph'],
    voiced: false, airflow: 'fricative', manner: 'fricative', place: 'lip and teeth',
    instruction: 'Rest top teeth lightly on your bottom lip. Let air flow.',
    photoKey: 'lip-to-teeth', poseKey: 'labiodental',
    note: 'Rest your top teeth lightly on your bottom lip and let air flow. Voice off.',
  }),
  consonant({
    id: 'v', title: 'V sound', ipa: 'v', keyword: 'van', graphemes: ['v', 've'],
    voiced: true, airflow: 'fricative', manner: 'fricative', place: 'lip and teeth',
    instruction: 'Rest top teeth lightly on your bottom lip. Let air flow.',
    photoKey: 'lip-to-teeth', poseKey: 'labiodental',
    note: 'Rest your top teeth lightly on your bottom lip and let air flow. Voice on.',
  }),
  consonant({
    id: 'th-unvoiced', title: 'Unvoiced TH', ipa: 'θ', keyword: 'think', graphemes: ['th'],
    voiced: false, airflow: 'fricative', manner: 'fricative', place: 'tongue and teeth',
    instruction: 'Rest your tongue tip lightly between your teeth. Let air flow.',
    photoKey: 'tongue-between-teeth', poseKey: 'interdental',
    note: 'Rest your tongue tip lightly between your teeth and send air past it. Voice off.',
  }),
  consonant({
    id: 'th-voiced', title: 'Voiced TH', ipa: 'ð', keyword: 'this', graphemes: ['th'],
    voiced: true, airflow: 'fricative', manner: 'fricative', place: 'tongue and teeth',
    instruction: 'Rest your tongue tip lightly between your teeth. Let air flow.',
    photoKey: 'tongue-between-teeth', poseKey: 'interdental',
    note: 'Rest your tongue tip lightly between your teeth and send air past it. Voice on.',
  }),
  consonant({
    id: 's', title: 'S sound', ipa: 's', keyword: 'sun', graphemes: ['s', 'ss', 'c'],
    voiced: false, airflow: 'fricative', manner: 'fricative', place: 'tooth ridge',
    instruction: 'Keep teeth close. Send a thin stream of air along your tongue.',
    photoKey: 'teeth-close', poseKey: 'alveolar-fricative',
    note: 'Keep your teeth close. Send a thin stream of air along the tongue. Voice off.',
  }),
  consonant({
    id: 'z', title: 'Z sound', ipa: 'z', keyword: 'zip', graphemes: ['z', 'zz', 's'],
    voiced: true, airflow: 'fricative', manner: 'fricative', place: 'tooth ridge',
    instruction: 'Keep teeth close. Send a thin stream of air along your tongue.',
    photoKey: 'teeth-close', poseKey: 'alveolar-fricative',
    note: 'Keep your teeth close. Send a thin stream of air along the tongue. Voice on.',
  }),
  consonant({
    id: 'sh', title: 'SH sound', ipa: 'ʃ', keyword: 'ship', graphemes: ['sh', 'ti', 'ci'],
    voiced: false, airflow: 'fricative', manner: 'fricative', place: 'behind tooth ridge',
    instruction: 'Round lips a little. Let air hiss just behind the tooth ridge.',
    photoKey: 'slightly-rounded', poseKey: 'postalveolar',
    note: 'Round your lips a little. Let air hiss through a narrow gap behind the tooth ridge. Voice off.',
  }),
  consonant({
    id: 'zh', title: 'ZH sound', ipa: 'ʒ', keyword: 'treasure', graphemes: ['s', 'si', 'ge'],
    voiced: true, airflow: 'fricative', manner: 'fricative', place: 'behind tooth ridge',
    instruction: 'Round lips a little. Let air hiss just behind the tooth ridge.',
    photoKey: 'slightly-rounded', poseKey: 'postalveolar',
    note: 'Round your lips a little. Let air hiss behind the tooth ridge with your voice on, as in treasure.',
  }),
  consonant({
    id: 'h', title: 'H sound', ipa: 'h', keyword: 'hat', graphemes: ['h'],
    voiced: false, airflow: 'fricative', manner: 'fricative', place: 'voice box',
    instruction: 'Keep your mouth open and let a gentle breath flow out.',
    photoKey: 'neutral-open', poseKey: 'glottal-h',
    note: 'The tongue and lips naturally prepare for the vowel that follows. Keep your mouth comfortably open and let a gentle breath flow out. Voice off.',
  }),
  consonant({
    id: 'ch', title: 'CH sound', ipa: 'tʃ', keyword: 'chip', graphemes: ['ch', 'tch'],
    voiced: false, airflow: 'affricate', manner: 'affricate', place: 'behind tooth ridge',
    instruction: 'Press your tongue behind the tooth ridge, then release into sh.',
    photoKey: 'slightly-rounded', poseKey: 'postalveolar-affricate',
    note: 'Press your tongue just behind the tooth ridge, then release into a short sh-like sound. Voice off.',
  }),
  consonant({
    id: 'j', title: 'J sound', ipa: 'dʒ', keyword: 'jump', graphemes: ['j', 'g', 'dge'],
    voiced: true, airflow: 'affricate', manner: 'affricate', place: 'behind tooth ridge',
    instruction: 'Press your tongue behind the tooth ridge, then release with friction.',
    photoKey: 'slightly-rounded', poseKey: 'postalveolar-affricate',
    note: 'Press your tongue just behind the tooth ridge, then release with friction. Voice on.',
  }),
  consonant({
    id: 'm', title: 'M sound', ipa: 'm', keyword: 'map', graphemes: ['m', 'mm'],
    voiced: true, nasal: true, airflow: 'nasal', manner: 'nasal', place: 'both lips',
    instruction: 'Close your lips and hum through your nose.',
    photoKey: 'lips-closed', poseKey: 'bilabial-nasal',
    note: 'Close your lips and hum. Let the air come through your nose.',
  }),
  consonant({
    id: 'n', title: 'N sound', ipa: 'n', keyword: 'net', graphemes: ['n', 'nn', 'kn'],
    voiced: true, nasal: true, airflow: 'nasal', manner: 'nasal', place: 'tooth ridge',
    instruction: 'Hold your tongue tip at the tooth ridge. Hum through your nose.',
    photoKey: 'neutral-open', poseKey: 'alveolar-nasal',
    note: 'Hold your tongue tip against the ridge behind your top teeth. Hum through your nose.',
  }),
  consonant({
    id: 'ng', title: 'NG sound', ipa: 'ŋ', keyword: 'sing', graphemes: ['ng'],
    voiced: true, nasal: true, airflow: 'nasal', manner: 'nasal', place: 'soft roof',
    instruction: 'Lift the back of your tongue to the soft roof. Hum through your nose.',
    photoKey: 'neutral-open', poseKey: 'velar-nasal',
    note: 'The final sound in sing is /ŋ/; do not add a separate /ɡ/. Lift the back of your tongue to the soft roof and hum through your nose, as in sing.',
  }),
  consonant({
    id: 'l', title: 'L sound', ipa: 'l', keyword: 'lip', graphemes: ['l', 'll'],
    voiced: true, airflow: 'lateral', manner: 'lateral approximant', place: 'tooth ridge',
    instruction: 'Lift your tongue tip to the tooth ridge. Let air flow around the sides.',
    photoKey: 'neutral-open', poseKey: 'lateral-l',
    note: 'This is an initial /l/ cue; the tongue body can differ for final dark /l/. Lift your tongue tip to the ridge behind your top teeth. Let the voiced sound flow around its sides.',
  }),
  consonant({
    id: 'r', title: 'R sound', ipa: 'ɹ', keyword: 'red', graphemes: ['r', 'rr', 'wr'],
    voiced: true, airflow: 'approximant', manner: 'rhotic approximant', place: 'behind tooth ridge',
    instruction: 'Pull the tongue back. Brace its sides near back teeth, leaving a gap.',
    photoKey: 'rhotic', poseKey: 'rhotic-r',
    note: 'Both bunched and retroflex tongue shapes can produce American /ɹ/. A front photograph cannot establish the internal tongue shape. Pull the tongue back and brace its sides near the back teeth. Keep a gap in the middle. Voice on.',
  }),
  consonant({
    id: 'y', title: 'Y sound', ipa: 'j', keyword: 'yes', graphemes: ['y'],
    voiced: true, airflow: 'approximant', manner: 'glide', place: 'hard roof',
    instruction: 'Raise the front-middle of your tongue toward the roof, then glide.',
    photoKey: 'neutral-open', poseKey: 'palatal-y',
    note: 'Raise the front-middle of your tongue toward the hard roof, leaving a gap. Glide into the next vowel. Voice on.',
  }),
  consonant({
    id: 'w', title: 'W sound', ipa: 'w', keyword: 'wet', graphemes: ['w', 'wh'],
    voiced: true, airflow: 'approximant', manner: 'glide', place: 'lips and soft roof',
    instruction: 'Round lips and lift the back of your tongue, then glide.',
    photoKey: 'strongly-rounded', poseKey: 'rounded-w',
    photoNote: 'Shows the rounded starting position of the glide.',
    note: 'Round your lips and lift the back of your tongue, then glide into the next vowel. Voice on.',
  }),

  vowel({
    id: 'ee', title: 'Long E', ipa: 'i', keyword: 'feet', graphemes: ['ee', 'ea', 'e'],
    place: 'high front',
    instruction: 'Hold your tongue high and forward. Keep lips unrounded.',
    photoKey: 'smile-vowel', poseKey: 'vowel-front',
    note: 'A wide smile is not required; the photograph is an external cue. Hold your tongue high and forward. Keep your lips unrounded, as in feet.',
  }),
  vowel({
    id: 'short-i', title: 'Short I', ipa: 'ɪ', keyword: 'sit', graphemes: ['i', 'y'],
    place: 'near-high front',
    instruction: 'Hold the tongue a little lower than for ee. Keep lips unrounded.',
    photoKey: 'short-i', poseKey: 'vowel-near-high-front',
    note: 'Hold the tongue a little lower than for ee. Keep your lips unrounded, as in sit.',
  }),
  vowel({
    id: 'long-a', title: 'Long A', ipa: 'eɪ', keyword: 'cake', graphemes: ['a_e', 'ai', 'ay'],
    place: 'close-mid front to near-high front', movement: true,
    instruction: 'Start mid-front and glide the tongue higher. Keep lips unrounded.',
    photoKey: 'long-a-start', poseKey: 'vowel-close-mid-front', endPhotoKey: 'short-i', endPoseKey: 'vowel-near-high-front',
    note: 'Start with the tongue at mid-front and glide it higher. Keep your lips unrounded, as in cake.',
  }),
  vowel({
    id: 'short-e', title: 'Short E', ipa: 'ɛ', keyword: 'bed', graphemes: ['e', 'ea'],
    place: 'open-mid front',
    instruction: 'Open your jaw moderately. Keep the tongue forward and lips unrounded.',
    photoKey: 'short-e', poseKey: 'vowel-mid-front',
    note: 'Lower the tongue toward the front and open the jaw moderately. Lips unrounded, as in bed.',
  }),
  vowel({
    id: 'short-a', title: 'Short A', ipa: 'æ', keyword: 'cat', graphemes: ['a'],
    place: 'near-low front',
    instruction: 'Open your jaw. Keep the tongue low and forward, with lips unrounded.',
    photoKey: 'short-a', poseKey: 'vowel-low-front',
    note: 'Open your jaw and keep the tongue low and toward the front. Lips unrounded, as in cat.',
  }),
  vowel({
    id: 'short-u', title: 'Short U', ipa: 'ʌ', keyword: 'cup', graphemes: ['u', 'o'],
    place: 'central',
    instruction: 'Keep your tongue in the middle, jaw slightly open and lips relaxed.',
    photoKey: 'central-relaxed', poseKey: 'vowel-mid-central',
    note: 'Keep the tongue in the middle and the jaw slightly open. Lips relaxed, as in cup.',
  }),
  vowel({
    id: 'schwa', title: 'Schwa', ipa: 'ə', keyword: 'about', graphemes: ['a', 'e', 'i', 'o', 'u'],
    place: 'central', stress: 'unstressed',
    instruction: 'Use a short, unstressed vowel with relaxed lips and tongue.',
    photoKey: 'central-relaxed', poseKey: 'vowel-mid-central',
    note: 'Schwa is reduced and varies with context; a static photo is only a relaxed-mouth cue. Use a short, unstressed vowel with relaxed lips and tongue, as at the start of about.',
  }),
  vowel({
    id: 'short-o', title: 'Short O', ipa: 'ɑ', keyword: 'hot', graphemes: ['o', 'a'],
    place: 'low back',
    instruction: 'Open your jaw. Lower the tongue toward the back. Lips unrounded.',
    photoKey: 'open-vowel', poseKey: 'vowel-open',
    note: 'This General American target also covers the usual ah sound; ah is not a second target here. Open your jaw and lower the tongue toward the back. Keep lips unrounded, as in hot.',
  }),
  vowel({
    id: 'aw', title: 'Aw', ipa: 'ɔ', keyword: 'saw', graphemes: ['aw', 'au', 'a'],
    place: 'open-mid back', dialectDependent: true,
    instruction: 'Open your jaw. Hold the tongue toward the back and round your lips.',
    photoKey: 'aw-rounded', poseKey: 'vowel-open-mid-back',
    dialectNote: 'Many American speakers merge the vowels in cot and caught. Use this separate target only when the model speaker distinguishes it from /ɑ/.',
    note: 'Open your jaw and hold the tongue toward the back. Round the lips, as in saw.',
  }),
  vowel({
    id: 'long-o', title: 'Long O', ipa: 'oʊ', keyword: 'go', graphemes: ['o', 'o_e', 'oa', 'ow'],
    place: 'close-mid back to near-high back', movement: true,
    instruction: 'Start mid-back. Glide the tongue higher as the lips round more.',
    photoKey: 'long-o-start', poseKey: 'vowel-mid-back', endPhotoKey: 'book-oo', endPoseKey: 'vowel-near-high-back',
    note: 'Start with the tongue at mid-back and glide it higher as your lips round more, as in go.',
  }),
  vowel({
    id: 'book-oo', title: 'Book OO', ipa: 'ʊ', keyword: 'book', graphemes: ['oo', 'u'],
    place: 'near-high back',
    instruction: 'Hold the tongue near high at the back. Round your lips moderately.',
    photoKey: 'book-oo', poseKey: 'vowel-near-high-back',
    note: 'Keep the tongue near high at the back and the lips moderately rounded, as in book.',
  }),
  vowel({
    id: 'moon-oo', title: 'Moon OO', ipa: 'u', keyword: 'moon', graphemes: ['oo', 'ue', 'ew'],
    place: 'high back',
    instruction: 'Hold the tongue high toward the back and round your lips.',
    photoKey: 'strongly-rounded', poseKey: 'vowel-rounded-back',
    note: 'The tongue may be more central or fronted in some American accents; lip rounding also varies. Hold the tongue high toward the back and round your lips, as in moon.',
  }),
  vowel({
    id: 'long-i', title: 'Long I', ipa: 'aɪ', keyword: 'pie', graphemes: ['i_e', 'igh', 'y', 'ie'],
    place: 'low central to near-high front', movement: true,
    instruction: 'Start open and unrounded. Glide the tongue up toward the front.',
    photoKey: 'open-vowel', poseKey: 'vowel-low-central', endPhotoKey: 'short-i', endPoseKey: 'vowel-near-high-front',
    note: 'Start with an open, unrounded mouth. Glide the tongue up toward the front, as in pie.',
  }),
  vowel({
    id: 'ow', title: 'Ow', ipa: 'aʊ', keyword: 'cow', graphemes: ['ou', 'ow'],
    place: 'low central to near-high back', movement: true,
    instruction: 'Start open and unrounded. Glide the tongue higher and back; round lips.',
    photoKey: 'open-vowel', poseKey: 'vowel-low-central', endPhotoKey: 'book-oo', endPoseKey: 'vowel-near-high-back',
    note: 'Start with an open, unrounded mouth. Glide the tongue higher and back as the lips round, as in cow.',
  }),
  vowel({
    id: 'oy', title: 'Oi / Oy', ipa: 'ɔɪ', keyword: 'boy', graphemes: ['oi', 'oy'],
    place: 'back to near-high front', movement: true,
    instruction: 'Start rounded with the tongue back. Glide forward and unround lips.',
    photoKey: 'aw-rounded', poseKey: 'vowel-open-mid-back', endPhotoKey: 'short-i', endPoseKey: 'vowel-near-high-front',
    note: 'Start with rounded lips and the tongue toward the back. Glide forward and unround the lips, as in boy.',
  }),
  vowel({
    id: 'r-vowel', title: 'Er', ipa: 'ɝ', keyword: 'bird', graphemes: ['er', 'ir', 'ur'],
    place: 'r-colored central', stress: 'stressed',
    instruction: 'Pull the tongue back; brace its sides near back teeth. Hold the vowel.',
    photoKey: 'rhotic', poseKey: 'rhotic-r',
    variants: [{ ipa: 'ɚ', keyword: 'teacher', stress: 'unstressed', label: 'Unstressed r-colored vowel' }],
    note: 'The unstressed /ɚ/ variant is included here rather than counted as another core target. Bunched and retroflex tongue shapes are both possible. Pull the tongue back and brace its sides near the back teeth. Hold the voiced vowel, as in bird.',
  }),

  sequence({
    id: 'long-u', title: 'Yoo (long U)', ipa: 'ju', keyword: 'cube', graphemes: ['u_e', 'u', 'ew'],
    place: 'palatal glide to high back vowel', componentIds: ['y', 'moon-oo'], movement: true,
    instruction: 'Start with y and glide into oo without a pause.',
    photoKey: 'neutral-open', poseKey: 'palatal-y', endPhotoKey: 'strongly-rounded', endPoseKey: 'vowel-rounded-back',
    note: 'A sequence of /j/ and /u/, not one additional phoneme. Words such as tune may omit /j/ in some accents. Start with the y sound, then glide into oo without a pause, as in cube.',
  }),
  sequence({
    id: 'ar', title: 'Ar', ipa: 'ɑɹ', keyword: 'car', graphemes: ['ar'],
    place: 'open back vowel to r', componentIds: ['short-o', 'r'], movement: true,
    instruction: 'Start with an open ah-like vowel, then move into the r position.',
    photoKey: 'open-vowel', poseKey: 'vowel-open', endPhotoKey: 'rhotic', endPoseKey: 'rhotic-r',
    note: 'An r-controlled teaching sequence; the transition is often strongly coarticulated. Start with an open ah-like vowel, then move into the r position, as in car.',
  }),
  sequence({
    id: 'or', title: 'Or', ipa: 'ɔɹ', keyword: 'corn', graphemes: ['or', 'ore', 'oar'],
    place: 'back rounded vowel to r', componentIds: ['aw', 'r'], movement: true,
    instruction: 'Start with a rounded back vowel, then move into the r position.',
    photoKey: 'aw-rounded', poseKey: 'vowel-open-mid-back', endPhotoKey: 'rhotic', endPoseKey: 'rhotic-r',
    dialectNote: 'The starting vowel and its transcription vary by accent. This sequence is not an extra universal vowel phoneme.',
    note: 'Begin with a back, rounded vowel and move into the r position, as in corn.',
  }),
  sequence({
    id: 'air', title: 'Air', ipa: 'ɛɹ', keyword: 'chair', graphemes: ['air', 'are', 'ear'],
    place: 'front vowel to r', componentIds: ['short-e', 'r'], movement: true,
    instruction: 'Start with a front, unrounded vowel, then move into the r position.',
    photoKey: 'short-e', poseKey: 'vowel-mid-front', endPhotoKey: 'rhotic', endPoseKey: 'rhotic-r',
    dialectNote: 'The starting vowel and contrasts such as Mary, merry and marry vary by accent.',
    note: 'Begin with a front, unrounded vowel and move into the r position, as in chair.',
  }),
  sequence({
    id: 'ear', title: 'Ear', ipa: 'ɪɹ', keyword: 'ear', graphemes: ['ear', 'eer', 'ere'],
    place: 'high front vowel to r', componentIds: ['short-i', 'r'], movement: true,
    instruction: 'Start with a high front vowel, then move into the r position.',
    photoKey: 'short-i', poseKey: 'vowel-near-high-front', endPhotoKey: 'rhotic', endPoseKey: 'rhotic-r',
    dialectNote: 'Some descriptions use /iɹ/. Follow the model speaker rather than forcing a separate short-i stage.',
    note: 'Begin with a high front vowel and move into the r position, as in ear.',
  }),
  sequence({
    id: 'oor', title: 'Oor', ipa: 'ʊɹ', keyword: 'tour', graphemes: ['oor', 'our', 'ure'],
    place: 'near-high back vowel to r', componentIds: ['book-oo', 'r'], movement: true, dialectDependent: true,
    instruction: 'Start with a near-high back vowel, then move into the r position.',
    photoKey: 'book-oo', poseKey: 'vowel-near-high-back', endPhotoKey: 'rhotic', endPoseKey: 'rhotic-r',
    dialectNote: 'Many speakers merge this sequence with or; do not require a contrast the speaker does not use.',
    note: 'Begin with a near-high back vowel and move into the r position, as in tour when it differs from tore.',
  }),
  {
    id: 'wh', title: 'WH (dialect)', ipa: 'ʍ', keyword: 'which', graphemes: ['wh'],
    kind: 'dialect', inventory: 'supplemental', category: 'consonant',
    voiced: false, nasal: false, airflow: 'approximant', manner: 'voiceless glide', place: 'lips and soft roof',
    instruction: 'Round your lips and let a breathy glide flow into the next vowel.',
    photoKey: 'strongly-rounded', poseKey: 'rounded-w', dialectDependent: true,
    dialectNote: 'For speakers who distinguish which from witch. Often analyzed as /hw/; most American speakers use /w/ for both.',
    note: 'Use rounded lips and let a breathy glide flow into the next vowel. Keep your voice off at the start.',
  },
];

// Student-facing phonics labels are independent of the precise IPA metadata.
// These labels and their aliases support searching only: th, oo and symbols used
// differently by phonics/IPA conventions must never merge distinct target IDs.
const DISPLAY_SOUNDS = {
  p: 'p', b: 'b', t: 't', d: 'd', k: 'k', g: 'g', f: 'f', v: 'v',
  'th-unvoiced': 'th', 'th-voiced': 'th', s: 's', z: 'z', sh: 'sh', zh: 'zh',
  h: 'h', ch: 'ch', j: 'j', m: 'm', n: 'n', ng: 'ng', l: 'l', r: 'r', y: 'y', w: 'w',
  ee: 'ē', 'short-i': 'ĭ', 'long-a': 'ā', 'short-e': 'ĕ', 'short-a': 'ă',
  'short-u': 'ŭ', schwa: 'ə', 'short-o': 'ŏ', aw: 'aw', 'long-o': 'ō',
  'book-oo': 'oo', 'moon-oo': 'oo', 'long-i': 'ī', ow: 'ow', oy: 'oi', 'r-vowel': 'er',
  'long-u': 'yoo', ar: 'ar', or: 'or', air: 'air', ear: 'ear', oor: 'oor', wh: 'wh',
};

const SEARCH_LABELS = {
  'th-unvoiced': ['unvoiced th', 'voiceless th', 'th as in think'],
  'th-voiced': ['voiced th', 'th as in this'],
  ee: ['long e', 'ee'],
  'short-i': ['short i'],
  'long-a': ['long a'],
  'short-e': ['short e'],
  'short-a': ['short a'],
  'short-u': ['short u'],
  schwa: ['schwa'],
  'short-o': ['short o', 'ah'],
  aw: ['aw', 'au'],
  'long-o': ['long o', 'oh'],
  'book-oo': ['book oo', 'short oo'],
  'moon-oo': ['moon oo', 'long oo'],
  'long-i': ['long i'],
  ow: ['ou', 'ow'],
  oy: ['oi', 'oy'],
  'r-vowel': ['er', 'ir', 'ur', 'r-colored vowel', 'ɚ'],
  'long-u': ['long u', 'yoo'],
  ar: ['ar'], or: ['or'], air: ['air'], ear: ['ear'], oor: ['oor'],
  wh: ['wh', 'voiceless wh'],
};

export const PHONEME_ARTICULATION_CARDS = ARTICULATION_TARGETS.map((card) => {
  const displaySound = DISPLAY_SOUNDS[card.id];
  return {
    ...card,
    displaySound,
    soundAliases: [...new Set([displaySound, card.ipa, card.id, ...(SEARCH_LABELS[card.id] || [])])],
  };
});

export const CORE_PHONEMES = PHONEME_ARTICULATION_CARDS.filter((card) => card.inventory === 'core');
export const SUPPLEMENTAL_ARTICULATION = PHONEME_ARTICULATION_CARDS.filter((card) => card.inventory === 'supplemental');

// Every referenced key is explicit. A renderer must flag a missing asset rather
// than silently replacing it with a photograph for a different vowel.
export const ARTICULATION_PHOTO_KEYS = [...new Set(PHONEME_ARTICULATION_CARDS.flatMap((card) => [card.photoKey, card.endPhotoKey].filter(Boolean)))];
export const ARTICULATION_POSE_KEYS = [...new Set(PHONEME_ARTICULATION_CARDS.flatMap((card) => [card.poseKey, card.endPoseKey].filter(Boolean)))];

export const phonemeArticulationById = (id) => PHONEME_ARTICULATION_CARDS.find((card) => card.id === id) || null;
