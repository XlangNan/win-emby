// 外观模式：深色 / 浅色 / 跟随系统。写 <html data-mode="dark|light">，样式见 styles/light.css。
import { androidBridge } from './platform';
import { syncWindowBg } from './bars';
const KEY = 'wemby-mode';
export type ModePref = 'dark' | 'light' | 'system';
export const MODE_LABELS: [ModePref, string][] = [['dark', '深色'], ['light', '浅色'], ['system', '跟随系统']];

export function loadMode(): ModePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch { /* ignore */ }
  return 'dark';
}

function systemLight(): boolean {
  try { return window.matchMedia('(prefers-color-scheme: light)').matches; } catch { return false; }
}

export function applyMode(p: ModePref): void {
  const light = p === 'light' || (p === 'system' && systemLight());
  const root = document.documentElement;
  root.setAttribute('data-mode', light ? 'light' : 'dark');
  root.style.colorScheme = light ? 'light' : 'dark';
  let m = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
  m.content = light ? '#f5f5f7' : '#000000';
  // 安卓：状态栏 / 导航栏图标跟着明暗走（浅色模式用深色图标，否则白底上看不见）；播放页内保持浅色图标
  try { if (!window.location.hash.startsWith('#/player/')) androidBridge()?.setStatusBarLight?.(light); } catch { /* ignore */ }
  syncWindowBg(window.location.hash.startsWith('#/player/') || window.location.hash.startsWith('#/live/play'));
  try { localStorage.setItem(KEY, p); } catch { /* ignore */ }
}

export function initMode(): void {
  applyMode(loadMode());
  // 切后台再回来，部分手机会把状态栏图标还原：回到前台时再设一次
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') applyMode(loadMode()); });
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (loadMode() === 'system') applyMode('system'); });
  } catch { /* ignore */ }
}
