import { readingRectangle, settleReadingFrame } from './readingFocus.js';
import LessonPanel from '../lessons/LessonPanel.jsx';
import TutorGuide from '../lessons/TutorGuide.jsx';
import { useLessonRunner } from '../lessons/useLessonRunner.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Crosshair, Eraser, Eye, EyeOff, LayoutGrid, MousePointer2, Pencil, Trash2, Undo2 } from 'lucide-react';
import BridgeBoard from '../bridge/BridgeBoard.jsx';
import TutorGamesPanel from './TutorGamesPanel.jsx';
import MaterialsWorkspace from './MaterialsWorkspace.jsx';
import PhonemeBoard from '../phoneme-pop/components/PhonemeBoard.jsx';
import { usePhonemeTutor } from '../phoneme-pop/game/usePhonemeTutor.js';
import { useTutorBridge } from '../bridge/useTutorBridge.js';
import { navigate } from '../router.jsx';
import { useRealtime } from './useRealtime.js';
import { useFrameState, useWhiteboard } from './useWhiteboard.js';
import Stage from './Stage.jsx';
import BoardPages from './BoardPages.jsx';
import { INK } from './board.js';
import { STAGE } from './stage.js';
import { useHands } from './useHands.js';
import WhiteboardLayout from './WhiteboardLayout.jsx';
import AlphabetBar from './AlphabetBar.jsx';
import { ClearButton, HandsSwitch, LinesButton, Switch, ToolButton, ToolRail } from './Toolbar.jsx';
import { isLineSize } from '../../shared/lines.js';
import TileBar from './TileBar.jsx';
import PicturesPanel, { PictureDrawer } from './PicturesPanel.jsx';
import { pictureUrl } from './pictures.js';
import { cleanPictureLibraryView, loadPictureLibraryView, savePictureLibraryView } from './pictureLibraryView.js';
import { LessonGate } from '../account/TeachGate.jsx';
import { useVideoCall } from './useVideoCall.js';
import { CopyButton, FocusButton, MessageScreen, StageNotice, StatusPill, TopBar } from './ui.jsx';

const SAVED = 'wb-tutor';
const round4 = (n) => Math.round(n * 10000) / 10000;
const ACTIVITY = { pen: 'Student is writing', eraser: 'Student is erasing' };

function loadSaved() {
  try {
    return JSON.parse(sessionStorage.getItem(SAVED)) || {};
  } catch {
    return {};
  }
}

const LINES_KEY = 'mpt.writingLines';
const rememberedLines = () => {
  try {
    const size = window.localStorage.getItem(LINES_KEY);
    return isLineSize(size) ? size : null;
  } catch {
    return null;
  }
};

