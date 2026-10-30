import { chooseArrangement } from '../whiteboard/arrangement.js';

// Shared by the tutor-only desktop reservation and its fixed reading surface.
export const TUTOR_GUIDE_WIDTH = 'clamp(520px,40vw,560px)';
export const canDockTutorGuide = (width, height) => width >= 1024 && chooseArrangement(width, height) === 'side';
