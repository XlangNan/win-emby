// 音乐选项（本机保存）：随机歌曲数量 / 底部栏歌词 / 在线歌词封面接口
import { useSyncExternalStore } from 'react';

export interface MusicOpts { randomN: number; radioN: number; barLyric: boolean; autoLyric: boolean; neteaseApi: string; metingApi: string }
const KEY = 'wemby-music-opts';
const DEF: MusicOpts = { randomN: 30, radioN: 60, barLyric: true, autoLyric: true, neteaseApi: '', metingApi: '' };
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
  n.neteaseApi = n.neteaseApi.trim().replace(/\/+$/, '');
  n.metingApi = n.metingApi.trim();
  cache = n;
  try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* ignore */ }
  subs.forEach((f) => f());
  return n;
}
const subscribe = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function useOpts(): MusicOpts { return useSyncExternalStore(subscribe, loadOpts); }
