// 安卓：窗口底色（手势条 / 导航条那一块露出来的颜色）跟页面背景同色；播放页里临时用黑色
import { androidBridge } from './platform';

function pageArgb(): number {
  try {
    for (const el of [document.body, document.getElementById('root'), document.documentElement]) {
      if (!el) continue;
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g); // rgb(r, g, b) / rgba(...)
      if (!m || m.length < 3) continue;
      const a = m.length >= 4 ? Math.round(parseFloat(m[3]) * 255) : 255;
      if (a < 250) continue; // 透明（播放页里页面背景是透明的，画面在原生层）
      return (((a << 24) | (parseInt(m[0]) << 16) | (parseInt(m[1]) << 8) | parseInt(m[2])) | 0);
    }
  } catch { /* ignore */ }
  return 0xff000000 | 0;
}

/** black=true：播放页用黑色；否则取当前页面背景色 */
export function syncWindowBg(black?: boolean): void {
  const apply = (): void => { try { androidBridge()?.setWindowBg?.(black ? 0xff000000 | 0 : pageArgb()); } catch { /* ignore */ } };
  apply();
  // 刚离开播放页时，页面背景可能还是透明的（播放页的样式还没撤掉）：稍后再取一次
  if (!black) { window.setTimeout(apply, 120); window.setTimeout(apply, 600); }
}
