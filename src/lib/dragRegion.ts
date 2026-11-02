// 无边框窗口拖拽：沿用原皮肤 CSS 里的 `-webkit-app-region: drag | no-drag` 声明。
// WebView2 默认不处理这个属性，这里读取计算样式，命中 drag 区域时调用 Tauri 的 startDragging，
// 双击 drag 区域 = 最大化 / 还原。这样四套皮肤的外壳样式不用改。
import { winStartDrag, winToggleMax } from './win';
import { isTauri } from '../emby/http';

const INTERACTIVE = 'button,input,select,textarea,a,[role="button"],[contenteditable="true"],video';

function regionOf(start: HTMLElement | null): 'drag' | 'no-drag' | null {
  for (let n: HTMLElement | null = start; n && n !== document.documentElement; n = n.parentElement) {
    const cs = getComputedStyle(n) as CSSStyleDeclaration & { webkitAppRegion?: string };
    const v = (cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region') || '').trim();
    if (v === 'drag' || v === 'no-drag') return v;
  }
  return null;
}

export function installDragRegion(): void {
  if (!isTauri()) return;
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.detail > 1) return;
    const t = e.target as HTMLElement | null;
    if (!t || t.closest(INTERACTIVE)) return;
    if (regionOf(t) === 'drag') void winStartDrag();
  });
  document.addEventListener('dblclick', (e) => {
    const t = e.target as HTMLElement | null;
    if (!t || t.closest(INTERACTIVE)) return;
    if (regionOf(t) === 'drag') void winToggleMax();
  });
}