// The controls are grouped by the tutor's task, with current states in plain text.
// All settings remain in the room; this component only presents the existing actions.
export function TutorLessonControls({ studentTools, onStudentTools, hands, onHands, lines, onLines, strip, onStrip, pointing, activity, showStudentView, onStudentView, studentHere, onShareView, onFocus }) {
  const switchRow = 'flex min-h-11 items-center justify-between gap-2 [&>button]:min-h-11 [&>button]:min-w-0 [&>button]:flex-1 [&>button]:rounded-lg';
  return (
    <div className='w-full space-y-4'>
      <section aria-label='Student participation'>
        <h3 className='mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500'>Student participation</h3>
        <div className={switchRow}>
          <Switch checked={studentTools} onChange={onStudentTools} label='Student tools' />
          <span aria-hidden='true' className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${studentTools ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>{studentTools ? 'On' : 'Off'}</span>
        </div>
      </section>
      <section aria-label='Board appearance'>
        <h3 className='mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500'>Board appearance</h3>
        <div className='space-y-2'>
          <div className='flex min-h-11 items-center justify-between gap-3'>
            <div className='min-w-0'>
              <p className='text-sm font-semibold text-slate-700'>Hands</p>
              <p role='status' aria-live='off' className='mt-0.5 text-xs leading-5 text-slate-500'>
                {activity || <>Pointing at <strong className='font-bold text-violet-700'>{pointing || '–'}</strong></>}
              </p>
            </div>
            <div className='shrink-0 [&_[role=group]]:w-24 [&_[role=group]]:p-0 [&_[role=group]>div]:gap-1 [&_[role=group]>span]:hidden [&_button]:min-w-11'>
              <HandsSwitch hands={hands} onToggle={onHands} />
            </div>
          </div>
          <div className='py-1'>
            <LinesButton inline size={lines} onChoose={onLines} />
          </div>
          <div className={switchRow}>
            <Switch checked={strip} onChange={onStrip} label='Alphabet strip' />
            <span aria-hidden='true' className='shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600'>{strip ? 'On' : 'Off'}</span>
          </div>
        </div>
      </section>
      <section aria-label='View together'>
        <h3 className='mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500'>View together</h3>
        <div className='space-y-2'>
          <button
            type='button'
            aria-pressed={showStudentView}
            aria-label='Outline what the student can see'
            title={showStudentView ? 'Hide the outline of what the student can see' : 'Outline what the student can see'}
            onClick={onStudentView}
            className={`flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none ${showStudentView ? 'border-violet-200 bg-violet-50 text-violet-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
          >
            {showStudentView ? <Eye className='h-4 w-4 shrink-0' aria-hidden='true' /> : <EyeOff className='h-4 w-4 shrink-0' aria-hidden='true' />}
            <span className='min-w-0 flex-1'>Student view outline</span>
            <span aria-hidden='true' className='text-xs'>{showStudentView ? 'On' : 'Off'}</span>
          </button>
          <div>
            <button
              type='button'
              disabled={!studentHere}
              aria-label='Show my view to student'
              aria-describedby={!studentHere ? 'student-view-sharing-help' : undefined}
              title={studentHere ? 'Bring student to my view' : 'Connect a student to share your view'}
              onClick={onShareView}
              className='flex min-h-11 w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm font-semibold text-slate-700 transition-colors duration-150 hover:bg-violet-50 disabled:cursor-not-allowed disabled:text-slate-400 motion-reduce:transition-none'
            >
              <Crosshair className='h-4 w-4 shrink-0' aria-hidden='true' />
              Bring student to my view
            </button>
            {!studentHere && <p id='student-view-sharing-help' className='mt-1 px-3 text-xs leading-5 text-slate-500'>Connect a student to share your view</p>}
          </div>
          <div className='[&>button]:min-h-11 [&>button]:w-full [&>button]:justify-start [&>button]:gap-2 [&>button]:rounded-lg [&>button]:border-slate-200 [&>button]:px-3 [&>button]:py-2'>
            <FocusButton onClick={onFocus} />
          </div>
        </div>
      </section>
    </div>
  );
}

export default function TutorRoom() {
  const [room, setRoom] = useState(loadSaved); // { code, key } once the server hands them out
  const [studentHere, setStudentHere] = useState(false);
  const [studentTools, setStudentTools] = useState(false);
  const [tool, setTool] = useState('none');
  const [busy, setBusy] = useState(false);
  const [gated, setGated] = useState(null); // why the server won't start a lesson ('sign-in', 'plan')
  const [tip, setTip] = useState(null);
  const [selectedTileId, setSelectedTileId] = useState(null); // clicked, ready to change
  const [activePanel, setActivePanel] = useState(null);
  const layout = useRef(null); // the shared layout: open a panel, focus mode
  // Zoom and pan are each screen's own. This outlines what the student's screen shows, and
  // 'Show my view to student' brings their screen to the part of the board shown here.
  const [studentView, setStudentView] = useState(null);
  const [showStudentView, setShowStudentView] = useState(true);
  const myView = useRef(null);
  const stageApi = useRef(null);
  const barApi = useRef(null); // the phone alphabet bar, for hands dragged between it and the board
  const [browsing, setBrowsing] = useState(false); // the picture library slide-out
  const [picturePreviewOpen, setPicturePreviewOpen] = useState(false);
  const [pictureOpenRequest, setPictureOpenRequest] = useState(null);
  const [gamesOpen, setGamesOpen] = useState(false);
  const [lessonOpen, setLessonOpen] = useState(() => Boolean(new URLSearchParams(window.location.search).get('lesson')));
  const guideTrigger = useRef(null);
  const openPicture = (request) => { setPictureOpenRequest({ ...request, n: Date.now() }); setBrowsing(true); };
  const [pictureLibraryView, setPictureLibraryView] = useState(loadPictureLibraryView);
  const updatePictureLibraryView = useCallback((patch) => setPictureLibraryView((current) => {
    const next = cleanPictureLibraryView({ ...current, ...patch });
    return Object.keys(next).every((key) => next[key] === current[key]) ? current : next;
  }), []);
  useEffect(() => { savePictureLibraryView(pictureLibraryView); }, [pictureLibraryView]);
  const closePictureLibrary = () => { setBrowsing(false); setPicturePreviewOpen(false); setPictureOpenRequest(null); };
  const [studentBrowse, setStudentBrowse] = useState({ open: false, pic: null }); // where the student is browsing
  const [guidePic, setGuidePic] = useState(null); // the picture this tutor is pointing at
  // The picture library, which this tutor's live room can draw from.
  const [library, setLibrary] = useState([]);
  const [libraryState, setLibraryState] = useState({ status: 'waiting' });
  // Saved room credentials are not authorized until this connection's room reply.
  const [confirmedRoom, setConfirmedRoom] = useState(null);
  const [libraryAttempt, setLibraryAttempt] = useState(0);
  const retryLibrary = useCallback(() => setLibraryAttempt((attempt) => attempt + 1), []);
  // One private object URL per image per room, shared by the panel and drawer.
  // Lazy thumbnail components request an image only when it approaches the viewport.
  const libraryPreviews = useMemo(() => new Map(), [room.code, room.key]);
  useEffect(() => () => {
    for (const preview of libraryPreviews.values()) {
      preview.cancelled = true;
      preview.controller.abort();
      if (preview.url) URL.revokeObjectURL(preview.url);
    }
    libraryPreviews.clear();
  }, [libraryPreviews]);
  const loadLibraryImage = useCallback((id) => {
    if (!room.code || !room.key) return Promise.reject(new Error('The lesson is reconnecting.'));
    if (libraryPreviews.has(id)) return libraryPreviews.get(id).promise;
    const preview = { controller: new AbortController(), cancelled: false, url: null };
    preview.promise = fetch(`/api/rooms/${room.code}/library/${encodeURIComponent(id)}/image`, {
      headers: { 'X-Room-Key': room.key }, signal: preview.controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('The picture could not be loaded.');
      const blob = await response.blob();
      if (preview.cancelled) throw new Error('The lesson changed.');
      preview.url = URL.createObjectURL(blob);
      return preview.url;
    }).catch((error) => {
      if (libraryPreviews.get(id) === preview) libraryPreviews.delete(id);
      throw error;
    });
    libraryPreviews.set(id, preview);
    return preview.promise;
  }, [libraryPreviews, room.code, room.key]);

  const [studentMarker, setStudentMarker] = useFrameState(null);
  const [myMarker, setMyMarker] = useFrameState(null);
  const roomRef = useRef(room);
  const studentToolsRef = useRef(studentTools);
  const sendRef = useRef(() => {});
  const lastPoint = useRef(null);
  const tipShown = useRef(false);
  roomRef.current = room;
  studentToolsRef.current = studentTools;

  const wb = useWhiteboard('tutor', (msg) => sendRef.current(msg));
  const pageScope = wb.pageScope();
  const pageSend = (message, origin = pageScope) => wb.sendPageMessage(message, origin);
  const pendingLines = useRef(null);
  const pendingHands = useRef(null);
  const currentPageContext = (origin) => Boolean(wb.scopeMessage({ t: 'game', game: null }, origin));
  const chooseLines = (size) => {
    wb.setLines(size);
    try {
      window.localStorage.setItem(LINES_KEY, size);
    } catch {
      // storage blocked: the choice lasts for this lesson
    }
  };
  const hands = useHands({ me: 'tutor', send: pageSend, sendThrottled: wb.sendThrottled, cancelThrottled: wb.cancelThrottled });
  const call = useVideoCall('tutor', (msg) => sendRef.current(msg));
  const bridge = useTutorBridge(pageSend, { context: pageScope, isCurrentContext: currentPageContext });
  const phoneme = usePhonemeTutor(pageSend, { context: pageScope, isCurrentContext: currentPageContext });

  const { status, send } = useRealtime({
    // Asking for the saved code again lets a refresh or a deploy keep the same room.
    hello: () => ({ t: 'create', code: roomRef.current.code, key: roomRef.current.key, pageProtocol: 1 }),
    onMessage: (msg) => {
      if (call.handle(msg)) return;
      const before = wb.pageScope();
      if (!wb.acceptMessage(msg)) return;
      if (msg.t === 'board') {
        const changed = msg.pageId && (before?.pageId !== msg.pageId || before?.pageEpoch !== msg.pageEpoch);
        if (changed) {
          stageApi.current?.cancelInteractions('authority');
          setSelectedTileId(null); setStudentMarker(null); setMyMarker(null);
          setStudentView(null); myView.current = null;
          setGuidePic(null); setPictureOpenRequest(null); setPicturePreviewOpen(false); setBrowsing(false);
          setTool('none');
        }
        wb.handle(msg);
        wb.retainPictures?.(roomRef.current);
        hands.handle(msg);
        bridge.handle(msg);
        phoneme.handle(msg);
        setStudentTools(Boolean(msg.tools));
        if (pendingLines.current) {
          wb.sendPageMessage({ t: 'lines:set', size: pendingLines.current }, { pageId: msg.pageId, pageEpoch: msg.pageEpoch });
          pendingLines.current = null;
        }
        if (pendingHands.current) {
          wb.sendPageMessage({ t: 'hands', ...pendingHands.current }, { pageId: msg.pageId, pageEpoch: msg.pageEpoch });
          pendingHands.current = null;
        }
        return;
      }
      bridge.handle(msg);
      phoneme.handle(msg);
      if (hands.handle(msg)) return;
      if (wb.handle(msg)) return;
      if (msg.t === 'browse') return setStudentBrowse({ open: msg.open === true, pic: msg.pic || null });
      if (msg.t === 'view') return setStudentView({ x: msg.x, y: msg.y, w: msg.w, h: msg.h });
      if (msg.t === 'room') {
        const isNew = !roomRef.current.code;
        const saved = { code: msg.code, key: msg.key };
        roomRef.current = saved;
        sessionStorage.setItem(SAVED, JSON.stringify(saved));
        setRoom(saved);
        setConfirmedRoom(saved);
        // The server restarted and forgot this room: hand it our copy of the board.
        if (isNew) pendingLines.current = rememberedLines();
        if (msg.fresh) {
          pendingHands.current = { r: hands.hands.r.on, l: hands.hands.l.on, at: Object.fromEntries(['l', 'r'].map((side) => [side, { x: round4(hands.hands[side].x / STAGE.width), y: round4(hands.hands[side].y / STAGE.height), letter: hands.hands[side].letter }])) };
          if (msg.restoring === true || msg.restoring === undefined) wb.restore(studentToolsRef.current, saved);
        }
      } else if (msg.t === 'tools') {
        setStudentTools(Boolean(msg.on));
      } else if (msg.t === 'presence') {
        if (msg.student && !studentHere) {
          if (!tipShown.current) {
            tipShown.current = true;
            setTip('Tip: drag a hand to point at a letter');
          }
        }
        if (!msg.student) {
          setStudentMarker(null);
          call.peerGone();
        }
        setStudentHere(msg.student);
      } else if (msg.t === 'p') {
        setStudentMarker(
          msg.m === 'none'
            ? null
            : { kind: msg.m, by: 'student', x: msg.x * STAGE.width, y: msg.y * STAGE.height, smooth: true },
        );
      } else if (msg.t === 'error' && msg.reason === 'busy') {
        setBusy(true);
      } else if (msg.t === 'error' && ['sign-in', 'plan', 'unavailable'].includes(msg.reason)) {
        // The server won't start a new lesson for this tutor yet: say what's missing.
        sessionStorage.removeItem(SAVED);
        setGated(msg.reason);
      }
    },
  });
  sendRef.current = send;
  const lessonRunner = useLessonRunner(wb, room, status === 'open' && Boolean(confirmedRoom), {
    onLessonOpen: () => setLessonOpen(true),
    onReadReady: async (piece, current, origin) => {
      const rect = readingRectangle(piece);
      if (!rect || !current()) return false;
      layout.current?.closeSheet();
      if (!(await settleReadingFrame(stageApi, current)) || !current()) return false;
      if (!stageApi.current?.showRect(rect)) return false;
      wb.sendPageMessage({ t: 'focus', ...rect, reading: true }, origin);
      return true;
    },
  });
  useEffect(() => {
    if (status !== 'open') { hands.disconnect(); wb.disconnect(); }
  }, [status, hands.disconnect, wb.disconnect]);

  // Message screens keep this room mounted, so unmount cleanup alone cannot
  // release a camera or a pending permission request when the seat is replaced.
  const callEnded = status === 'replaced' || Boolean(gated) || busy;
  useEffect(() => {
    if (callEnded) call.stop();
  }, [callEnded]);

  useEffect(() => {
    if (status !== 'open') {
      setConfirmedRoom(null);
      wb.cancelPictureWrites();
    }
  }, [status, wb.cancelPictureWrites]);

  // A WebSocket opening is not enough: wait for the server to confirm the room.
  // Rejoining after a restart gets a new confirmation and reloads the catalog.
  useEffect(() => {
    if (status !== 'open' || !confirmedRoom?.code || !confirmedRoom?.key) {
      setLibraryState({ status: 'waiting' });
      return undefined;
    }
    const controller = new AbortController();
    let live = true;
    let timedOut = false;
    setLibraryState({ status: 'loading' });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 50000);
    fetch(`/api/rooms/${confirmedRoom.code}/library`, {
      headers: { 'X-Room-Key': confirmedRoom.key }, signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('The picture library could not be loaded.');
      const data = await response.json();
      if (!Array.isArray(data.cards)) throw new Error('The picture library could not be loaded.');
      if (live) {
        setLibrary(data.cards);
        setLibraryState({ status: 'ready' });
      }
    }).catch(() => {
      if (live) setLibraryState({ status: 'error', message: timedOut
        ? 'The picture library is taking too long to respond. Please try again.'
        : 'The picture library could not be loaded. Please try again.' });
    }).finally(() => clearTimeout(timeout));
    return () => {
      live = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [confirmedRoom, status, libraryAttempt]);

  useEffect(() => {
    if (!tip) return undefined;
    const timer = setTimeout(() => setTip(null), 5000);
    return () => clearTimeout(timer);
  }, [tip]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return; // leave typing alone
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        wb.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wb.undo]);

  if (status === 'replaced') {
    return <MessageScreen title='Open somewhere else'>This session is now running in another tab or window.</MessageScreen>;
  }
  if (gated) return <LessonGate reason={gated} />;
  if (busy) {
    return <MessageScreen title='The whiteboard is busy'>Too many sessions are open right now. Try again in a minute.</MessageScreen>;
  }

  const endSession = () => {
    // Ask the dirty-note guard first. Cancelling must leave the live room open.
    if (!navigate('/whiteboard')) return;
    send({ t: 'end' });
    sessionStorage.removeItem(SAVED);
  };

  // Shows your pointer here and on the student's screen.
  const share = (p, mode) => {
    lastPoint.current = p;
    setMyMarker({ kind: mode, by: 'tutor', x: p.x, y: p.y });
    wb.sendPointer({ t: 'p', x: round4(p.x / STAGE.width), y: round4(p.y / STAGE.height), m: mode });
  };

  const chooseTool = (next) => {
    setTool(next);
    if (next === 'none') {
      setMyMarker(null);
      wb.sendPointer({ t: 'p', m: 'none' });
      return;
    }
    const p = lastPoint.current;
    if (p) share(p, next);
  };

  const onPoint = (p) => share(p, tool);

  const onLeave = () => {
    setMyMarker(null);
    wb.sendPointer({ t: 'p', m: 'none' });
  };

  // One game at a time: starting one puts the other away
  const startBridge = () => {
    if (phoneme.active) phoneme.stop();
    bridge.start();
  };
  const startPhoneme = () => {
    if (bridge.game) bridge.stop();
    phoneme.start();
  };

  let pill = <StatusPill tone='wait'>Waiting for student</StatusPill>;
  if (status !== 'open') pill = <StatusPill tone='bad'>Reconnecting…</StatusPill>;
  else if (studentHere) pill = <StatusPill tone='good'>Student connected</StatusPill>;

  const pointing = hands.letters.join(' ') || null; // the letters under the two hands
  const activity = studentMarker && ACTIVITY[studentMarker.kind];
  const markers = [studentMarker && { key: 'student', ...studentMarker }, myMarker && { key: 'me', ...myMarker }].filter(Boolean);

  // The Pictures panel's settings, shared by the side column (or sheet) and the slide-out.
  const pictureProps = {
    pictures: wb.pictures,
    srcFor: (id) => pictureUrl(room.code, id),
    canAdd: true,
    uploadsReady: status === 'open' && Boolean(confirmedRoom),
    onAddFile: (file, options) => wb.addPicture(file, status === 'open' ? confirmedRoom : null, options),
    onAddPreparedPicture: (image, options) => wb.addPreparedPicture(image, status === 'open' ? confirmedRoom : null, options),
    pdfWriteContext: status === 'open' && confirmedRoom ? wb.pictureWriteContext : null,
    onClear: wb.clearPictures,
    library,
    libraryState,
    onRetryLibrary: retryLibrary,
    loadLibraryImage,
    onAddFromLibrary: (card) => wb.addLibraryCard(card, room),
    onGiveAll: (cards) => wb.addLibraryCards(cards, room),
    offers: wb.offers,
    onOffer: wb.offerActions.give,
    onWithdraw: wb.offerActions.withdraw,
    onReset: wb.offerActions.reset,
    onPlace: wb.pieceActions.add,
    stageApi,
    guidePic,
    onGuide: (pic) => {
      setGuidePic(pic);
      pageSend({ t: 'guide', pic });
    },
    peerPic: studentHere && studentBrowse.open ? studentBrowse.pic : null,
  };
  const studentPicTitle = wb.pictures.find((p) => p.id === studentBrowse.pic)?.title;
  const studentBrowsing = studentHere && studentBrowse.open;
  const browseText = studentPicTitle ? `Your student is looking at ${studentPicTitle}.` : 'Your student opened the picture library.';

  const pageControls = <BoardPages pages={wb.pages} pageId={wb.pageId} actions={wb.pageActions} ready={wb.pageReady} pending={wb.pagePending} error={wb.pageError} onRetry={() => wb.restore(studentToolsRef.current, roomRef.current)} />;

  const pictureLibraryShortcut = (compact = false) => (
    <button
      type='button'
      aria-label='Picture library'
      title='Open picture library'
      aria-haspopup='dialog'
      aria-expanded={browsing}
      aria-controls='tutor-picture-library'
      onClick={() => setBrowsing(true)}
      className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 text-sm font-bold text-violet-800 hover:border-violet-400 hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${compact ? 'gap-1.5 px-2' : 'gap-2 px-3'}`}
    >
      <LayoutGrid className='h-5 w-5' aria-hidden='true' />
      <span className={compact ? lessonRunner.lesson ? 'hidden xl:inline' : 'hidden md:inline' : ''}>Pictures</span>
    </button>
  );

  const guideShortcut = () => lessonRunner.lesson && <button ref={guideTrigger} type='button' aria-label='Tutor guide' aria-expanded={lessonOpen} aria-controls='tutor-guide' onClick={() => setLessonOpen(open => !open)} className='inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-2 text-sm font-bold text-violet-800 hover:bg-violet-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500'><BookOpen className='hidden h-4 w-4 xl:block' aria-hidden='true' /><span className='xl:hidden'>Guide</span><span className='hidden xl:inline'>Tutor guide</span></button>;

  return (
    <>
    <WhiteboardLayout
      guideOpen={lessonOpen}
      persistentControls={<>{pictureLibraryShortcut()}{guideShortcut()}</>}
      header={
        <TopBar
          title='Alphabet Whiteboard'
          menuSummary={<span className={`rounded-md px-2 py-1 text-xs font-semibold ${studentTools ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>Student tools {studentTools ? 'on' : 'off'}</span>}
          menu={<TutorLessonControls
            studentTools={studentTools}
            onStudentTools={(on) => send({ t: 'tools', on })}
            hands={hands.hands}
            onHands={hands.show}
            lines={wb.lines}
            onLines={chooseLines}
            strip={wb.strip}
            onStrip={wb.setStrip}
            pointing={pointing}
            activity={activity}
            showStudentView={showStudentView}
            onStudentView={() => setShowStudentView((was) => !was)}
            studentHere={studentHere}
            onShareView={() => myView.current && pageSend({ t: 'focus', ...myView.current })}
            onFocus={() => layout.current?.setFocus(true)}
          />}
          end={
            <button
              type='button'
              onClick={endSession}
              className='shrink-0 rounded-full bg-slate-800 px-3 py-2 text-sm font-bold text-white hover:bg-slate-900 sm:px-4'
            >
              End session
            </button>
          }
        >
          <div className='flex shrink-0 items-center gap-2'>
            <span title='Room code' className='rounded-lg bg-violet-600 px-2 py-1 font-mono text-xl font-bold tracking-wider text-white sm:px-3 sm:text-2xl sm:tracking-widest'>
              {room.code || '····'}
            </span>
            {room.code && <span className={lessonRunner.lesson ? 'max-[359px]:hidden' : ''}><CopyButton compact text={`${window.location.origin}/whiteboard/${room.code}`} label='Copy lesson link' /></span>}
          </div>
          <span className={lessonRunner.lesson ? 'max-md:sr-only' : 'contents'}>{pill}</span>
          {pictureLibraryShortcut(true)}
          {guideShortcut()}
        </TopBar>
      }
      tools={!(bridge.game || phoneme.active) && (
        <ToolRail label='Your tools'>
          <ToolButton icon={MousePointer2} label='Select' pressed={tool === 'none'} onClick={() => chooseTool('none')} />
          <ToolButton
            icon={Pencil}
            label='Draw'
            swatch={INK.tutor}
            pressed={tool === 'pen'}
            onClick={() => chooseTool(tool === 'pen' ? 'none' : 'pen')}
          />
          <ToolButton
            icon={Eraser}
            label='Erase'
            pressed={tool === 'eraser'}
            onClick={() => chooseTool(tool === 'eraser' ? 'none' : 'eraser')}
          />
          <ToolButton icon={Undo2} label='Undo' disabled={!wb.canUndo} onClick={wb.undo} />
          <ClearButton icon={Trash2} onClear={() => pageSend({ t: 'clear' })} />
        </ToolRail>
      )}
      board={
        bridge.game ? (
          <div className='flex h-full min-h-0 flex-col'><div className='flex min-h-0 flex-1 items-center justify-center overflow-auto p-2'>
            <BridgeBoard game={bridge.game} selected={bridge.selected} onSelect={bridge.setSelected} onPlace={bridge.place} />
          </div><div className='flex h-11 shrink-0 items-center border-t border-slate-200 bg-slate-50 px-1'>{pageControls}</div></div>
        ) : phoneme.active ? (
          <div className='flex h-full min-h-0 flex-col'><div className='min-h-0 flex-1'>
            <PhonemeBoard state={phoneme.state} total={phoneme.bank.words[phoneme.state.level]?.length ?? 0} onIntent={phoneme.act} />
          </div><div className='flex h-11 shrink-0 items-center border-t border-slate-200 bg-slate-50 px-1'>{pageControls}</div></div>
        ) : (
        <>
          <Stage
            key={`${wb.pageId}:${wb.pageEpoch}`}
            pageControls={pageControls}
            board={wb.board}
            me='tutor'
            strip={wb.strip}
            boxes={wb.boxes}
            boxTaps={wb.boxTaps}
            boxEpoch={wb.boxEpoch}
            onToggleSoundBox={wb.toggleSoundBox}
            canTapSoundBoxes
            lines={wb.lines}
            tiles={wb.tiles}
            selectedTile={selectedTileId}
            canManageTiles
            tileActions={{ ...wb.tileActions, select: (id) => { setSelectedTileId(id); if (id) chooseTool('none'); } }}
            pieces={wb.pieces}
            pictures={wb.pictures}
            pictureSrc={(id) => pictureUrl(room.code, id)}
            pieceActions={wb.pieceActions}
            canEditPieces
            canDeletePieces
            canDuplicatePieces
            onCropPiece={(piece) => openPicture({ id: piece.pic, pieceId: piece.id, crop: piece.crop })}
            onSelectPiece={() => setTool('none')}
            onView={(rect) => {
              myView.current = rect;
            }}
            peerView={showStudentView && studentHere ? studentView : null}
            stageApi={stageApi}
            letters={hands.letters}
            tool={tool}
            markers={markers}
            hands={hands.visible}
            handActions={hands}
            canHoldHands // a press on a glove holds it, whatever the tool
            barApi={barApi}
            onPoint={onPoint}
            onLeave={onLeave}
            onStroke={{ start: (p) => wb.stroke.start(tool, p), move: wb.stroke.move, end: wb.stroke.end }}
          />
          {!studentHere && room.code && (
            <StageNotice>Your student opens myprivateteacher.com and enters {room.code} in Join your lesson</StageNotice>
          )}
          {studentHere && tip && <StageNotice>{tip}</StageNotice>}
        </>
        )
      }
      call={call}
      peerName='your student'
      alphabet={wb.strip ? <AlphabetBar hands={hands.visible} me='tutor' canHold handActions={hands} api={barApi} stageApi={stageApi} /> : null}
      controls={layout}
      onPanelChange={setActivePanel}
      panels={[{
        id: 'materials', label: gamesOpen ? 'Games' : 'Materials', icon: LayoutGrid,
        content: <MaterialsWorkspace key={`tutor-${room.code || 'new'}-${room.key || 'pending'}`} scope={`tutor-${room.code || 'new'}-${room.key || 'pending'}`} tabs={[
          { id: 'letters', label: 'Letters', content: (query) => <TileBar embedded query={query} count={wb.tiles.length} selected={wb.tiles.find((tile) => tile.id === selectedTileId) || null} onAdd={wb.addTiles} onEdit={(text) => { const ok = wb.editTile(selectedTileId, text); if (ok) setSelectedTileId(null); return ok; }} onCancelEdit={() => setSelectedTileId(null)} onReset={wb.resetTiles} onClear={wb.clearTiles} boxes={wb.boxes} onBoxes={wb.setBoxes} boxTaps={wb.boxTaps} onResetSoundBoxes={wb.resetSoundBoxes} onShowSoundBoxes={!bridge.game && !phoneme.active ? () => stageApi.current?.showSoundBoxes() : null} /> },
          { id: 'pictures', label: 'Pictures', content: (query) => <PicturesPanel {...pictureProps} embedded searchQuery={query} showLibrary onViewPicture={openPicture} onBrowse={() => setBrowsing(true)} onShow={() => layout.current?.show('materials')} onPlaced={(options) => { if (!options?.keepOpen) layout.current?.closeSheet(); }} /> },
          { id: 'worksheets', label: 'Worksheets', content: (query) => <PicturesPanel {...pictureProps} embedded material='worksheet' searchQuery={query} onViewPicture={openPicture} onShow={() => layout.current?.show('materials')} onPlaced={(options) => { if (!options?.keepOpen) layout.current?.closeSheet(); }} /> },
        ]} lesson={{ open: false, onOpen: () => setLessonOpen(true), title: 'Tutor guide', detail: lessonRunner.lesson ? `${lessonRunner.lesson.title}${lessonRunner.index >= 0 ? ` · ${lessonRunner.index + 1}/${lessonRunner.lesson.activities.length}` : ''}` : null, content: null }} activity={{
          open: gamesOpen,
          onOpen: () => setGamesOpen(true),
          onClose: () => setGamesOpen(false),
          current: phoneme.active ? 'Phoneme Pop' : bridge.game ? 'Alphabet Bridge' : null,
          detail: phoneme.active ? `Level ${phoneme.state.level}` : bridge.game ? `${bridge.settings.length} letters` : null,
          content: <TutorGamesPanel bridge={bridge} phoneme={phoneme} startBridge={startBridge} startPhoneme={startPhoneme} visible={gamesOpen} />,
          quickAction: phoneme.active ? <button type='button' onClick={() => phoneme.act({ type: 'showNext' })} disabled={phoneme.state.phase !== 'tiles'} className='mt-1 min-h-11 w-full rounded-lg bg-violet-50 px-3 text-sm font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-40'>Next sound</button> : bridge.game ? <button type='button' onClick={bridge.showNext} className='mt-1 min-h-11 w-full rounded-lg bg-violet-50 px-3 text-sm font-semibold text-violet-800 hover:bg-violet-100'>Next gap</button> : null,
        }} />,
      }]}

    />
    <TutorGuide open={lessonOpen} onClose={() => setLessonOpen(false)} returnFocusRef={guideTrigger} actions={room.code && lessonRunner.lesson ? <span className='min-[360px]:hidden'><CopyButton compact text={`${window.location.origin}/whiteboard/${room.code}`} label='Copy lesson link' /></span> : null}>
      <LessonPanel runner={lessonRunner} />
    </TutorGuide>
    <PictureDrawer id='tutor-picture-library' open={browsing} onClose={closePictureLibrary} previewOpen={picturePreviewOpen} catalogReady={libraryState.status === 'ready'} catalogScrollTop={pictureLibraryView.scrollTop} onCatalogScroll={(scrollTop) => updatePictureLibraryView({ scrollTop })}>
      <PicturesPanel
        {...pictureProps}
        openPictureRequest={pictureOpenRequest}
        onCropPiece={wb.pieceActions.crop}
        onCancelCrop={() => setPictureOpenRequest(null)}
        layout='drawer'
        browseOnly
        catalogView={pictureLibraryView}
        onCatalogViewChange={updatePictureLibraryView}
        onViewerChange={setPicturePreviewOpen}
        showLibrary
        notice={studentBrowsing ? { text: browseText, tone: 'violet' } : { text: 'Add a library card to the board, or open a session picture to show your student.', tone: 'sky' }}
        onPlaced={(options) => { if (!options?.keepOpen) closePictureLibrary(); }}
      />
    </PictureDrawer>
    </>
  );
}
