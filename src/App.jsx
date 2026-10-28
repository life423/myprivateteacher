import { Suspense, useEffect } from 'react';
import { setPreloader, useRoute } from './router.jsx';
import LandingPage from './landing/LandingPage.jsx';
import { PageBoundary, PageLoading, lazyPage } from './lazyPage.jsx';
import { isRoomCode } from './whiteboard/stage.js';

const SITE = 'My Private Teacher';

// Every page but the landing page downloads the first time it is opened, so a first visit
// only loads what it shows.
const ActivityChooser = lazyPage(() => import('./landing/ActivityChooser.jsx'));
const LoginPage = lazyPage(() => import('./account/LoginPage.jsx'));
const TrialPage = lazyPage(() => import('./account/TrialPage.jsx'));
const BillingDonePage = lazyPage(() => import('./account/BillingDonePage.jsx'));
const TeachGate = lazyPage(() => import('./account/TeachGate.jsx'));
const AdminPage = lazyPage(() => import('./admin/AdminPage.jsx'));
const TermsPage = lazyPage(() => import('./legal/TermsPage.jsx'));
const PrivacyPage = lazyPage(() => import('./legal/PrivacyPage.jsx'));
const ArticulationGallery = lazyPage(() => import('./dev/ArticulationGallery.jsx'));
const ArticulationCardsGallery = lazyPage(() => import('./dev/ArticulationCardsGallery.jsx'));
const PhonemeArticulationGallery = lazyPage(() => import('./dev/PhonemeArticulationGallery.jsx'));
const PhonemeArticulationPage = lazyPage(() =>
  import('./dev/PhonemeArticulationGallery.jsx').then((m) => ({ default: m.PhonemeArticulationPage })),
);
const ArticulationCardPage = lazyPage(() =>
  import('./dev/ArticulationCardsGallery.jsx').then((m) => ({ default: m.ArticulationCardPage })),
);
const PhonemeSeparationGame = lazyPage(() => import('./phoneme-pop/components/PhonemeSeparationGame.jsx'));
const BridgeSolo = lazyPage(() => import('./bridge/BridgeSolo.jsx'));
const WhiteboardLobby = lazyPage(() => import('./whiteboard/WhiteboardLobby.jsx'));
const TutorRoom = lazyPage(() => import('./whiteboard/TutorRoom.jsx'));
const StudentRoom = lazyPage(() => import('./whiteboard/StudentRoom.jsx'));

// The page for a path: its title, what to show, and the code it needs (fetched together, not one after another).
function page(path) {
  const one = (title, Page, props = {}) => ({ title, needs: [Page], element: <Page {...props} /> });
  if (path.startsWith('/dev/phoneme-articulation/')) return one('Phoneme articulation card', PhonemeArticulationPage, { id: path.split('/').pop() });
  if (path === '/dev/phoneme-articulation') return one('Phoneme articulation cards', PhonemeArticulationGallery);
  if (path.startsWith('/dev/articulation-cards/')) return one('Articulation card', ArticulationCardPage, { id: path.split('/').pop() });
  if (path === '/dev/articulation-cards') return one('Articulation cards', ArticulationCardsGallery);
  if (path === '/dev/articulation') return one('Articulation gallery', ArticulationGallery);
  if (path === '/login') return one('Sign in', LoginPage);
  if (path === '/admin') return one('Admin', AdminPage);
  if (path === '/terms') return one('Terms of Service', TermsPage);
  if (path === '/privacy') return one('Privacy Policy', PrivacyPage);
  if (path === '/account') return one('Your account', LoginPage);
  if (path === '/trial') return one('Start your free trial', TrialPage);
  if (path === '/billing/done') return one('Welcome', BillingDonePage);
  if (path === '/activities') return one('Activities', ActivityChooser);
  if (path === '/phoneme-pop') return one('Phoneme Pop', PhonemeSeparationGame);
  // Alphabet Bridge is run from the whiteboard; this is solo practice
  if (path === '/bridge') return one('Alphabet Bridge', BridgeSolo);
  // A student on the join page needs the lesson next: fetch it while they type the code.
  if (path === '/whiteboard') return { ...one('Alphabet Whiteboard', WhiteboardLobby), soon: [StudentRoom] };
  if (path === '/whiteboard/teach') {
    return {
      title: 'Alphabet Whiteboard',
      needs: [TeachGate, TutorRoom],
      element: (
        <TeachGate>
          <TutorRoom />
        </TeachGate>
      ),
    };
  }
  const code = path.startsWith('/whiteboard/') ? path.slice('/whiteboard/'.length) : '';
  if (isRoomCode(code)) return { title: 'Alphabet Whiteboard', needs: [StudentRoom], element: <StudentRoom key={code} code={code} /> };
  return { title: null, needs: [], element: <LandingPage /> };
}

// Links start fetching their page's code as soon as a pointer or finger is on them.
setPreloader((to) => {
  if (typeof to !== 'string' || !to.startsWith('/')) return; // only this site's pages
  page(new URL(to, window.location.origin).pathname).needs.forEach((Page) => Page.preload());
});

export default function App() {
  const path = useRoute();
  const { title, needs, element, soon = [] } = page(path);
  needs.forEach((Page) => Page.preload()); // all of a page's code at once
  useEffect(() => {
    document.title = title ? `${title} · ${SITE}` : SITE;
  }, [title]);
  // The page that usually comes next, fetched in the background once this one is up.
  useEffect(() => {
    if (!soon.length) return undefined;
    const timer = setTimeout(() => soon.forEach((Page) => Page.preload()), 800);
    return () => clearTimeout(timer);
  }, [path]);
  // The Suspense boundary stays put across pages, so the current page stays on screen while the
  // next one's code downloads; the error boundary starts fresh on each page.
  return (
    <Suspense fallback={<PageLoading />}>
      <PageBoundary key={path}>{element}</PageBoundary>
    </Suspense>
  );
}
