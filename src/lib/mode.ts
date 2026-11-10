// 外观模式：深色 / 浅色 / 跟随系统。写 <html data-mode="dark|light">，样式见 styles/light.css。
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
  try { localStorage.setItem(KEY, p); } catch { /* ignore */ }
}

export function initMode(): void {
  applyMode(loadMode());
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (loadMode() === 'system') applyMode('system'); });
  } catch { /* ignore */ }
}
