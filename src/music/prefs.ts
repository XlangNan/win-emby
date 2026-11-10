// 音乐选项（本机保存）：随机歌曲数量 / 底部栏歌词 / 在线歌词封面接口
import { useSyncExternalStore } from 'react';

export interface MusicOpts { randomN: number; radioN: number; barLyric: boolean; autoLyric: boolean; lyrSize: number; neteaseApi: string; metingApi: string }
const KEY = 'wemby-music-opts';
/** 歌词字号档位（倍数）：小 / 中 / 大 / 特大 / 超大 */
export const LYR_SIZES = [0.85, 1, 1.18, 1.38, 1.6] as const;
export const LYR_SIZE_NAMES = ['小', '中', '大', '特大', '超大'] as const;
const DEF: MusicOpts = { randomN: 30, radioN: 60, barLyric: true, autoLyric: true, lyrSize: 1, neteaseApi: '', metingApi: '' };
let cache: MusicOpts | null = null;
const subs = new Set<() => void>();

export function loadOpts(): MusicOpts {
  if (cache) return cache;
  try { cache = { ...DEF, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<MusicOpts>) }; } catch { cache = { ...DEF }; }
  return cache;
}
export function saveOpts(p: Partial<MusicOpts>): MusicOpts {
  const n = { ...loadOpts(), ...p };
  n.randomN = Math.min(300, Math.max(5, Math.round(Number(n.randomN)) || DEF.randomN));
  n.radioN = Math.min(300, Math.max(10, Math.round(Number(n.radioN)) || DEF.radioN));
  n.lyrSize = Math.min(LYR_SIZES.length - 1, Math.max(0, Math.round(Number(n.lyrSize)) || 0));
  n.neteaseApi = n.neteaseApi.trim().replace(/\/+$/, '');
  n.metingApi = n.metingApi.trim();
  cache = n;
  try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* ignore */ }
  subs.forEach((f) => f());
  return n;
}
const subscribe = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function useOpts(): MusicOpts { return useSyncExternalStore(subscribe, loadOpts); }
