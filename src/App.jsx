import { useEffect } from 'react';
import { useRoute } from './router.jsx';
import ActivityChooser from './components/ActivityChooser.jsx';
import LandingPage from './landing/LandingPage.jsx';
import LoginPage from './account/LoginPage.jsx';
import ArticulationGallery from './dev/ArticulationGallery.jsx';
import ArticulationCardsGallery, { ArticulationCardPage } from './dev/ArticulationCardsGallery.jsx';
import PhonemeSeparationGame from './components/PhonemeSeparationGame.jsx';
import WhiteboardLobby from './whiteboard/WhiteboardLobby.jsx';
import TutorRoom from './whiteboard/TutorRoom.jsx';
import StudentRoom from './whiteboard/StudentRoom.jsx';
import { isRoomCode } from './whiteboard/stage.js';

const SITE = 'My Private Teacher';

function page(path) {
  if (path.startsWith('/dev/articulation-cards/')) {
    return { title: 'Articulation card', element: <ArticulationCardPage id={path.split('/').pop()} /> };
  }
  if (path === '/dev/articulation-cards') return { title: 'Articulation cards', element: <ArticulationCardsGallery /> };
  if (path === '/dev/articulation') return { title: 'Articulation gallery', element: <ArticulationGallery /> };
  if (path === '/login') return { title: 'Sign in', element: <LoginPage /> };
  if (path === '/activities') return { title: 'Activities', element: <ActivityChooser /> };
  if (path === '/phoneme-pop') return { title: 'Phoneme Pop', element: <PhonemeSeparationGame /> };
  if (path === '/whiteboard') return { title: 'Alphabet Whiteboard', element: <WhiteboardLobby /> };
  if (path === '/whiteboard/teach') return { title: 'Alphabet Whiteboard', element: <TutorRoom /> };
  const code = path.startsWith('/whiteboard/') ? path.slice('/whiteboard/'.length) : '';
  if (isRoomCode(code)) return { title: 'Alphabet Whiteboard', element: <StudentRoom key={code} code={code} /> };
  return { title: null, element: <LandingPage /> };
}

export default function App() {
  const { title, element } = page(useRoute());
  useEffect(() => {
    document.title = title ? `${title} · ${SITE}` : SITE;
  }, [title]);
  return element;
}
