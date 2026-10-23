import { Component, lazy } from 'react';

const RELOADED_AT = 'mpt-reloaded-for-update';

// After a deploy, a tab opened before it can ask for page code that no longer exists. Reload once
// onto the new version; if that was just tried, give up instead of reloading in a loop.
function reloadOnce() {
  try {
    if (Date.now() - Number(window.sessionStorage.getItem(RELOADED_AT) || 0) < 60 * 1000) return false;
    window.sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    // storage blocked: still try the one reload
  }
  window.location.reload();
  return true;
}

// A page whose code downloads the first time it is opened. Page.preload() starts the download
// early (a pointer over a link, say) without showing anything: if that early try fails, nothing
// happens, and only opening the page (below) reloads onto the new version.
export function lazyPage(load) {
  let pending = null;
  const fetchPage = () => {
    pending ||= load().catch((error) => {
      pending = null; // a later try fetches again
      throw error;
    });
    return pending;
  };
  const Page = lazy(() =>
    fetchPage().catch((error) => {
      if (reloadOnce()) return new Promise(() => {}); // reloading: keep showing the loading screen
      throw error;
    }),
  );
  Page.preload = () => {
    fetchPage().catch(() => {});
  };
  return Page;
}

// Shown while a page's code downloads. It fades in only after a moment, so a quick load shows nothing.
export function PageLoading() {
  return (
    <div className='grid min-h-dvh place-items-center' role='status' aria-label='Loading'>
      <span className='page-loading block h-8 w-8 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600' />
    </div>
  );
}

// If a page still can't load (no connection, say), offer a retry instead of a blank screen.
export class PageBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('Page failed:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className='grid min-h-dvh place-items-center px-6 text-center'>
        <div>
          <h1 className='text-xl font-bold text-slate-900'>This page didn’t load</h1>
          <p className='mt-2 text-slate-600'>Check your connection, then try again.</p>
          <button
            type='button'
            onClick={() => window.location.reload()}
            className='mt-5 rounded-full bg-violet-600 px-5 py-2.5 font-semibold text-white hover:bg-violet-700'
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
