import { describe, expect, it } from 'vitest';
import { deviceSummary, whyNoVideo } from './useVideoCall.js';

const ready = { isSecureContext: true, RTCPeerConnection: function RTCPeerConnection() {}, navigator: { mediaDevices: { getUserMedia() {} } } };
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

describe('why video cannot start', () => {
  it('names the real cause', () => {
    expect(whyNoVideo({ ...ready, isSecureContext: false })).toMatch(/https:/);
    expect(whyNoVideo({ ...ready, RTCPeerConnection: undefined })).toMatch(/turned off in this browser/);
    expect(whyNoVideo({ ...ready, navigator: {} })).toMatch(/inside another app/);
    expect(whyNoVideo(ready)).toBeNull();
  });
});

describe('the device and browser', () => {
  it('knows an iPad, which says it is a Mac', () => {
    expect(deviceSummary({ userAgent: SAFARI_MAC, maxTouchPoints: 5 })).toBe('iPad, Safari 17.4');
    expect(deviceSummary({ userAgent: SAFARI_MAC, maxTouchPoints: 0 })).toBe('Mac, Safari 17.4');
  });

  it('knows Chrome on an iPhone and on Windows', () => {
    expect(deviceSummary({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1' })).toBe('iPhone, Chrome 123');
    expect(deviceSummary({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' })).toBe('Windows, Chrome 124');
  });
});
