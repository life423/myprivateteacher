// Handwriting lines on the board: big (like K-1 paper), medium (grades 2-3), small (cursive,
// grade 3 and up) or off. The tutor chooses; both boards follow.
export const LINE_SIZES = ['big', 'medium', 'small', 'off'];
export const DEFAULT_LINES = 'medium';
export const isLineSize = (size) => LINE_SIZES.includes(size);
