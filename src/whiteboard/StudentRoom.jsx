import { useEffect, useRef, useState } from 'react';
import { Eraser, Image as ImageIcon, Pencil, Undo2 } from 'lucide-react';
import { navigate } from '../router.jsx';
import { useRealtime } from './useRealtime.js';
import { useFrameState, useWhiteboard } from './useWhiteboard.js';
import Stage from './Stage.jsx';
import { INK } from './board.js';
import { STAGE } from './stage.js';
import { useHands } from './useHands.js';
import WhiteboardLayout from './WhiteboardLayout.jsx';
import AlphabetBar from './AlphabetBar.jsx';
import { HandsSwitch, ToolButton, ToolRail } from './Toolbar.jsx';
import PicturesPanel, { PictureDrawer } from './PicturesPanel.jsx';
import { pictureUrl } from './pictures.js';
import { useVideoCall } from './useVideoCall.js';
import { FocusButton, MessageScreen, StageNotice, StatusPill, TopBar } from './ui.jsx';
import BridgeBoard from '../bridge/BridgeBoard.jsx';
import PhonemeBoard from '../phoneme-pop/components/PhonemeBoard.jsx';
import { fromWire } from '../../shared/phoneme.js';

const round4 = (n) => Math.round(n * 10000) / 10000;

const ENDINGS = {
  'no-room': ['We can’t find that room', 'Check the 4-digit code with your tutor and try again.'],
  'room-full': ['That room already has a student', 'Check the code with your tutor.'],
  'slow-down': ['Too many tries', 'Too many wrong codes from this network. Wait a few minutes, then try again.'],
  closed: ['The session is over', 'Your tutor ended the session. Great work!'],
  replaced: ['Open somewhere else', 'This session is now running in another tab or window.'],
};

