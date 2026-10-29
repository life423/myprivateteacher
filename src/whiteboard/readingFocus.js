// Focus a worksheet without changing its shared size or a student's work.
export function readingRectangle(piece, padding = 24) {
  if (!piece || ![piece.x, piece.y, piece.w, piece.h].every(Number.isFinite) || piece.w <= 0 || piece.h <= 0) return null;
  const x = Math.max(0, piece.x - padding), y = Math.max(0, piece.y - padding);
  return { x, y, w: piece.w + piece.x - x + padding, h: piece.h + piece.y - y + padding };
}

// A phone's Materials sheet animates closed. Wait for its actual frame rather
// than fitting to the small, partly closed board and leaving the text tiny.
export function settleReadingFrame(api, current) {
  return new Promise(resolve => {
    let frame, timer, done = false, previous, stable = 0;
    const finish = value => { if (done) return; done = true; cancelAnimationFrame(frame); clearTimeout(timer); resolve(value); };
    const measure = () => {
      if (!current()) return finish(false);
      const size = api.current?.viewport?.();
      if (size?.width > 0 && size?.height > 0) {
        stable = previous && Math.abs(previous.width - size.width) < 0.5 && Math.abs(previous.height - size.height) < 0.5 ? stable + 1 : 0;
        previous = size;
        if (stable >= 4) return finish(true);
      }
      frame = requestAnimationFrame(measure);
    };
    timer = setTimeout(() => finish(false), 1200);
    frame = requestAnimationFrame(measure);
  });
}
