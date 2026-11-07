// 手动设置的片头时间：按「剧」保存，应用到该剧所有集（只存本机）。
const KEY = 'wemby-intro-manual';
export interface Manual { st: number; en: number; /** 片尾：距结尾多少秒开始 */ tail?: number }
function all(): Record<string, Manual> { try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Manual>; } catch { return {}; } }
export const getManual = (seriesId?: string): Manual | null => (seriesId ? all()[seriesId] || null : null);
export function setManual(seriesId: string, m: Manual | null): void {
  const a = all();
  if (m) a[seriesId] = m; else delete a[seriesId];
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* ignore */ }
}
