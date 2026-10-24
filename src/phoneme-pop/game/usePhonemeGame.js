import { useEffect, useRef, useState } from 'react';
import { useGameState } from './useGameState.js';
import { checkAnswer, makeTiles, pickNextWord, randomItem, shuffleTiles } from './logic.js';
import { BUILT_IN, rememberLevel, useWordBank, wantedLevel } from './wordBank.js';
import { speak } from '../speechUtils.js';

const CELEBRATION_MS = 1800;
const FEEDBACK_MS = 1600;

// Phoneme Pop's game, run in one place: the solo page, or the tutor's whiteboard. Every change
// goes through act() as an intent (see shared/phoneme.js). `onChange` gets the state after each
// change, so the whiteboard can send it to the student. Speech and timers run wherever this runs.
export function usePhonemeGame({ onChange } = {}) {
  const bank = useWordBank();
  const bankRef = useRef(bank);
  bankRef.current = bank;
  const [want] = useState(wantedLevel); // the level asked for (a link, or last time); may be only in the server's bank
  const [state, dispatch] = useGameState({ level: BUILT_IN.words[want] ? want : 1, lists: BUILT_IN.words });
  const stateRef = useRef(state);
  stateRef.current = state;
  const settled = useRef(false); // the starting level is decided (or the player picked one)

  const chooseLevel = (next) => {
    const list = bankRef.current.words[next];
    if (list?.length) dispatch({ type: 'chooseLevel', level: next, word: randomItem(list) });
  };

  // A level only the server's bank has (a link to level 4, say) starts as soon as the bank arrives.
  useEffect(() => {
    if (settled.current || !bank.words[want]?.length) return;
    settled.current = true;
    if (want !== stateRef.current.level) chooseLevel(want);
  }, [bank]);

  useEffect(() => rememberLevel(state.level), [state.level]);

  const goToNextWord = () => {
    const { level, solved, word } = stateRef.current;
    const next = pickNextWord({ level, solved, currentWord: word }, Math.random, bankRef.current.words);
    if (next.levelUp) speak(`Level ${next.level}!`);
    dispatch({ type: 'next', next });
  };

  // Timers live in effects, so moving to another word cancels them automatically.
  useEffect(() => {
    if (state.phase !== 'celebrating') return undefined;
    const timer = setTimeout(goToNextWord, CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [state.phase, state.word]);

  useEffect(() => {
    if (!state.feedback) return undefined;
    const timer = setTimeout(() => dispatch({ type: 'clearFeedback' }), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [state.feedback]);

  useEffect(() => {
    if (onChange) onChange(state);
  }, [state]);

  // Applies one intent: from this screen's own taps, or from a student's (already checked).
  const act = (intent) => {
    const s = stateRef.current;
    switch (intent.type) {
      case 'toggleTile': {
        const tile = s.tiles.find((t) => t.id === intent.id);
        if (tile) dispatch({ type: 'toggleTile', tile });
        return;
      }
      case 'split':
        speak(s.word.word);
        dispatch({ type: 'split', tiles: shuffleTiles(makeTiles(s.word)) });
        return;
      case 'hear':
        speak(s.word.word);
        return;
      case 'check': {
        const result = checkAnswer(s.selected, s.word);
        if (result === 'correct') {
          dispatch({ type: 'correct' });
          speak(`${s.word.word}! Great job!`);
        } else {
          dispatch({ type: 'miss', reason: result });
          speak(result === 'incomplete' ? 'Use all the sounds.' : 'Check your order. Try again!');
        }
        return;
      }
      case 'next':
        goToNextWord();
        return;
      case 'chooseLevel':
        settled.current = true;
        chooseLevel(intent.level);
        return;
      // The tutor's demonstration: picks the next sound in the word, as the student should
      case 'showNext': {
        if (s.phase !== 'tiles') return;
        const sound = s.word.phonemes[s.selected.length];
        const tile = s.tiles.find((t) => t.sound === sound && !s.selected.some((x) => x.id === t.id));
        if (tile) dispatch({ type: 'toggleTile', tile });
        return;
      }
      default:
    }
  };

  return { state, bank, act, restore: (next) => dispatch({ type: 'restore', state: next }) };
}
