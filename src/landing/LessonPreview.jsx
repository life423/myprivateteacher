import { useId, useRef, useState } from 'react';
import { Check, Grid, Move, RotateCcw, Type, Wand2 } from 'lucide-react';
import { findRegions, regionAt } from '../whiteboard/regions.js';
import { movePreviewLetter, PREVIEW_LETTERS, SOUND_WORDS } from './previewState.js';
import './lesson-preview.css';

const MODES = [
  { id: 'letters', label: 'Letter tiles', icon: Type },
  { id: 'sounds', label: 'Sound boxes', icon: Grid },
  { id: 'magic', label: 'Magic Select', icon: Wand2 },
];

function LetterTiles() {
  const [boxes, setBoxes] = useState([null, null, null]);
  const [selected, setSelected] = useState(null);
  const [drag, setDrag] = useState(null);
  const [note, setNote] = useState('');
  const stage = useRef(null);
  const pointer = useRef(null);
  const skipClick = useRef(false);
  const place = (source, destination) => {
    setBoxes((previous) => movePreviewLetter(previous, source, destination));
    setSelected(null);
    setNote(`${source.letter || boxes[source.index]} moved into box ${destination + 1}.`);
  };
  const handlers = (source) => ({
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      pointer.current = { ...source, id: event.pointerId, startX: event.clientX, startY: event.clientY, moving: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event) => {
      const active = pointer.current;
      if (!active || active.id !== event.pointerId) return;
      if (!active.moving && Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < 6) return;
      active.moving = true;
      setDrag({ letter: active.letter, x: event.clientX, y: event.clientY });
    },
    onPointerUp: (event) => {
      const active = pointer.current;
      if (!active || active.id !== event.pointerId) return;
      pointer.current = null;
      setDrag(null);
      if (!active.moving) return;
      skipClick.current = true;
      // Pointer-up can remove the tray button before its synthetic click fires.
      // Suppress only that click, never the next deliberate keyboard/touch action.
      window.setTimeout(() => { skipClick.current = false; }, 0);
      const targets = [...stage.current.querySelectorAll('[data-letter-box]')];
      const destination = targets.findIndex((target) => {
        const box = target.getBoundingClientRect();
        return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      });
      if (destination !== -1) place(active, destination);
      else if (active.kind === 'box') {
        setBoxes((previous) => previous.map((letter, index) => index === active.index ? null : letter));
        setSelected(null);
        setNote(`${active.letter} returned to the letter tray.`);
      }
    },
    onPointerCancel: () => { pointer.current = null; setDrag(null); },
  });
  const choose = (source) => {
    if (skipClick.current) { skipClick.current = false; return; }
    setSelected(source);
    setNote(`${source.letter} selected. Choose a sound box.`);
  };
  const complete = boxes.join('') === 'cat' && boxes.every(Boolean);
  return (
    <div className='lp-demo-body' ref={stage} data-preview-mode='letters'>
      <p className='lp-demo-instruction'>Try moving a letter into a box.</p>
      <div className='lp-letter-stage'>
        <div className='lp-letter-boxes' aria-label='Three sound boxes'>
          {boxes.map((letter, index) => (
            <button key={index} type='button' data-letter-box={index} className={`lp-sound-box ${letter ? 'is-filled' : ''} ${selected?.kind === 'box' && selected.index === index ? 'is-selected' : ''}`} aria-label={`Box ${index + 1}${letter ? `, letter ${letter}` : ', empty'}${selected ? `; place ${selected.letter} here` : ''}`} onClick={() => {
              if (skipClick.current) { skipClick.current = false; return; }
              if (selected) place(selected, index);
              else if (letter) choose({ kind: 'box', index, letter });
            }} {...(letter ? handlers({ kind: 'box', index, letter }) : {})}>
              {letter ? <span className={`lp-letter ${letter === 'a' ? 'is-vowel' : ''}`}>{letter}</span> : <span className='lp-box-dot' aria-hidden='true' />}
            </button>
          ))}
        </div>
        <div className='lp-letter-tray' aria-label='Letter tray'>
          {PREVIEW_LETTERS.map((letter) => (
            <div className='lp-tray-slot' key={letter}>
              {!boxes.includes(letter) && <button type='button' className={`lp-letter ${letter === 'a' ? 'is-vowel' : ''} ${selected?.letter === letter ? 'is-selected' : ''}`} aria-label={`Select letter ${letter}`} aria-pressed={selected?.letter === letter} onClick={() => choose({ kind: 'tray', letter })} {...handlers({ kind: 'tray', letter })}>{letter}</button>}
            </div>
          ))}
        </div>
        <p className={`lp-preview-result ${complete ? 'is-complete' : ''}`} aria-live='polite'>
          {complete ? <><Check size={16} aria-hidden='true' /> You built cat.</> : selected ? `Now choose a box for ${selected.letter}.` : 'Drag, or select a letter and then a box.'}
        </p>
      </div>
      <span className='sr-only' role='status'>{note}</span>
      {drag && <span className={`lp-letter lp-drag-letter ${drag.letter === 'a' ? 'is-vowel' : ''}`} style={{ left: drag.x, top: drag.y }} aria-hidden='true'>{drag.letter}</span>}
    </div>
  );
}

