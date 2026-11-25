export const TEACHING_SESSION_KEY = 'wb-tutor';
const startToken = search => {
  const value = new URLSearchParams(search).get('start');
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value) ? value : null;
};

// An explicit Calendar Start gets a new room. Refreshing that same start URL
// reconnects to its room, rather than generating another code for the family.
export function loadTeachingSession(storage, search = '') {
  try {
    const saved = JSON.parse(storage.getItem(TEACHING_SESSION_KEY)) || {};
    const token = startToken(search);
    if (token && token !== saved.startToken) return {};
    return typeof saved.code === 'string' && typeof saved.key === 'string' ? saved : {};
  } catch { return {}; }
}

export function saveTeachingSession(storage, room, search = '') {
  const token = startToken(search);
  const saved = { code: room.code, key: room.key, ...(token ? { startToken: token } : {}) };
  try { storage.setItem(TEACHING_SESSION_KEY, JSON.stringify(saved)); } catch { /* Reconnection still works in this mounted room. */ }
  return saved;
}
