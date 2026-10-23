import { useEffect, useRef, useState } from 'react';
import { Crosshair, Eraser, Eye, EyeOff, Image as ImageIcon, MousePointer2, Pencil, Trash2, Type, Undo2 } from 'lucide-react';
import { navigate } from '../router.jsx';
import { useRealtime } from './useRealtime.js';
import { useFrameState, useWhiteboard } from './useWhiteboard.js';
import Stage from './Stage.jsx';
import { INK } from './board.js';
import { STAGE, letterAt } from './stage.js';
import { useHands } from './useHands.js';
import WhiteboardLayout from './WhiteboardLayout.jsx';
import AlphabetBar from './AlphabetBar.jsx';
import { ClearButton, HandsSwitch, Switch, ToolButton, ToolRail } from './Toolbar.jsx';
import TileBar from './TileBar.jsx';
import PicturesPanel, { PictureDrawer } from './PicturesPanel.jsx';
import { pictureUrl } from './pictures.js';
import { LessonGate } from '../account/TeachGate.jsx';
import { useVideoCall } from './useVideoCall.js';
import { CopyButton, FocusButton, MessageScreen, StageNotice, StatusPill, TopBar } from './ui.jsx';

const SAVED = 'wb-tutor';
const round4 = (n) => Math.round(n * 10000) / 10000;
const ACTIVITY = { pen: 'Writing ✏️', eraser: 'Erasing 🧽' };

