// 平台判断。安卓端 Kotlin / iOS 端 Swift 会往网页里注入 window.AndroidMpv（同一套接口，见 android/MpvBridge.kt、ios/MpvBridge.swift）。
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
export const isAndroid: boolean = /Android/i.test(ua);
// iPadOS 13+ 的 Safari/WKWebView 默认伪装成 Mac，靠触点数区分
export const isIOS: boolean = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
export const isIPad: boolean = isIOS && !/iPhone|iPod/i.test(ua);
/** 手机 / 平板上的原生壳（触屏版界面、原生播放器桥）。名字沿用旧代码，改动最小。 */
export const isMobileApp: boolean = isAndroid || isIOS;
export const platformName: string = isAndroid ? 'Android' : isIOS ? (isIPad ? 'iPad' : 'iPhone') : 'Windows';

type MaybeP<T> = T | Promise<T>;
export interface AndroidBridge {
  // 安卓是同步返回；iOS 的 WKWebView 只能异步回复，所以这几个允许返回 Promise（调用处统一 await）
  init(json: string): MaybeP<string>;
  destroy(): void;
  command(json: string): MaybeP<string>;
  getProp(name: string, type: string): MaybeP<string>;
  setFullscreen(on: boolean): void;
  setBrightness(v: number): void;
  getBrightness(): number;
  getSysVolume(): number;
  setSysVolume(v: number): void;
  exit(): void;
  getInsetTop?(): number;
}

interface WkHandler { postMessage(m: unknown): Promise<unknown> | void }
const wkMpv = (): WkHandler | undefined => (window as unknown as { webkit?: { messageHandlers?: { weaveMpv?: WkHandler } } }).webkit?.messageHandlers?.weaveMpv;

// iOS：Swift 端（ios/WeaveMpv.swift）注册了 weaveMpv 消息通道；这里包成和安卓同一套接口
let iosShim: AndroidBridge | null = null;
function makeIosBridge(h: WkHandler): AndroidBridge {
  const ask = async (op: string, a: Record<string, unknown> = {}): Promise<string> => String((await h.postMessage({ op, ...a })) ?? '');
  const fire = (op: string, a: Record<string, unknown> = {}): void => { try { void h.postMessage({ op, ...a }); } catch { /* ignore */ } };
  let bri = 0.5, vol = 1;
  return {
    init: (json) => ask('init', { json }),
    destroy: () => fire('destroy'),
    command: (json) => ask('command', { json }),
    getProp: (name, type) => ask('getProp', { name, type }),
    setFullscreen: (on) => fire('fullscreen', { on }),
    setBrightness: (v) => { bri = v; fire('brightness', { v }); },
    getBrightness: () => bri,
    getSysVolume: () => vol,
    // iOS 不允许程序改系统音量：手势直接调 mpv 自己的音量
    setSysVolume: (v) => { vol = v; fire('volume', { v }); },
    exit: () => undefined,
    getInsetTop: () => 0,
  };
}

export const androidBridge = (): AndroidBridge | null => {
  if (!isMobileApp) return null;
  if (isIOS) {
    const h = wkMpv();
    if (!h) return null;
    return (iosShim ??= makeIosBridge(h));
  }
  return (window as unknown as { AndroidMpv?: AndroidBridge }).AndroidMpv ?? null;
};

if (isMobileApp && typeof document !== 'undefined') {
  const c = document.documentElement.classList;
  c.add('android'); // 触屏版样式统一挂在 .android 下
  if (isIOS) c.add('ios');
  if (isIPad) c.add('tablet');
}