export default function StudentRoom({ code }) {
  const storageKey = `wb-student-${code}`;
  const [phase, setPhase] = useState('joining'); // joining | in | rejoining | a key of ENDINGS
  const [tutorHere, setTutorHere] = useState(true);
  const [toolsOn, setToolsOn] = useState(false);
  const [tool, setTool] = useState('none'); // nothing chosen: a touch moves hands, tiles and pictures
  const [game, setGame] = useState(null); // the bridge, while the tutor has it on
  const [selected, setSelected] = useState(null); // the letter picked from the bridge's tray
  const stageApi = useRef(null);
  const barApi = useRef(null); // the phone alphabet bar, for hands dragged between it and the board
  const [browsing, setBrowsing] = useState(false); // the picture library slide-out
  const [viewingPic, setViewingPic] = useState(null); // the picture open in the slide-out
  const [guidePic, setGuidePic] = useState(null); // the picture the tutor is pointing at
  const layout = useRef(null); // the shared layout: open a panel, focus mode
  // Zoom and pan are this screen's own. The tutor sees which part of the board it shows, and
  // can bring it to the part they're teaching (follow tutor).
  const [follow, setFollow] = useState(null);
  const lastView = useRef(null);
  const viewTimer = useRef(null);
  const sendView = (rect) => {
    lastView.current = rect;
    if (viewTimer.current) return;
    viewTimer.current = setTimeout(() => {
      viewTimer.current = null;
      sendRef.current?.({ t: 'view', ...lastView.current });
    }, 200);
  };
  const [notice, setNotice] = useState(null);
  const [myMarker, setMyMarker] = useFrameState(null);
  const [tutorMarker, setTutorMarker] = useFrameState(null);
  const keyRef = useRef(sessionStorage.getItem(storageKey));
  const joined = useRef(false);
  const retries = useRef(0);
  const retryTimer = useRef(null);
  const lastPoint = useRef(null);
  const sendRef = useRef(() => {});

  const wb = useWhiteboard('student', (msg) => sendRef.current(msg));
  const hands = useHands({ me: 'student', send: (msg) => sendRef.current(msg), sendThrottled: wb.sendThrottled });
  const call = useVideoCall('student', (msg) => sendRef.current(msg));
  const joinMessage = () => ({ t: 'join', code, key: keyRef.current || undefined });

  // The tutor decides whether the toolbar is available.
  const applyTools = (on, announce) => {
    setToolsOn(on);
    if (!on) setTool('none');
    if (announce) setNotice(on ? 'Your tutor turned on your tools ✏️' : 'Your tutor turned off the tools');
  };

  const { status, send } = useRealtime({
    hello: joinMessage,
    onMessage: (msg) => {
      if (call.handle(msg)) return;
      if (msg.t === 'board' || msg.t === 'game') setGame(msg.game || null);
      if (msg.t === 'board') applyTools(Boolean(msg.tools), false);
      if (hands.handle(msg)) return;
      if (wb.handle(msg)) return;
      if (msg.t === 'guide') {
        setGuidePic(msg.pic || null);
        if (msg.pic) setBrowsing(true); // the tutor is showing them a picture: open the library
        return;
      }
      if (msg.t === 'focus') return setFollow({ x: msg.x, y: msg.y, w: msg.w, h: msg.h, n: Date.now() });
      if (msg.t === 'tools') {
        applyTools(Boolean(msg.on), true);
      } else if (msg.t === 'room') {
        keyRef.current = msg.key;
        sessionStorage.setItem(storageKey, msg.key);
        joined.current = true;
        retries.current = 0;
        setPhase('in');
      } else if (msg.t === 'presence') {
        setTutorHere(msg.tutor);
        if (!msg.tutor) {
          setTutorMarker(null);
          call.peerGone();
        }
      } else if (msg.t === 'p') {
        setTutorMarker(
          msg.m === 'none'
            ? null
            : { kind: msg.m, by: 'tutor', x: msg.x * STAGE.width, y: msg.y * STAGE.height, smooth: true },
        );
      } else if (msg.t === 'closed') {
        sessionStorage.removeItem(storageKey);
        setPhase('closed');
      } else if (msg.t === 'error') {
        // After a deploy the room comes back once the tutor reconnects, so keep trying for about a
        // minute, less often as it goes: each miss counts toward the server's limit on wrong codes.
        if (msg.reason === 'no-room' && joined.current && retries.current < 8) {
          const wait = Math.min(12_000, 2000 * 1.5 ** retries.current);
          retries.current += 1;
          setPhase('rejoining');
          clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => sendRef.current(joinMessage()), wait);
        } else {
          setPhase(msg.reason);
        }
      }
    },
  });
  sendRef.current = send;

  useEffect(() => () => clearTimeout(retryTimer.current), []);
  useEffect(() => () => clearTimeout(viewTimer.current), []);
  // When the tutor arrives (or comes back), tell them what this screen shows.
  useEffect(() => {
    if (tutorHere && lastView.current) sendRef.current?.({ t: 'view', ...lastView.current });
  }, [tutorHere]);
  // The tutor sees whether the picture library is open here and which picture is open.
  useEffect(() => {
    sendRef.current?.({ t: 'browse', open: browsing, pic: browsing ? viewingPic : null });
  }, [browsing, viewingPic, tutorHere]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!toolsOn) return undefined;
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        wb.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toolsOn, wb.undo]);

  // Shows this pointer locally and shares it with the tutor.
  const share = (p, mode) => {
    lastPoint.current = p;
    if (mode === 'none') return; // nothing to show: the two hands are shared and held, not worn
    setMyMarker({ kind: mode, by: 'student', x: p.x, y: p.y });
    wb.sendPointer({ t: 'p', x: round4(p.x / STAGE.width), y: round4(p.y / STAGE.height), m: mode });
  };

  const chooseTool = (next) => {
    setTool(next);
    if (next === 'none') {
      setMyMarker(null);
      wb.sendPointer({ t: 'p', m: 'none' });
    }
    const p = lastPoint.current;
    if (p) share(p, next);
  };

  // A letter that's now in its gap can't be picked any more
  useEffect(() => {
    if (selected && game?.kind !== 'phoneme' && game && !game.tray.includes(selected)) setSelected(null);
  }, [game, selected]);
  // The tutor applies the tap and sends the game back, so the screen shows it once it's there
  const placeLetter = (slot, letter) => send({ t: 'game:act', act: { a: 'place', slot, letter } });

  const ending = ENDINGS[status === 'replaced' ? 'replaced' : phase];
  if (ending) return <MessageScreen title={ending[0]}>{ending[1]}</MessageScreen>;

  const leave = () => {
    send({ t: 'leave' });
    sessionStorage.removeItem(storageKey);
    navigate('/whiteboard');
  };

  let pill = <StatusPill tone='good'>Connected to your tutor</StatusPill>;
  if (status !== 'open' || phase === 'rejoining') {
    pill = <StatusPill tone={joined.current ? 'bad' : 'wait'}>{joined.current ? 'Reconnecting…' : 'Connecting…'}</StatusPill>;
  } else if (phase === 'joining') {
    pill = <StatusPill tone='wait'>Joining…</StatusPill>;
  } else if (!tutorHere) {
    pill = <StatusPill tone='wait'>Waiting for your tutor</StatusPill>;
  }

  const markers = [tutorMarker && { key: 'tutor', ...tutorMarker }, myMarker && { key: 'me', ...myMarker }].filter(Boolean);
  const holdActions = hands;

  // The Pictures panel's settings, shared by the side column (or sheet) and the slide-out.
  const pictureProps = {
    pictures: wb.pictures,
    offers: wb.offers,
    canTake: toolsOn,
    guidePic,
    srcFor: (id) => pictureUrl(code, id),
    onPlace: wb.pieceActions.add,
    stageApi,
  };

  return (
    <>
    <WhiteboardLayout
      header={
        <TopBar
          title='Alphabet Whiteboard'
          menu={<FocusButton onClick={() => layout.current?.setFocus(true)} />}
          end={
            <button
              type='button'
              onClick={leave}
              className='shrink-0 rounded-full bg-slate-800 px-4 py-2 text-sm font-bold text-white hover:bg-slate-900'
            >
              Leave
            </button>
          }
        >
          <span className='shrink-0 text-base font-semibold text-slate-700'>Room {code}</span>
          {pill}
        </TopBar>
      }
      tools={
        toolsOn && (
          <ToolRail label='Your tools'>
            <HandsSwitch hands={hands.hands} onToggle={hands.show} />
            <ToolButton icon={Pencil} label='Pen' swatch={INK.student} pressed={tool === 'pen'} onClick={() => chooseTool(tool === 'pen' ? 'none' : 'pen')} />
            <ToolButton icon={Eraser} label='Eraser' pressed={tool === 'eraser'} onClick={() => chooseTool(tool === 'eraser' ? 'none' : 'eraser')} />
            <ToolButton icon={Undo2} label='Undo' disabled={!wb.canUndo} onClick={wb.undo} />
          </ToolRail>
        )
      }
      board={
        game?.kind === 'phoneme' ? (
          <div className='h-full'>
            <PhonemeBoard state={fromWire(game)} total={game.total} onIntent={(intent) => send({ t: 'game:act', act: intent })} />
          </div>
        ) : game ? (
          <div className='flex h-full items-center justify-center overflow-auto p-2'>
            <BridgeBoard game={game} selected={selected} onSelect={setSelected} onPlace={placeLetter} />
          </div>
        ) : (
        <>
          <Stage
            board={wb.board}
            me='student'
            strip={wb.strip}
            boxes={wb.boxes}
            lines={wb.lines}
            tiles={wb.tiles}
            tileActions={wb.tileActions}
            pieces={wb.pieces}
            pictures={wb.pictures}
            pictureSrc={(id) => pictureUrl(code, id)}
            pieceActions={wb.pieceActions}
            canEditPieces={toolsOn}
            onSelectPiece={() => chooseTool('none')}
            onView={sendView}
            focus={follow}
            stageApi={stageApi}
            letters={hands.letters}
            hands={hands.visible}
            handActions={holdActions}
            canHoldHands={toolsOn} // with tools on, a press on a glove holds it, whatever the tool
            barApi={barApi}
            tool={tool}
            markers={markers}
            onPoint={(p) => share(p, tool)}
            onLeave={() => {
              setMyMarker(null);
              wb.sendPointer({ t: 'p', m: 'none' });
            }}
            onStroke={{ start: (p) => wb.stroke.start(tool, p), move: wb.stroke.move, end: wb.stroke.end }}
          />
          {phase === 'in' && notice && <StageNotice>{notice}</StageNotice>}
          {phase === 'in' && !notice && !tutorHere && <StageNotice>Waiting for your tutor…</StageNotice>}
        </>
        )
      }
      call={call}
      peerName='your tutor'
      alphabet={wb.strip ? <AlphabetBar hands={hands.visible} me='student' canHold={toolsOn} handActions={holdActions} api={barApi} stageApi={stageApi} /> : null}
      controls={layout}
      // While a game is on it has the whole board: no pictures panel to take up the screen
      panels={
        game
          ? []
          : [
              {
                id: 'pictures',
                label: 'Pictures',
                icon: ImageIcon,
                content: (
                  <PicturesPanel {...pictureProps} notice={guidePic && !browsing ? { text: 'Your tutor picked a picture for you.', tone: 'sky' } : null} onBrowse={() => setBrowsing(true)} onShow={() => layout.current?.show('pictures')} onPlaced={() => layout.current?.closeSheet()} />
                ),
              },
            ]
      }
    />
    <PictureDrawer
      open={browsing}
      onClose={() => {
        setBrowsing(false);
        setViewingPic(null);
      }}
    >
      <PicturesPanel
        {...pictureProps}
        layout='drawer'
        browseOnly
        onOpenChange={setViewingPic}
        notice={guidePic ? { text: 'Your tutor picked a picture for you. Look for the blue glow.', tone: 'sky' } : null}
        onPlaced={() => {
          setBrowsing(false);
          setViewingPic(null);
        }}
      />
    </PictureDrawer>
    </>
  );
}
