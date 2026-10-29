export const MATERIAL_TABS = ['letters', 'pictures', 'worksheets'];
export const emptyMaterialsView = () => ({ active: 'letters', letters: { query: '', scrollTop: 0 }, pictures: { query: '', scrollTop: 0 }, worksheets: { query: '', scrollTop: 0 } });
export function cleanMaterialsView(input) {
  const value = input && typeof input === 'object' ? input : {};
  const result = { active: MATERIAL_TABS.includes(value.active) ? value.active : 'letters' };
  for (const tab of MATERIAL_TABS) result[tab] = {
    query: typeof value[tab]?.query === 'string' ? value[tab].query.slice(0, 200) : '',
    scrollTop: Number.isFinite(value[tab]?.scrollTop) ? Math.max(0, Math.min(1_000_000, value[tab].scrollTop)) : 0,
  };
  return result;
}
export function loadMaterialsView(scope) {
  try { return cleanMaterialsView(JSON.parse(sessionStorage.getItem(`mpt.materials.${scope}`) || 'null')); }
  catch { return emptyMaterialsView(); }
}
export function saveMaterialsView(scope, view) {
  try { sessionStorage.setItem(`mpt.materials.${scope}`, JSON.stringify(cleanMaterialsView(view))); }
  catch { /* The lesson still works when browser storage is unavailable. */ }
}
export const materialKind = (picture) => picture?.material === 'worksheet' ? 'worksheet' : 'picture';
export function matchingMaterials(pictures, kind, query = '') {
  const terms = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  return pictures.filter((picture) => materialKind(picture) === kind && terms.every((term) => `${picture.title || ''} ${(picture.sounds || []).join(' ')}`.toLowerCase().includes(term)));
}
export const QUICK_LETTERS = [...'abcdefghijklmnopqrstuvwxyz', 'sh', 'ch', 'th', 'wh', 'ck', 'ng', 'qu', 'ee', 'oa', 'ai', 'igh'];
export function matchingLetters(query = '') {
  const wanted = String(query).trim().toLowerCase();
  return QUICK_LETTERS.filter((letter) => !wanted || letter.includes(wanted));
}
