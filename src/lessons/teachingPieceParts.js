// Named pieces for the reviewed, immutable short-a teaching sheets. Coordinates
// come from their SVG layout and raster glyph bounds, including breve/descenders.
// fontSize is the source image's font size, used to choose a readable board scale.
// Letters and sound boxes become native board controls; their crops only highlight
// the corresponding area in the tutor's private source preview.
const SOURCES = {
  '770eed01f3b778d9f5346ae2c324c4d1f9abf0af705ee9d1ef750e25be743549': [
    { id: 'short-a', label: 'Short a', x: 295, y: 530, w: 286, h: 416, letter: 'a', fontSize: 500 },
    { id: 'apple', label: 'Apple picture', x: 803, y: 409, w: 600, h: 604 },
    { id: 'mouth', label: 'Mouth photo', x: 128, y: 1122, w: 352, h: 396 },
    { id: 'diagram', label: 'Mouth diagram', x: 504, y: 1134, w: 362, h: 362 },
    { id: 'open-jaw', label: 'Open jaw.', content: { kind: 'text', text: 'Open jaw.' }, x: 904, y: 1160, w: 306, h: 95, fontSize: 58 },
    { id: 'lips', label: 'Lips unrounded.', content: { kind: 'text', text: 'Lips unrounded.' }, x: 905, y: 1245, w: 391, h: 86, fontSize: 50 },
    { id: 'tongue', label: 'Tongue low and forward.', content: { kind: 'text', text: 'Tongue low and forward.' }, x: 903, y: 1331, w: 291, h: 138, fontSize: 46 },
  ],
  '5166c855cdbe4efde05f2d9c54c74631bebaa75c9d59dbb09d925f0f08e22a1e': [
    { id: 'model-mat', label: 'măt (model)', content: { kind: 'text', text: 'măt' }, x: 595, y: 393, w: 424, h: 215, fontSize: 240 },
    { id: 'breve', label: 'Breve', x: 831, y: 410, w: 75, h: 37, content: { kind: 'breve' } },
    { id: 'letter-m', label: 'm', x: 449, y: 717, w: 146, h: 120, letter: 'm', fontSize: 150 },
    { id: 'letter-a', label: 'a', x: 743, y: 717, w: 112, h: 122, letter: 'a', fontSize: 150 },
    { id: 'letter-t', label: 't', x: 1040, y: 692, w: 78, h: 146, letter: 't', fontSize: 150 },
    { id: 'sound-boxes', label: '3 sound boxes', x: 398, y: 653, w: 804, h: 230, boxes: 3 },
    { id: 'word-mat', label: 'măt', content: { kind: 'text', text: 'măt' }, x: 317, y: 984, w: 275, h: 146, fontSize: 150 },
    { id: 'word-pat', label: 'păt', content: { kind: 'text', text: 'păt' }, x: 1037, y: 984, w: 234, h: 174, fontSize: 150 },
    { id: 'word-sat', label: 'săt', content: { kind: 'text', text: 'săt' }, x: 337, y: 1174, w: 230, h: 146, fontSize: 150 },
    { id: 'word-sap', label: 'săp', content: { kind: 'text', text: 'săp' }, x: 1016, y: 1174, w: 267, h: 174, fontSize: 150 },
    { id: 'word-tap', label: 'tăp', content: { kind: 'text', text: 'tăp' }, x: 330, y: 1364, w: 236, h: 174, fontSize: 150 },
    { id: 'word-map', label: 'măp', content: { kind: 'text', text: 'măp' }, x: 996, y: 1364, w: 312, h: 174, fontSize: 150 },
  ],
  '807f22832e5adad0697e04328e05e1f90d757b83d1161b9fec6950dccda033c5': [
    { id: 'line-1', label: 'Pat sat.', content: { kind: 'text', text: 'Pat sat.' }, x: 141, y: 453, w: 453, h: 133, fontSize: 128 },
    { id: 'line-2', label: 'Tap, Pat, tap!', content: { kind: 'text', text: 'Tap, Pat, tap!' }, x: 134, y: 711, w: 781, h: 157, fontSize: 128 },
    { id: 'line-3', label: 'Pat sat.', content: { kind: 'text', text: 'Pat sat.' }, x: 141, y: 969, w: 453, h: 133, fontSize: 128 },
    { id: 'line-4', label: 'Tap, tap, tap!', content: { kind: 'text', text: 'Tap, tap, tap!' }, x: 134, y: 1227, w: 767, h: 157, fontSize: 128 },
  ],
  '0f1b29a32588f37ac0a568c523b4e284bb16f58cd7123cf9cadea06b521bf211': [
    { id: 'mat-picture', label: 'Mat picture', x: 129, y: 422, w: 702, h: 482 },
    { id: 'mat-word', label: 'mat', content: { kind: 'text', text: 'mat' }, x: 952, y: 576, w: 359, h: 182, fontSize: 200 },
    { id: 'map-picture', label: 'Map picture', x: 129, y: 991, w: 702, h: 482 },
    { id: 'map-word', label: 'map', content: { kind: 'text', text: 'map' }, x: 924, y: 1184, w: 409, h: 187, fontSize: 200 },
  ],
};

