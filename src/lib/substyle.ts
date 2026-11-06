// 字幕样式（大小 / 上下位置 / 延迟）：存本机，播放时应用到 mpv。
import type { MpvSession } from './mpv';

const KEY = 'wemby-sub-style';

export interface SubStyle {
  /** 大小倍数，1 = 默认 */
  scale: number;
  /** 抬高多少（占画面高度的 %），0 = 默认贴底 */
  lift: number;
  /** 延迟（秒），正数 = 字幕晚出现 */
  delay: number;
}

export const SUB_DEFAULT: SubStyle = { scale: 1, lift: 0, delay: 0 };

export function loadSubStyle(): SubStyle {
  try {
    return { ...SUB_DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<SubStyle>) };
  } catch {
    return { ...SUB_DEFAULT };
  }
}

export function saveSubStyle(s: SubStyle): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** 应用到 mpv。自定义大小 / 位置时让 mpv 对 ASS 特效字幕也生效（sub-ass-override=force），恢复默认时还原 */
export async function applySubStyle(sess: MpvSession, s: SubStyle): Promise<void> {
  const custom = Math.abs(s.scale - 1) > 0.001 || s.lift > 0;
  await sess.set('sub-ass-override', custom ? 'force' : 'scale').catch(() => undefined);
  await sess.set('sub-scale', Number(s.scale.toFixed(2))).catch(() => undefined);
  await sess.set('sub-pos', Math.max(0, Math.min(100, 100 - Math.round(s.lift)))).catch(() => undefined);
  await sess.set('sub-delay', Number(s.delay.toFixed(1))).catch(() => undefined);
}