function loadSaved() {
  try {
    return JSON.parse(sessionStorage.getItem(SAVED)) || {};
  } catch {
    return {};
  }
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
  const layout = useRef(null); // the shared layout: open a panel, focus mode
  // Zoom and pan are each screen's own. This outlines what the student's screen shows, and
  // 'Show my view to student' brings their screen to the part of the board shown here.
  const [studentView, setStudentView] = useState(null);
  const [showStudentView, setShowStudentView] = useState(true);
  const myView = useRef(null);
  // Picking a tile to change opens the tiles panel (on narrower screens, its sheet).
  useEffect(() => {
    if (selectedTileId) layout.current?.show('tiles');
  }, [selectedTileId]);
  const stageApi = useRef(null);
  const barApi = useRef(null); // the phone alphabet bar, for hands dragged between it and the board
  const [browsing, setBrowsing] = useState(false); // the picture library slide-out
  const [studentBrowse, setStudentBrowse] = useState({ open: false, pic: null }); // where the student is browsing
  const [guidePic, setGuidePic] = useState(null); // the picture this tutor is pointing at
  // The picture library, which this tutor's live room can draw from.
  const [library, setLibrary] = useState([]);
  useEffect(() => {
    if (!room.code || !room.key) return undefined;
    let live = true;
    fetch(`/api/rooms/${room.code}/library`, { headers: { 'X-Room-Key': room.key } })
      .then((res) => (res.ok ? res.json() : { cards: [] }))
      .then((data) => {
        if (live) setLibrary(Array.isArray(data.cards) ? data.cards : []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [room]);
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
  const hands = useHands({ me: 'tutor', send: (msg) => sendRef.current(msg), sendThrottled: wb.sendThrottled });
  const call = useVideoCall('tutor', (msg) => sendRef.current(msg));

  const { status, send } = useRealtime({
    // Asking for the saved code again lets a refresh or a deploy keep the same room.
    hello: () => ({ t: 'create', code: roomRef.current.code, key: roomRef.current.key }),
    onMessage: (msg) => {
      if (call.handle(msg)) return;
      if (msg.t === 'board') setStudentTools(Boolean(msg.tools));
      if (hands.handle(msg)) return;
      if (wb.handle(msg)) return;
      if (msg.t === 'browse') return setStudentBrowse({ open: msg.open === true, pic: msg.pic || null });
      if (msg.t === 'view') return setStudentView({ x: msg.x, y: msg.y, w: msg.w, h: msg.h });
      if (msg.t === 'room') {
        const saved = { code: msg.code, key: msg.key };
        sessionStorage.setItem(SAVED, JSON.stringify(saved));
        setRoom(saved);
        // The server restarted and forgot this room: hand it our copy of the board.
        if (msg.fresh) {
          wb.restore(studentToolsRef.current, saved);
          hands.restore();
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
            : { kind: msg.m || 'hand', by: 'student', x: msg.x * STAGE.width, y: msg.y * STAGE.height, letter: msg.l, smooth: true },
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

  useEffect(() => {
    if (!tip) return undefined;
    const timer = setTimeout(() => setTip(null), 5000);
    return () => clearTimeout(timer);
  }, [tip]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.target instanceof HTMLInputElement) return; // leave typing alone
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
    send({ t: 'end' });
    sessionStorage.removeItem(SAVED);
    navigate('/whiteboard');
  };

  // Shows your pointer here and on the student's screen.
  const share = (p, mode) => {
    lastPoint.current = p;
    if (mode === 'hand') return; // the two hands are shared and held, not worn
    const letter = mode === 'hand' ? p.letter : null;
    setMyMarker({ kind: mode, by: 'tutor', x: p.x, y: p.y, letter });
    wb.sendPointer({ t: 'p', x: round4(p.x / STAGE.width), y: round4(p.y / STAGE.height), l: letter, m: mode });
  };

  const chooseTool = (next) => {
    setTool(next);
    if (next === 'none' || next === 'hand') {
      setMyMarker(null);
      wb.sendPointer({ t: 'p', m: 'none' });
      return;
    }
    const p = lastPoint.current;
    if (p) share({ ...p, letter: letterAt(p.x, p.y, wb.strip) }, next);
  };

  const onPoint = (p) => share(p, tool);

  const onLeave = () => {
    setMyMarker(null);
    wb.sendPointer({ t: 'p', m: 'none' });
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
    onAddFile: (file) => wb.addPicture(file, room),
    onClear: wb.clearPictures,
    library,
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
      send({ t: 'guide', pic });
    },
    peerPic: studentHere && studentBrowse.open ? studentBrowse.pic : null,
  };
  const studentPicTitle = wb.pictures.find((p) => p.id === studentBrowse.pic)?.title;
  const studentBrowsing = studentHere && studentBrowse.open;
  const browseText = studentPicTitle ? `Your student is looking at ${studentPicTitle}.` : 'Your student opened the picture library.';

  return (
    <>
    <WhiteboardLayout
      header={
        <TopBar
          title='Alphabet Whiteboard'
          menu={
            <>
              {room.code && <CopyButton text={`${window.location.origin}/whiteboard/${room.code}`} label='Copy link' />}
              <Switch checked={studentTools} onChange={(on) => send({ t: 'tools', on })} label='Student tools' />
              <Switch checked={wb.strip} onChange={wb.setStrip} label='Alphabet strip' />
              <p className='text-base text-slate-700'>
                {activity || (
                  <>
                    Pointing at <strong className='inline-block min-w-8 text-center text-2xl text-blue-700'>{pointing || '–'}</strong>
                  </>
                )}
              </p>
              <button
                type='button'
                aria-pressed={showStudentView}
                aria-label='Outline what the student can see'
                title={showStudentView ? 'Hide the outline of what the student can see' : 'Outline what the student can see'}
                onClick={() => setShowStudentView((was) => !was)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-sm font-semibold ${
                  showStudentView ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {showStudentView ? <Eye className='h-4 w-4' aria-hidden='true' /> : <EyeOff className='h-4 w-4' aria-hidden='true' />}
                <span className='hide-inline'>Student’s view</span>
              </button>
              <button
                type='button'
                disabled={!studentHere}
                aria-label='Show my view to student'
                title='Show my view to student'
                onClick={() => myView.current && send({ t: 'focus', ...myView.current })}
                className='inline-flex items-center gap-1.5 rounded-full border border-violet-300 px-2.5 py-1.5 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-40'
              >
                <Crosshair className='h-4 w-4' aria-hidden='true' />
                <span className='hide-inline'>Show my view to student</span>
              </button>
              <FocusButton onClick={() => layout.current?.setFocus(true)} />
            </>
          }
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
            <span title='Room code' className='rounded-lg bg-violet-600 px-3 py-1 font-mono text-2xl font-bold tracking-widest text-white'>
              {room.code || '····'}
            </span>
          </div>
          {pill}
        </TopBar>
      }
      tools={
        <ToolRail label='Your tools'>
          <ToolButton icon={MousePointer2} label='Watch' pressed={tool === 'none'} onClick={() => chooseTool('none')} />
          <HandsSwitch hands={hands.hands} onToggle={hands.show} />
          <ToolButton
            icon={Pencil}
            label='Pen'
            swatch={INK.tutor}
            pressed={tool === 'pen'}
            onClick={() => chooseTool(tool === 'pen' ? 'none' : 'pen')}
          />
          <ToolButton
            icon={Eraser}
            label='Eraser'
            pressed={tool === 'eraser'}
            onClick={() => chooseTool(tool === 'eraser' ? 'none' : 'eraser')}
          />
          <ToolButton icon={Undo2} label='Undo' disabled={!wb.canUndo} onClick={wb.undo} />
          <ClearButton icon={Trash2} onClear={() => send({ t: 'clear' })} />
        </ToolRail>
      }
      board={
        <>
          <Stage
            board={wb.board}
            me='tutor'
            strip={wb.strip}
            boxes={wb.boxes}
            tiles={wb.tiles}
            selectedTile={selectedTileId}
            canManageTiles
            tileActions={{ ...wb.tileActions, select: setSelectedTileId }}
            pieces={wb.pieces}
            pictures={wb.pictures}
            pictureSrc={(id) => pictureUrl(room.code, id)}
            pieceActions={wb.pieceActions}
            canEditPieces
            canDeletePieces
            canDuplicatePieces
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
            <StageNotice>Your student opens myprivateteacher.com/whiteboard and types {room.code}</StageNotice>
          )}
          {studentHere && tip && <StageNotice>{tip}</StageNotice>}
        </>
      }
      call={call}
      peerName='your student'
      alphabet={wb.strip ? <AlphabetBar hands={hands.visible} me='tutor' canHold handActions={hands} api={barApi} stageApi={stageApi} /> : null}
      controls={layout}
      panels={[
        {
          id: 'tiles',
          label: 'Letter tiles',
          icon: Type,
          content: (
            <TileBar
              count={wb.tiles.length}
              selected={wb.tiles.find((t) => t.id === selectedTileId) || null}
              onAdd={wb.addTiles}
              onEdit={(text) => {
                const ok = wb.editTile(selectedTileId, text);
                if (ok) setSelectedTileId(null);
                return ok;
              }}
              onCancelEdit={() => setSelectedTileId(null)}
              onReset={wb.resetTiles}
              onClear={wb.clearTiles}
              boxes={wb.boxes}
              onBoxes={wb.setBoxes}
            />
          ),
        },
        {
          id: 'pictures',
          label: 'Pictures',
          icon: ImageIcon,
          content: (
            <PicturesPanel {...pictureProps} notice={studentBrowsing ? { text: browseText, tone: 'violet', action: { label: 'View with them', onClick: () => setBrowsing(true) } } : null} onBrowse={() => setBrowsing(true)} onShow={() => layout.current?.show('pictures')} onPlaced={() => layout.current?.closeSheet()} />
          ),
        },
      ]}
    />
    <PictureDrawer open={browsing} onClose={() => setBrowsing(false)}>
      <PicturesPanel
        {...pictureProps}
        layout='drawer'
        browseOnly
        notice={studentBrowsing ? { text: browseText, tone: 'violet' } : { text: 'Choose Show student on a picture to put it on your student’s screen.', tone: 'sky' }}
        onPlaced={() => setBrowsing(false)}
      />
    </PictureDrawer>
    </>
  );
}
