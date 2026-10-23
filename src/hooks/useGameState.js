import { useReducer } from 'react';
import { wordLists } from '../data/wordLists.js';
import { LEVELS, POINTS_PER_WORD, randomItem } from '../game/logic.js';

// phase: 'word' (whole word showing) -> 'tiles' (split into sounds) -> 'celebrating'
function init({ level, lists }) {
  return {
    level,
    solved: new Set(),
    word: randomItem(lists[level]),
    phase: 'word',
    tiles: [],
    selected: [],
    feedback: null, // 'wrong-order' | 'incomplete' | null
    score: 0,
    streak: 0,
  };
}

function reducer(state, action) {
  switch (action.type) {
    case 'split':
      if (state.phase !== 'word') return state;
      return { ...state, phase: 'tiles', tiles: action.tiles, selected: [], feedback: null };

    case 'toggleTile': {
      if (state.phase !== 'tiles') return state;
      const at = state.selected.findIndex((t) => t.id === action.tile.id);
      // Tapping a chosen sound un-chooses it and everything after it.
      const selected = at >= 0 ? state.selected.slice(0, at) : [...state.selected, action.tile];
      return { ...state, selected, feedback: null };
    }

    case 'correct':
      if (state.phase !== 'tiles') return state;
      return {
        ...state,
        phase: 'celebrating',
        solved: new Set(state.solved).add(state.word.word),
        score: state.score + POINTS_PER_WORD * state.level,
        streak: state.streak + 1,
        feedback: null,
      };

    case 'miss':
      if (state.phase !== 'tiles') return state;
      return { ...state, feedback: action.reason, streak: action.reason === 'wrong-order' ? 0 : state.streak };

    case 'clearFeedback':
      return { ...state, feedback: null, selected: state.feedback === 'wrong-order' ? [] : state.selected };

    // The player picked a level: start it fresh. Score and streak carry on.
    case 'chooseLevel':
      return { ...state, level: action.level, solved: new Set(), word: action.word, phase: 'word', tiles: [], selected: [], feedback: null };

    case 'next': {
      const { level, solved, word } = action.next;
      return { ...state, level, solved, word, phase: 'word', tiles: [], selected: [], feedback: null };
    }

    default:
      return state;
  }
}

export function useGameState(start = { level: LEVELS[0], lists: wordLists }) {
  return useReducer(reducer, start, init);
}
