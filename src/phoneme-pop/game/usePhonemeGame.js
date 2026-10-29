import { useEffect, useRef, useState } from 'react';
import { init, useGameState } from './useGameState.js';
import { checkAnswer, makeTiles, pickNextWord, randomItem, shuffleTiles } from './logic.js';
import { BUILT_IN, rememberLevel, useWordBank, wantedLevel } from './wordBank.js';
import { speak } from '../speechUtils.js';

const CELEBRATION_MS = 1800;
const FEEDBACK_MS = 1600;

// Phoneme Pop's game, run in one place: the solo page, or the tutor's whiteboard. Every change
// goes through act() as an intent (see shared/phoneme.js). `onChange` gets the state after each
// change, so the whiteboard can send it to the student. Speech and timers run wherever this runs.
export function usePhonemeGame({ onChange, context, isCurrentContext, enabled = true } = {}) {
  const bank = useWordBank();
  const bankRef = useRef(bank);
  bankRef.current = bank;
  const [want] = useState(wantedLevel); // the level asked for (a link, or last time); may be only in the server's bank
  const [state, dispatch, stateContext] = useGameState({ level: BUILT_IN.words[want] ? want : 1, lists: BUILT_IN.words }, context);
  const current = (origin) => !isCurrentContext || isCurrentContext(origin);
  const change = (action, origin = context) => { if (current(origin)) dispatch({ ...action, publicationContext: origin }); };
  const stateRef = useRef(state);
  stateRef.current = state;
  const settled = useRef(false); // the starting level is decided (or the player picked one)

  const chooseLevel = (next, origin = context) => {
    const list = bankRef.current.words[next];
    if (list?.length) change({ type: 'chooseLevel', level: next, word: randomItem(list) }, origin);
  };

  // A level only the server's bank has (a link to level 4, say) starts as soon as the bank arrives.
  useEffect(() => {
    if (settled.current || !bank.words[want]?.length) return;
    settled.current = true;
    if (want !== stateRef.current.level) chooseLevel(want);
  }, [bank]);

  useEffect(() => rememberLevel(state.level), [state.level]);

  const goToNextWord = (origin = context) => {
    if (!current(origin)) return;
    const { level, solved, word } = stateRef.current;
    const next = pickNextWord({ level, solved, currentWord: word }, Math.random, bankRef.current.words);
    if (next.levelUp) speak(`Level ${next.level}!`);
    change({ type: 'next', next }, origin);
  };

  // Timers live in effects, so moving to another word cancels them automatically.
  useEffect(() => {
    if (!enabled || !current(stateContext) || state.phase !== 'celebrating') return undefined;
    const timer = setTimeout(() => goToNextWord(stateContext), CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [state.phase, state.word, stateContext, enabled]);

  useEffect(() => {
    if (!enabled || !current(stateContext) || !state.feedback) return undefined;
    const timer = setTimeout(() => change({ type: 'clearFeedback' }, stateContext), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [state.feedback, stateContext, enabled]);

  useEffect(() => {
    if (onChange && current(stateContext)) onChange(state, stateContext);
  }, [state, stateContext]);

  // Applies one intent: from this screen's own taps, or from a student's (already checked).
  const act = (intent, origin = context) => {
    if (!current(origin)) return;
    const s = stateRef.current;
    switch (intent.type) {
      case 'toggleTile': {
        const tile = s.tiles.find((t) => t.id === intent.id);
        if (tile) change({ type: 'toggleTile', tile }, origin);
        return;
      }
      case 'split':
        speak(s.word.word);
        change({ type: 'split', tiles: shuffleTiles(makeTiles(s.word)) }, origin);
        return;
      case 'hear':
        speak(s.word.word);
        return;
      case 'check': {
        const result = checkAnswer(s.selected, s.word);
        if (result === 'correct') {
          change({ type: 'correct' }, origin);
          speak(`${s.word.word}! Great job!`);
        } else {
          change({ type: 'miss', reason: result }, origin);
          speak(result === 'incomplete' ? 'Use all the sounds.' : 'Check your order. Try again!');
        }
        return;
      }
      case 'next':
        goToNextWord(origin);
        return;
      case 'chooseLevel':
        settled.current = true;
        chooseLevel(intent.level, origin);
        return;
      // The tutor's demonstration: picks the next sound in the word, as the student should
      case 'showNext': {
        if (s.phase !== 'tiles') return;
        const sound = s.word.phonemes[s.selected.length];
        const tile = s.tiles.find((t) => t.sound === sound && !s.selected.some((x) => x.id === t.id));
        if (tile) change({ type: 'toggleTile', tile }, origin);
        return;
      }
      default:
    }
  };

  const restart = (origin = context) => {
    if (!current(origin)) return null;
    const lists = bankRef.current.words;
    const level = lists[stateRef.current.level]?.length ? stateRef.current.level : 1;
    const next = init({ level, lists });
    change({ type: 'restore', state: next }, origin);
    return next;
  };

  return { state, bank, act, restart, restore: (next, origin = context) => change({ type: 'restore', state: next }, origin) };
}
