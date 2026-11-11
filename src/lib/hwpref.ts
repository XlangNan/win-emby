// 解码方式偏好：auto = 硬件解码（各平台默认）；sw = 软件解码。播到某个固定位置就卡死时，可以在播放页「倍速」菜单里切换试试。
const K = 'wemby-hwdec';
export type HwPref = 'auto' | 'sw';
export function loadHw(): HwPref {
  try { return localStorage.getItem(K) === 'sw' ? 'sw' : 'auto'; } catch { return 'auto'; }
}
export function saveHw(v: HwPref): void {
  try { localStorage.setItem(K, v); } catch { /* ignore */ }
}
