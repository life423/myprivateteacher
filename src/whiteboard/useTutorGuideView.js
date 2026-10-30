import { useCallback, useLayoutEffect, useRef, useState } from 'react';

// Docking the tutor guide temporarily fits this screen's board. A view chosen
// while teaching (pan, zoom, worksheet focus) takes precedence over restoration.
// Stage is keyed by page/epoch, so a lease can never restore another page's view.
export function useTutorGuideView(active = false) {
  const [view, updateView] = useState(null);
  const current = useRef(view), revision = useRef(0), lease = useRef(null);
  current.current = view;
  const setView = useCallback(next => {
    revision.current++;
    updateView(next);
  }, []);
  useLayoutEffect(() => {
    if (active) {
      lease.current = { view: current.current, revision: revision.current };
      updateView(null);
    } else if (lease.current) {
      const previous = lease.current;
      lease.current = null;
      if (revision.current === previous.revision) updateView(previous.view);
    }
  }, [active]);
  return [view, setView];
}
