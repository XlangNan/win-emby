// 液态玻璃界面的「氛围背景」：当前页面的海报 / 剧照放大模糊后铺在整个屏幕后面，每部片子的页面颜色都不一样。
// 页面里调用 useAmbient(url)，离开页面时自动清掉（回到默认的深紫渐变）。
import { useEffect, useSyncExternalStore } from 'react';

let cur = '';
const subs = new Set<() => void>();
export function setAmbient(url: string): void {
  if (url === cur) return;
  cur = url;
  subs.forEach((f) => f());
}
const subscribe = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useAmbientUrl = (): string => useSyncExternalStore(subscribe, () => cur);
/** 页面用：把这张图设成氛围背景，离开时还原 */
export function useAmbient(url: string | undefined): void {
  useEffect(() => {
    setAmbient(url || '');
    return () => setAmbient('');
  }, [url]);
}