// Fine selections are measured on the same immutable PNGs. A letter's body and
// its separate breve are different targets; tapping the mark never copies a vowel
// or adjacent letter. The editor exposes one button for each available letter.
const letter = (id, value, [left, top, right, bottom], fontSize) => ({
  id, label: `Letter ${value}`, kind: 'letter', letter: value, fontSize,
  x: left - 3, y: top - 3, w: right - left + 6, h: bottom - top + 6,
});
const breve = (id, [left, top, right, bottom]) => ({
  id, label: 'Breve', kind: 'mark', content: { kind: 'breve' },
  x: left - 3, y: top - 3, w: right - left + 6, h: bottom - top + 6,
});
const wordLetters = (id, value, bounds, fontSize) => [...value].map((value, index) => letter(`${id}-${index}`, value, bounds[index], fontSize));
const wordWork = [
  ...wordLetters('model', 'mat', [[615, 457, 785, 585], [808, 457, 923, 588], [937, 417, 999, 587]], 240),
  breve('model-breve', [834, 413, 903, 444]),
  ...wordLetters('sound-box', 'mat', [[469, 737, 575, 817], [763, 737, 835, 819], [1060, 712, 1098, 818]], 150),
  ...wordLetters('mat', 'mat', [[335, 1030, 440, 1110], [455, 1030, 527, 1112], [536, 1005, 574, 1111]], 150),
  breve('mat-breve', [471, 1002, 515, 1022]),
  ...wordLetters('pat', 'pat', [[1055, 1030, 1123, 1140], [1134, 1030, 1206, 1112], [1215, 1005, 1253, 1111]], 150),
  breve('pat-breve', [1151, 1002, 1194, 1022]),
  ...wordLetters('sat', 'sat', [[355, 1220, 419, 1302], [430, 1220, 502, 1302], [511, 1195, 549, 1301]], 150),
  breve('sat-breve', [446, 1192, 490, 1212]),
  ...wordLetters('sap', 'sap', [[1034, 1220, 1098, 1302], [1109, 1220, 1181, 1302], [1197, 1220, 1265, 1330]], 150),
  breve('sap-breve', [1125, 1192, 1169, 1212]),
  ...wordLetters('tap', 'tap', [[348, 1385, 386, 1491], [393, 1410, 465, 1492], [480, 1410, 548, 1520]], 150),
  breve('tap-breve', [409, 1382, 452, 1402]),
  ...wordLetters('map', 'map', [[1014, 1410, 1119, 1490], [1134, 1410, 1206, 1492], [1222, 1410, 1290, 1520]], 150),
  breve('map-breve', [1150, 1382, 1194, 1402]),
];
const reading = [
  ...wordLetters('line-1', 'Patsat', [[161, 473, 231, 565], [241, 497, 302, 566], [310, 475, 342, 566], [383, 497, 438, 566], [447, 497, 509, 566], [516, 475, 549, 566]], 128),
  ...wordLetters('line-2', 'TapPattap', [[154, 731, 227, 823], [219, 755, 281, 824], [294, 755, 352, 848], [438, 731, 509, 823], [518, 755, 580, 824], [587, 733, 620, 824], [694, 733, 727, 824], [732, 755, 793, 824], [807, 755, 865, 848]], 128),
  ...wordLetters('line-3', 'Patsat', [[161, 989, 231, 1081], [241, 1013, 302, 1082], [310, 991, 342, 1082], [383, 1013, 438, 1082], [447, 1013, 509, 1082], [516, 991, 549, 1082]], 128),
  ...wordLetters('line-4', 'Taptaptap', [[154, 1247, 227, 1339], [219, 1271, 281, 1340], [294, 1271, 352, 1364], [431, 1249, 463, 1340], [468, 1271, 530, 1340], [543, 1271, 601, 1364], [680, 1249, 712, 1340], [718, 1271, 779, 1340], [792, 1271, 850, 1364]], 128),
];
const FINE_SOURCES = {
  '770eed01f3b778d9f5346ae2c324c4d1f9abf0af705ee9d1ef750e25be743549': [
    letter('cue-a', 'a', [319, 649, 557, 920], 500), breve('cue-breve', [372, 557, 516, 620]),
  ],
  '5166c855cdbe4efde05f2d9c54c74631bebaa75c9d59dbb09d925f0f08e22a1e': wordWork,
  '807f22832e5adad0697e04328e05e1f90d757b83d1161b9fec6950dccda033c5': reading,
  '0f1b29a32588f37ac0a568c523b4e284bb16f58cd7123cf9cadea06b521bf211': [
    ...wordLetters('meaning-mat', 'mat', [[972, 629, 1113, 736], [1133, 629, 1229, 738], [1240, 596, 1292, 737]], 200),
    ...wordLetters('meaning-map', 'map', [[944, 1204, 1085, 1311], [1105, 1204, 1201, 1313], [1222, 1204, 1313, 1351]], 200),
  ],
};
const sourceKey = (sha256, w, h) => typeof sha256 === 'string' && /^[a-f0-9]{64}$/i.test(sha256) && w === 1600 && h === 1700 ? sha256.toLowerCase() : null;
const copies = parts => (parts || []).map(part => ({ ...part, ...(part.content ? { content: { ...part.content } } : {}) }));

export function partsForTeachingImage(sha256, w, h) {
  return copies(SOURCES[sourceKey(sha256, w, h)]);
}

export function selectionPartsForTeachingImage(sha256, w, h) {
  return copies(FINE_SOURCES[sourceKey(sha256, w, h)]);
}
