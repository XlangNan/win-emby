import type { EmbyItem } from './types';

export const ticksToSec = (t?: number): number => (t ? t / 1e7 : 0);

export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** 「1 小时 52 分钟」 */
export function fmtRuntime(ticks?: number): string {
  const min = Math.round(ticksToSec(ticks) / 60);
  if (!min) return '';
  return min >= 60 ? `${Math.floor(min / 60)} 小时 ${min % 60} 分钟` : `${min} 分钟`;
}

/** 卡片主标题：单集显示剧名 */
export function cardTitle(it: EmbyItem): string {
  return it.Type === 'Episode' && it.SeriesName ? it.SeriesName : it.Name;
}

/** 卡片副标题：单集显示 S01E02 · 集名；其余显示年份 */
export function cardSub(it: EmbyItem): string {
  if (it.Type === 'Episode') {
    const s = it.ParentIndexNumber != null ? `S${String(it.ParentIndexNumber).padStart(2, '0')}` : '';
    const e = it.IndexNumber != null ? `E${String(it.IndexNumber).padStart(2, '0')}` : '';
    return `${s}${e} · ${it.Name}`;
  }
  if (it.Type === 'Series' && it.UserData?.UnplayedItemCount) return `${it.UserData.UnplayedItemCount} 集未看`;
  return it.ProductionYear ? String(it.ProductionYear) : '';
}

/** 观看进度百分比（0-100），已看完/未开始返回 0 */
export function progressPct(it: EmbyItem): number {
  const p = it.UserData?.PlayedPercentage;
  if (p && p > 0 && p < 100) return p;
  const pos = it.UserData?.PlaybackPositionTicks || 0;
  const total = it.RunTimeTicks || 0;
  return pos > 0 && total > 0 ? Math.min(99, (pos / total) * 100) : 0;
}
