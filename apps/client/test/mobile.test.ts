import { describe, expect, it } from 'vitest';
import { MobileEnv, mobileProfile } from '../src/mobile';

const env = (o: Partial<MobileEnv>): MobileEnv => ({ userAgent: '', maxTouchPoints: 0, coarse: false, standalone: false, fullscreenApi: true, ...o });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

describe('phone and tablet support', () => {
  it('takes Android phones full screen on a tap', () => {
    const p = mobileProfile(env({ userAgent: ANDROID, maxTouchPoints: 5, coarse: true }));
    expect(p).toEqual({ touch: true, ios: false, fullscreen: true, homeScreenTip: false });
  });

  it('suggests Add to Home Screen on iPhone, where Safari has no full screen', () => {
    const p = mobileProfile(env({ userAgent: IPHONE, maxTouchPoints: 5, coarse: true, fullscreenApi: false }));
    expect(p.ios).toBe(true);
    expect(p.fullscreen).toBe(false);
    expect(p.homeScreenTip).toBe(true);
  });

  it('says nothing once the game runs from the home screen', () => {
    const p = mobileProfile(env({ userAgent: IPHONE, maxTouchPoints: 5, coarse: true, fullscreenApi: false, standalone: true }));
    expect(p.homeScreenTip).toBe(false);
    expect(mobileProfile(env({ userAgent: ANDROID, maxTouchPoints: 5, coarse: true, standalone: true })).fullscreen).toBe(false);
  });

  it('recognises an iPad that reports a Mac user agent', () => {
    const p = mobileProfile(env({ userAgent: IPAD, maxTouchPoints: 5, coarse: true }));
    expect(p.ios).toBe(true);
    expect(p.touch).toBe(true);
  });

  it('leaves desktops alone', () => {
    expect(mobileProfile(env({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0' }))).toEqual({ touch: false, ios: false, fullscreen: false, homeScreenTip: false });
    // A Mac without touch is not an iPad.
    expect(mobileProfile(env({ userAgent: IPAD, maxTouchPoints: 0 })).ios).toBe(false);
  });
});
