// 手机端界面风格：液态玻璃（默认）/ 经典。写 <html data-ui="glass|classic">，样式见 styles/glass.css；浅色外观下自动用经典。
import { useEffect, useState } from 'react';
import { isAndroid } from './platform';

export type UiStyle = 'glass' | 'classic';
const KEY = 'weave-ui';
const EVT = 'wemby:ui-changed';

export function getUi(): UiStyle {
  try { return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'glass'; } catch { return 'glass'; }
}
export function applyUi(u: UiStyle = getUi()): void {
  document.documentElement.setAttribute('data-ui', isAndroid ? u : 'classic');
}
export function setUi(u: UiStyle): void {
  try { localStorage.setItem(KEY, u); } catch { /* ignore */ }
  applyUi(u);
  window.dispatchEvent(new Event(EVT));
}
export function useUi(): UiStyle {
  const [u, setU] = useState<UiStyle>(getUi);
  useEffect(() => {
    const f = (): void => setU(getUi());
    window.addEventListener(EVT, f);
    return () => window.removeEventListener(EVT, f);
  }, []);
  return u;
}
