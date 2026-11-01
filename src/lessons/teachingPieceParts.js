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
    { id: 'open-jaw', label: 'Open jaw.', x: 904, y: 1160, w: 306, h: 95, fontSize: 58 },
    { id: 'lips', label: 'Lips unrounded.', x: 905, y: 1245, w: 391, h: 86, fontSize: 50 },
    { id: 'tongue', label: 'Tongue low and forward.', x: 903, y: 1331, w: 291, h: 138, fontSize: 46 },
  ],
  '5166c855cdbe4efde05f2d9c54c74631bebaa75c9d59dbb09d925f0f08e22a1e': [
    { id: 'model-mat', label: 'măt (model)', x: 595, y: 393, w: 424, h: 215, fontSize: 240 },
    { id: 'letter-m', label: 'm', x: 449, y: 717, w: 146, h: 120, letter: 'm', fontSize: 150 },
    { id: 'letter-a', label: 'a', x: 743, y: 717, w: 112, h: 122, letter: 'a', fontSize: 150 },
    { id: 'letter-t', label: 't', x: 1040, y: 692, w: 78, h: 146, letter: 't', fontSize: 150 },
    { id: 'sound-boxes', label: '3 sound boxes', x: 398, y: 653, w: 804, h: 230, boxes: 3 },
    { id: 'word-mat', label: 'măt', x: 317, y: 984, w: 275, h: 146, fontSize: 150 },
    { id: 'word-pat', label: 'păt', x: 1037, y: 984, w: 234, h: 174, fontSize: 150 },
    { id: 'word-sat', label: 'săt', x: 337, y: 1174, w: 230, h: 146, fontSize: 150 },
    { id: 'word-sap', label: 'săp', x: 1016, y: 1174, w: 267, h: 174, fontSize: 150 },
    { id: 'word-tap', label: 'tăp', x: 330, y: 1364, w: 236, h: 174, fontSize: 150 },
    { id: 'word-map', label: 'măp', x: 996, y: 1364, w: 312, h: 174, fontSize: 150 },
  ],
  '807f22832e5adad0697e04328e05e1f90d757b83d1161b9fec6950dccda033c5': [
    { id: 'line-1', label: 'Pat sat.', x: 141, y: 453, w: 453, h: 133, fontSize: 128 },
    { id: 'line-2', label: 'Tap, Pat, tap!', x: 134, y: 711, w: 781, h: 157, fontSize: 128 },
    { id: 'line-3', label: 'Pat sat.', x: 141, y: 969, w: 453, h: 133, fontSize: 128 },
    { id: 'line-4', label: 'Tap, tap, tap!', x: 134, y: 1227, w: 767, h: 157, fontSize: 128 },
  ],
  '0f1b29a32588f37ac0a568c523b4e284bb16f58cd7123cf9cadea06b521bf211': [
    { id: 'mat-picture', label: 'Mat picture', x: 129, y: 422, w: 702, h: 482 },
    { id: 'mat-word', label: 'mat', x: 952, y: 576, w: 359, h: 182, fontSize: 200 },
    { id: 'map-picture', label: 'Map picture', x: 129, y: 991, w: 702, h: 482 },
    { id: 'map-word', label: 'map', x: 924, y: 1184, w: 409, h: 187, fontSize: 200 },
  ],
};

export function partsForTeachingImage(sha256, w, h) {
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256) || w !== 1600 || h !== 1700) return [];
  return (SOURCES[sha256.toLowerCase()] || []).map(part => ({ ...part }));
}
