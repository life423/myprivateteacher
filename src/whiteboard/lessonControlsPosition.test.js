import { describe, expect, it } from 'vitest';
import { lessonControlsPosition } from './lessonControlsPosition.js';

describe('lesson controls over the workspace', () => {
  it('anchors below the trigger and remains inside a desktop viewport', () => {
    expect(lessonControlsPosition({ right: 1320, bottom: 60 }, { left: 0, top: 0, width: 1440, height: 900 }))
      .toEqual({ left: 1000, top: 68, width: 320, maxHeight: 824 });
  });
  it('fits narrow phones without horizontal overflow', () => {
    const placement = lessonControlsPosition({ right: 410, bottom: 60 }, { left: 0, top: 0, width: 320, height: 640 });
    expect(placement).toEqual({ left: 8, top: 68, width: 304, maxHeight: 564 });
  });
  it('keeps Close and a scrolling body visible above a virtual keyboard or after viewport panning', () => {
    const viewport = { left: 24, top: 100, width: 393, height: 280 };
    const placement = lessonControlsPosition({ right: 400, bottom: 500 }, viewport);
    expect(placement).toEqual({ left: 80, top: 212, width: 320, maxHeight: 160 });
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(viewport.top + viewport.height - 8);
  });
});
