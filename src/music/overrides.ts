// 本机覆盖：歌词（LRC 文本）和封面（缩小后的图片）。只保存在这台设备上，不会写回 Navidrome。
import { useSyncExternalStore } from 'react';

const LRC = 'wemby-lrc:';
const COV = 'wemby-cover:';
const covMem = new Map<string, string | null>();
let ver = 0;
const subs = new Set<() => void>();
const bump = (): void => { ver++; subs.forEach((f) => f()); };

export function getLrcOverride(songId: string): string {
  try { return localStorage.getItem(LRC + songId) || ''; } catch { return ''; }
}
export function setLrcOverride(songId: string, text: string | null): void {
  try { if (text && text.trim()) localStorage.setItem(LRC + songId, text); else localStorage.removeItem(LRC + songId); } catch { /* 空间不够 */ }
  bump();
}
export function getCoverOverride(coverId: string): string {
  if (!coverId) return '';
  if (covMem.has(coverId)) return covMem.get(coverId) || '';
  let v: string | null = null;
  try { v = localStorage.getItem(COV + coverId); } catch { /* ignore */ }
  covMem.set(coverId, v);
  return v || '';
}
export function setCoverOverride(coverId: string, dataUrl: string | null): boolean {
  try {
    if (dataUrl) localStorage.setItem(COV + coverId, dataUrl); else localStorage.removeItem(COV + coverId);
  } catch { return false; }
  covMem.set(coverId, dataUrl);
  bump();
  return true;
}
const subscribe = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** 覆盖有变化时让组件重新渲染 */
export function useOverrideVer(): number { return useSyncExternalStore(subscribe, () => ver); }
