import { afterEach, describe, expect, it, vi } from 'vitest';
import { readingRectangle, settleReadingFrame } from './readingFocus.js';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function frames() {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', callback => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
}
describe('readable worksheet framing', () => {
  it('uses the placed worksheet, without changing the shared piece dimensions', () => {
    const piece = { x: 696.5, y: 470, w: 207.1, h: 220 };
    expect(readingRectangle(piece)).toMatchObject({ x: 672.5, y: 446, h: 268 });
    expect(readingRectangle(piece).w).toBeCloseTo(255.1);
    expect(piece.w).toBe(207.1);
    expect(readingRectangle({ ...piece, h: NaN })).toBeNull();
  });
  it('waits for the phone sheet to finish resizing before fitting', async () => {
    frames(); let height = 210;
    const api = { current: { viewport: () => ({ width: 393, height }) } };
    const settled = vi.fn(); settleReadingFrame(api, () => true).then(settled);
    await vi.advanceTimersByTimeAsync(32); height = 310;
    await vi.advanceTimersByTimeAsync(32); height = 530;
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(80);
    expect(settled).toHaveBeenCalledWith(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels a delayed reading fit when its activity or transport changes', async () => {
    frames(); let current = true;
    const value = settleReadingFrame({ current: { viewport: () => ({ width: 393, height: 530 }) } }, () => current);
    await vi.advanceTimersByTimeAsync(16); current = false;
    await vi.advanceTimersByTimeAsync(16);
    expect(await value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out safely if there is no visible board frame', async () => {
    frames(); const value = settleReadingFrame({ current: null }, () => true);
    await vi.advanceTimersByTimeAsync(1200);
    expect(await value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
