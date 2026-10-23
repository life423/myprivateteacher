import { startTransition, useEffect, useState } from 'react';

// A tiny history-based router: a handful of pages doesn't need a library.
const listeners = new Set();

export function navigate(to, { replace = false } = {}) {
  window.history[replace ? 'replaceState' : 'pushState'](null, '', to);
  listeners.forEach((listener) => listener());
  window.scrollTo(0, 0);
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
    const update = () => startTransition(() => setPath(window.location.pathname));
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
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
