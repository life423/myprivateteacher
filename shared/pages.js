// Pages share one live lesson. A page activation is an authority boundary: an old
// gesture must never be relabelled as a change to the newly visible page.
export const MAX_PAGES = 24;
export const DEFAULT_PAGE_ID = 'page-1';
export const isPageId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
export const isPageEpoch = (value) => Number.isSafeInteger(value) && value >= 0;
export function cleanPageTitle(value, fallback = 'Board') {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64) || fallback;
}

export const PAGE_COMMANDS = new Set(['page:add', 'page:duplicate', 'page:switch', 'page:rename', 'page:delete']);
export const PAGE_MUTATIONS = new Set([
  's', 'm', 'e', 'undo', 'clear',
  'tile:add', 'tile:duplicate', 'tile:grab', 'tile:move', 'tile:drop', 'tile:delete', 'tile:edit', 'tiles:reset', 'tiles:clear',
  'piece:add', 'piece:grab', 'piece:move', 'piece:drop', 'piece:crop', 'piece:layer', 'piece:delete', 'pieces:clear',
  'offer:add', 'offer:remove', 'offer:reset',
  'strip:set', 'lines:set', 'boxes:set', 'boxes:tap', 'boxes:reset',
  'game', 'game:act', 'hands', 'hand', 'p', 'view', 'browse', 'guide', 'focus',
]);

// Single-board clients remain compatible only before the first page activation.
// Returning to page 1 does not reopen that legacy window.
export function matchesPageScope(msg, pageId, pageEpoch, pageCount) {
  if (msg.pageId === undefined && msg.pageEpoch === undefined) return pageCount === 1 && pageEpoch === 0;
  return isPageId(msg.pageId) && isPageEpoch(msg.pageEpoch) && msg.pageId === pageId && msg.pageEpoch === pageEpoch;
}
