/**
 * Phone and tablet helpers: full screen, landscape lock and the iPhone
 * "Add to Home Screen" tip. Detection is pure (testable) with thin wrappers
 * over the browser APIs.
 */

export interface MobileEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** matchMedia('(pointer: coarse)'). */
  coarse: boolean;
  /** Running from the home screen (display-mode standalone / fullscreen, or iOS navigator.standalone). */
  standalone: boolean;
  /** The Fullscreen API exists (it does not on iPhone Safari). */
  fullscreenApi: boolean;
}

export interface MobileProfile {
  touch: boolean;
  ios: boolean;
  /** Offer (and on taps, request) browser full screen. */
  fullscreen: boolean;
  /** Suggest Share > Add to Home Screen (iPhone has no full screen in the browser). */
  homeScreenTip: boolean;
}

export function mobileProfile(e: MobileEnv): MobileProfile {
  // iPadOS reports a Mac user agent; touch points give it away.
  const ios = /iPhone|iPad|iPod/i.test(e.userAgent) || (/Macintosh/i.test(e.userAgent) && e.maxTouchPoints > 1);
  const touch = e.coarse || e.maxTouchPoints > 1;
  return {
    touch,
    ios,
    fullscreen: touch && e.fullscreenApi && !e.standalone,
    homeScreenTip: ios && touch && !e.standalone && !e.fullscreenApi,
  };
}

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function currentEnv(): MobileEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  const mm = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
  const el = document.documentElement as FsEl;
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    coarse: mm('(pointer: coarse)'),
    standalone: nav.standalone === true || mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)'),
    fullscreenApi: typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function',
  };
}

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/** Go full screen and hold landscape. Must run inside a tap; failures are ignored (the game works either way). */
export async function enterFullscreen(): Promise<void> {
  if (isFullscreen()) return;
  const el = document.documentElement as FsEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else await el.webkitRequestFullscreen?.();
  } catch {
    return;
  }
  try {
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    /* not supported (or not allowed): the rotate hint covers it */
  }
}

export async function exitFullscreen(): Promise<void> {
  const d = document as FsDoc;
  try {
    if (d.exitFullscreen) await d.exitFullscreen();
    else await d.webkitExitFullscreen?.();
  } catch {
    /* ignore */
  }
}