function SoundBoxes() {
  const [wordIndex, setWordIndex] = useState(0);
  const [tapped, setTapped] = useState([]);
  const current = SOUND_WORDS[wordIndex];
  const complete = tapped.length === current.sounds.length;
  return (
    <div className='lp-demo-body' data-preview-mode='sounds'>
      <p className='lp-demo-instruction'>Tap a box for each sound in <strong>{current.word}</strong>.</p>
      <div className='lp-counter-stage'>
        <div className='lp-word-picker' aria-label='Choose a practice word'>
          {SOUND_WORDS.map(({ word }, index) => <button type='button' key={word} aria-pressed={index === wordIndex} onClick={() => { setWordIndex(index); setTapped([]); }}>{word}</button>)}
        </div>
        <div className='lp-counter-boxes' style={{ '--box-count': current.sounds.length }} aria-label={`Sound boxes for ${current.word}`}>
          {current.sounds.map((sound, index) => <button type='button' key={`${current.word}-${index}`} className={`lp-sound-box ${tapped.includes(index) ? 'is-tapped' : ''}`} aria-label={`Sound box ${index + 1}`} aria-pressed={tapped.includes(index)} onClick={() => setTapped((previous) => previous.includes(index) ? previous.filter((n) => n !== index) : [...previous, index])}><span className='lp-counter-dot' aria-hidden='true' /></button>)}
        </div>
        <p className={`lp-preview-result ${complete ? 'is-complete' : ''}`} role='status'>{complete ? <><Check size={16} aria-hidden='true' /> {current.word} has {current.sounds.length} sounds.</> : `${tapped.length} of ${current.sounds.length} sounds tapped`}</p>
      </div>
    </div>
  );
}

