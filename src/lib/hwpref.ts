// 解码方式偏好：auto = 硬件解码（各平台默认）；sw = 软件解码。播到某个固定位置就卡死时，可以在播放页「倍速」菜单里切换试试。
const K = 'wemby-hwdec';
export type HwPref = 'auto' | 'sw';
export function loadHw(): HwPref {
  try { return localStorage.getItem(K) === 'sw' ? 'sw' : 'auto'; } catch { return 'auto'; }
}
export function saveHw(v: HwPref): void {
  try { localStorage.setItem(K, v); } catch { /* ignore */ }
}

// 片源取流方式：direct = 播放器直接去取 strm 里的远端直链（默认）；emby = 经 Emby 服务器中转（直链被拒绝 403 时用）
const KV = 'wemby-via-emby';
export const loadViaEmby = (): boolean => { try { return localStorage.getItem(KV) === '1'; } catch { return false; } };
export function saveViaEmby(v: boolean): void { try { localStorage.setItem(KV, v ? '1' : '0'); } catch { /* ignore */ } }
