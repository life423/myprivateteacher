import { DEFAULT_PAGE_ID, MAX_PAGES, PAGE_COMMANDS, PAGE_MUTATIONS, cleanPageTitle, isPageEpoch, isPageId, matchesPageScope } from '../../shared/pages.js';

const DEFAULT_PAGES = [{ id: DEFAULT_PAGE_ID, title: 'Board 1' }];
const clone = value => value === undefined ? undefined : structuredClone(value);
const scopedEvents = new Set([...PAGE_MUTATIONS, 'ack', 'tiles', 'pic:add', 'piece:denied', 'pieces', 'offer', 'tile:denied']);
const validScope = value => isPageId(value?.pageId) && isPageEpoch(value?.pageEpoch);
const same = (a, b) => a?.pageId === b?.pageId && a?.pageEpoch === b?.pageEpoch;
function manifest(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const pages = value.filter(page => isPageId(page?.id) && !seen.has(page.id) && seen.add(page.id)).slice(0, MAX_PAGES).map((page, index) => ({ id: page.id, title: cleanPageTitle(page.title, `Board ${index + 1}`) }));
  return pages.length ? pages : null;
}

// Transport authority is separate from the displayed/cached deck: a restarted
// server acknowledges page-1/0 before the tutor restores their retained pages.
export function createPageSession({ capture, boundary, changed }) {
  let scope = null, ready = true, pages = DEFAULT_PAGES, displayId = DEFAULT_PAGE_ID;
  let game = null, pictureIds = new Set(), version = 0, restoreGeneration = 0;
  const cached = new Map(), authorities = new WeakSet();
  const notify = () => { version++; changed(); };
  const currentScope = origin => origin === null ? scope === null : validScope(origin) && same(origin, scope);
  const save = () => {
    const value = capture();
    cached.set(displayId, { ...value, id: displayId, game: clone(game), pictureIds: [...pictureIds] });
  };
  const updateManifest = value => {
    const next = manifest(value);
    if (!next) return;
    pages = next;
    for (const id of cached.keys()) if (!pages.some(page => page.id === id)) cached.delete(id);
  };
  const invalidate = () => { restoreGeneration++; boundary(); };
  const api = {
    get pageId() { return scope?.pageId || displayId; },
    get pageEpoch() { return scope?.pageEpoch || 0; },
    get pages() { return pages; },
    get ready() { return ready; },
    get version() { return version; },
    get game() { return game; },
    scope() { return scope && { ...scope }; },
    current: currentScope,
    scopeMessage(message, origin = validScope(message) ? { pageId: message.pageId, pageEpoch: message.pageEpoch } : scope) {
      if (!PAGE_MUTATIONS.has(message?.t) && !PAGE_COMMANDS.has(message?.t)) return message;
      if (!ready || !currentScope(origin)) return null;
      return origin ? { ...message, ...origin } : message;
    },
    accept(message) {
      if (!message || typeof message !== 'object') return false;
      const authority = ['room', 'board', 'pages'].includes(message.t);
      if (authority && validScope(message)) {
        // A room acknowledgement starts a new socket authority boundary. Boards
        // on that socket may then restore another active page; old sockets are
        // already excluded by useRealtime.
        if (message.t !== 'room' && ready && scope && (message.pageEpoch < scope.pageEpoch || (message.pageEpoch === scope.pageEpoch && message.pageId !== scope.pageId))) return false;
        if (authorities.has(message)) return true;
        authorities.add(message);
        const transition = !same(scope, message) || message.t === 'room';
        if (transition) {
          save(); invalidate();
          scope = { pageId: message.pageId, pageEpoch: message.pageEpoch };
          if (message.t === 'room') ready = false;
        }
        if (!(message.t === 'room' && message.fresh)) updateManifest(message.pages);
        notify();
        return true;
      }
      if (authority) return !scope; // Legacy single-board snapshots.
      if (scope && (validScope(message) || scopedEvents.has(message.t))) return matchesPageScope(message, scope.pageId, scope.pageEpoch, pages.length);
      return true;
    },
    applyBoard(message) {
      displayId = scope?.pageId || DEFAULT_PAGE_ID;
      game = clone(message.game || null);
      pictureIds = new Set(Array.isArray(message.pictureIds) ? message.pictureIds : (message.pictures || []).map(picture => picture.id));
      ready = true;
      notify();
      save();
    },
    rememberGame(value, origin = scope) {
      if (!ready || !currentScope(origin)) return false;
      game = clone(value || null);
      return true;
    },
    hasPicture(id) { return pictureIds.has(id); },
    cacheBoard(value) {
      if (!isPageId(value?.id) || value.id === displayId || !pages.some(page => page.id === value.id)) return false;
      cached.set(value.id, clone(value));
      return true;
    },
    notePicture(id) { if (id) pictureIds.add(id); },
    setPictureIds(ids) { pictureIds = new Set(ids); },
    disconnect() { save(); invalidate(); ready = false; notify(); },
    invalidateRestore() { restoreGeneration++; },
    restoreSnapshot() {
      save();
      const generation = ++restoreGeneration;
      return { generation, complete: pages.every(page => cached.has(page.id)), activePageId: displayId, pages: pages.map(page => ({ ...page })), boards: pages.map(page => clone(cached.get(page.id) || { id: page.id, strokes: [], tiles: [], pieces: [], offers: [], pictureIds: [], game: null })) };
    },
    restoreCurrent(generation) { return generation === restoreGeneration; },
  };
  return api;
}
