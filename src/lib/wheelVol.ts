// 电脑版：在播放窗口里滚动鼠标滚轮 = 调音量（画面上、音量条上都生效；列表等能滚动的区域除外）。
import { useEffect, useRef } from 'react';
import { isMobileApp } from './platform';

function inScrollable(el: EventTarget | null): boolean {
  let n = el as HTMLElement | null;
  while (n && n !== document.body) {
    if (n.scrollHeight > n.clientHeight + 2) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === 'auto' || oy === 'scroll') return true;
    }
    n = n.parentElement;
  }
  return false;
}

export function useWheelVolume(getVol: () => number, setVol: (v: number) => void, onUse?: () => void): void {
  const g = useRef(getVol); const s = useRef(setVol); const u = useRef(onUse);
  g.current = getVol; s.current = setVol; u.current = onUse;
  useEffect(() => {
    if (isMobileApp) return;
    const on = (e: WheelEvent): void => {
      if (e.ctrlKey || inScrollable(e.target)) return;
      e.preventDefault();
      s.current(Math.max(0, Math.min(100, g.current() + (e.deltaY < 0 ? 5 : -5))));
      u.current?.();
    };
    window.addEventListener('wheel', on, { passive: false });
    return () => window.removeEventListener('wheel', on);
  }, []);
}
