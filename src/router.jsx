import { startTransition, useEffect, useRef, useState } from 'react';

// A tiny history-based router: a handful of pages doesn't need a library.
const listeners = new Set();
const guards = new Set();
const HISTORY_KEY = '__mptRoute';
const currentUrl = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
const position = () => window.history.state?.[HISTORY_KEY];
function ensurePosition() {
  if (!Number.isInteger(position())) window.history.replaceState({ ...window.history.state, [HISTORY_KEY]: 0 }, '', currentUrl());
}
// Preparation registers only while a draft has unsaved changes. Ordinary routes
// and modified/new-tab links retain their existing behavior.
export function registerNavigationGuard(guard) {
  guards.add(guard);
  return () => guards.delete(guard);
}
const canLeave = () => [...guards].every((guard) => guard());
export function useNavigationGuard(enabled, message = 'Discard unsaved changes?') {
  const latest = useRef({ enabled, message });
  latest.current = { enabled, message };
  useEffect(() => {
    const enabledNow = () => typeof latest.current.enabled === 'function' ? latest.current.enabled() : latest.current.enabled;
    const remove = registerNavigationGuard(() => !enabledNow() || window.confirm(latest.current.message));
    const unload = (event) => {
      if (!enabledNow()) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', unload);
    return () => { remove(); window.removeEventListener('beforeunload', unload); };
  }, []);
}

export function navigate(to, { replace = false } = {}) {
  if (to === currentUrl()) return true;
  if (!canLeave()) return false;
  ensurePosition();
  window.history[replace ? 'replaceState' : 'pushState']({ [HISTORY_KEY]: position() + (replace ? 0 : 1) }, '', to);
  listeners.forEach((listener) => listener());
  window.scrollTo(0, 0);
  return true;
}

// Starts fetching a page's code before it is opened (set by App).
let preload = () => {};
export function setPreloader(fn) {
  preload = fn;
}

export function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    // A transition: the current page stays on screen while the next one's code downloads.
    ensurePosition();
    let committed = { url: currentUrl(), index: position() }, restoring = false;
    const update = () => {
      committed = { url: currentUrl(), index: position() };
      startTransition(() => setPath(window.location.pathname));
    };
    const pop = () => {
      if (restoring) { restoring = false; return; }
      if (!canLeave()) {
        const target = position();
        if (Number.isInteger(target) && Number.isInteger(committed.index) && target !== committed.index) {
          restoring = true;
          window.history.go(committed.index - target);
        } else {
          // An older, untagged same-document entry has no reliable delta.
          window.history.replaceState({ ...window.history.state, [HISTORY_KEY]: committed.index }, '', committed.url);
        }
        return;
      }
      update();
    };
    listeners.add(update);
    window.addEventListener('popstate', pop);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', pop);
    };
  }, []);
  return path;
}

export function Link({ to, onClick, ...props }) {
  const warm = () => preload(to);
  return (
    <a
      href={to}
      onPointerEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
      }}
      {...props}
    />
  );
}
