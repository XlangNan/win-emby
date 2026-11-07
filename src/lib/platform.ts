// 平台判断。安卓端 Kotlin 会往网页里注入 window.AndroidMpv（见 android/MpvBridge.kt）。
export const isAndroid: boolean = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

export interface AndroidBridge {
  init(json: string): string;
  destroy(): void;
  command(json: string): string;
  getProp(name: string, type: string): string;
  setFullscreen(on: boolean): void;
  setBrightness(v: number): void;
  getBrightness(): number;
  getSysVolume(): number;
  setSysVolume(v: number): void;
  exit(): void;
  getInsetTop?(): number;
}

export const androidBridge = (): AndroidBridge | null => (isAndroid ? ((window as unknown as { AndroidMpv?: AndroidBridge }).AndroidMpv ?? null) : null);

if (isAndroid && typeof document !== 'undefined') document.documentElement.classList.add('android');