function MagicSelect() {
  const [regions, setRegions] = useState([]);
  const [selection, setSelection] = useState(null);
  const [crop, setCrop] = useState(null);
  const [failed, setFailed] = useState(false);
  const image = useRef(null);
  const detect = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 400; canvas.height = 200;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image.current, 0, 0, 400, 200);
      setRegions(findRegions(context.getImageData(0, 0, 400, 200)).filter((region) => region.kind === 'picture').map((region) => ({ ...region, x: region.x * 1.5, y: region.y * 1.5, w: region.w * 1.5, h: region.h * 1.5 })));
    } catch { setFailed(true); }
  };
  return (
    <div className='lp-demo-body' data-preview-mode='magic'>
      <p className='lp-demo-instruction'>Select a picture. Lift out just that part.</p>
      <div className='lp-magic-stage'>
        <div className='lp-magic-paper'>
          <img ref={image} src='/landing/magic-select-worksheet.svg' width='600' height='300' alt='Practice page with a cat picture, a sun picture, and their written words' onLoad={detect} onError={() => setFailed(true)} />
          {regions.map((region, index) => <button key={index} type='button' className={`lp-magic-region ${selection === region ? 'is-selected' : ''}`} style={{ left: `${region.x / 6}%`, top: `${region.y / 3}%`, width: `${region.w / 6}%`, height: `${region.h / 3}%` }} aria-label={region.x < 300 ? 'Select cat picture' : 'Select sun picture'} aria-pressed={selection === region} onClick={(event) => {
            const rect = image.current.getBoundingClientRect();
            const picked = event.detail ? regionAt(regions, (event.clientX - rect.left) * 600 / rect.width, (event.clientY - rect.top) * 300 / rect.height) : region;
            setSelection(picked || region);
          }} />)}
        </div>
        <div className='lp-magic-bottom'>
          <button type='button' className='lp-add-part' disabled={!selection} onClick={() => setCrop(selection)}>{crop ? <Check size={16} aria-hidden='true' /> : <Wand2 size={16} aria-hidden='true' />} {crop ? 'Add another part' : 'Add selected part'}</button>
          <div className='lp-crop-board' aria-label='Your preview board'>
            {crop ? <svg viewBox={`${crop.x} ${crop.y} ${crop.w} ${crop.h}`} aria-label='Selected part added to the preview board' role='img'><image href='/landing/magic-select-worksheet.svg' width='600' height='300' /></svg> : <span>Your board</span>}
          </div>
        </div>
        <span className='sr-only' role='status'>{failed ? 'The practice page could not load. Try Letter tiles or Sound boxes.' : crop ? 'The selected part is on your preview board.' : selection ? 'Part selected. Choose Add selected part.' : ''}</span>
      </div>
    </div>
  );
}

export default function LessonPreview() {
  const [mode, setMode] = useState('letters');
  const [revision, setRevision] = useState(0);
  const id = useId();
  const tabs = useRef([]);
  const switchTo = (index) => { setMode(MODES[index].id); tabs.current[index]?.focus(); };
  return (
    <section className='lp-lesson-preview' aria-label='Interactive lesson preview' data-lesson-preview>
      <div className='lp-preview-heading'><span><Move size={16} aria-hidden='true' /> Try the whiteboard</span><button type='button' aria-label='Reset lesson preview' title='Reset preview' onClick={() => setRevision((n) => n + 1)}><RotateCcw size={16} aria-hidden='true' /></button></div>
      <div id={`${id}-panel`} role='tabpanel' aria-labelledby={`${id}-${mode}`} key={`${mode}-${revision}`}>
        {mode === 'letters' ? <LetterTiles /> : mode === 'sounds' ? <SoundBoxes /> : <MagicSelect />}
      </div>
      <div className='lp-preview-tabs' role='tablist' aria-label='Explore lesson tools'>
        {MODES.map(({ id: tab, label, icon: Icon }, index) => <button key={tab} ref={(element) => { tabs.current[index] = element; }} type='button' role='tab' id={`${id}-${tab}`} aria-selected={mode === tab} aria-controls={`${id}-panel`} tabIndex={mode === tab ? 0 : -1} onClick={() => setMode(tab)} onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? (index + 1) % MODES.length : event.key === 'ArrowLeft' ? (index + MODES.length - 1) % MODES.length : event.key === 'Home' ? 0 : event.key === 'End' ? MODES.length - 1 : null;
          if (next === null) return;
          event.preventDefault(); switchTo(next);
        }}><Icon size={16} aria-hidden='true' /><span>{label}</span></button>)}
      </div>
      <p className='lp-preview-caption'>A little practice space. No sign-in needed.</p>
    </section>
  );
}
