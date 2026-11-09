// 自绘滚动条（不占位置）：
// 手机：滚动时显示一条细指示条；电脑：滚动时显示，鼠标移到滚动区域右边缘时也显示，并且可以按住拖动。
import { useEffect, useRef } from 'react';
import { isMobileApp } from '../lib/platform';

function findScroller(t: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = t;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.scrollHeight > el.clientHeight + 4) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return el;
    }
    el = el.parentElement;
  }
  return null;
}

export default function ScrollIndicator() {
  const bar = useRef<HTMLDivElement>(null);
  const cur = useRef<HTMLElement | null>(null);
  const drag = useRef<{ y: number; top: number } | null>(null);
  const hover = useRef(false);
  const timer = useRef(0);

  const place = (el: HTMLElement): void => {
    const b = bar.current;
    if (!b) return;
    const r = el.getBoundingClientRect();
    const h = Math.max(32, (el.clientHeight / el.scrollHeight) * r.height);
    const top = r.top + (el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)) * (r.height - h);
    b.style.height = `${h}px`;
    b.style.transform = `translateY(${top}px)`;
    b.style.right = `${Math.max(1, window.innerWidth - r.right + 1)}px`;
  };
  const hideNow = (): void => {
    const b = bar.current;
    if (!b) return;
    drag.current = null;
    hover.current = false;
    b.style.opacity = '0';
    b.style.pointerEvents = 'none';
  };
  /** 滚动区域已被移除 / 不再可滚动（比如弹窗关了）：立刻收起，鼠标还停在条上也一样 */
  const validate = (): void => {
    const el = cur.current, b = bar.current;
    if (!b || b.style.opacity !== '1') return;
    if (!el || !el.isConnected || el.scrollHeight <= el.clientHeight + 4 || el.getClientRects().length === 0) { cur.current = null; hideNow(); return; }
    place(el);
  };
  const hideLater = (ms = 700): void => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const b = bar.current;
      if (!b || drag.current || hover.current) return;
      b.style.opacity = '0';
      b.style.pointerEvents = 'none';
    }, ms);
  };
  const show = (el: HTMLElement): void => {
    const b = bar.current;
    if (!b) return;
    cur.current = el;
    place(el);
    b.style.opacity = '1';
    b.style.pointerEvents = isMobileApp ? 'none' : 'auto';
    hideLater();
  };

  useEffect(() => {
    const onScroll = (e: Event): void => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el.scrollHeight <= el.clientHeight + 4 || el.hasAttribute('data-noscrollbar')) return;
      if (drag.current && cur.current === el) { place(el); return; }
      show(el);
    };
    let raf = 0;
    const onMove = (e: MouseEvent): void => {
      if (isMobileApp || drag.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = findScroller(e.target as HTMLElement);
        if (el && !el.hasAttribute('data-noscrollbar')) {
          const r = el.getBoundingClientRect();
          if (e.clientX >= r.right - 18 && e.clientX <= r.right + 2) { show(el); return; }
        }
        hideLater(500);
      });
    };
    const iv = window.setInterval(validate, 250);
    const onClick = (): void => { window.setTimeout(validate, 60); };
    document.addEventListener('click', onClick, true);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.clearInterval(iv);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mousemove', onMove);
      window.clearTimeout(timer.current);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`we-sbar${isMobileApp ? ' phone' : ''}`}
      ref={bar}
      onMouseEnter={() => { hover.current = true; window.clearTimeout(timer.current); }}
      onMouseLeave={() => { hover.current = false; hideLater(400); }}
      onPointerDown={(e) => {
        const el = cur.current;
        if (!el) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, top: el.scrollTop };
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        const d = drag.current, el = cur.current;
        if (!d || !el) return;
        const r = el.getBoundingClientRect();
        const track = Math.max(1, r.height - (bar.current?.offsetHeight || 32));
        el.scrollTop = d.top + ((e.clientY - d.y) * (el.scrollHeight - el.clientHeight)) / track;
      }}
      onPointerUp={() => { drag.current = null; hideLater(600); }}
      onPointerCancel={() => { drag.current = null; }}
    />
  );
}
