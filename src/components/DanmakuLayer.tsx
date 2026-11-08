// 弹幕画布：按播放时间确定性绘制（拖动进度也不乱），滚动弹幕按轨道排布避免重叠
import { useEffect, useRef } from 'react';
import type { Dm } from '../lib/danmaku';

export default function DanmakuLayer({
  list, getTime, size, speed, opacity, area, offset, visible,
}: { list: Dm[]; getTime: () => number; size: number; speed: number; opacity: number; area: number; offset: number; visible: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const live = useRef({ list, getTime, size, speed, opacity, area, offset, visible });
  live.current = { list, getTime, size, speed, opacity, area, offset, visible };

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let W = 0, H = 0;
    let layoutKey = '';
    let lanes: { x0: number; w: number; lane: number; kind: number }[] = [];
    let widths = new WeakMap<Dm, number>();
    let widthFont = 0;

    const resize = (): void => {
      const r = c.getBoundingClientRect();
      const d = window.devicePixelRatio || 1;
      W = r.width; H = r.height;
      c.width = Math.round(W * d); c.height = Math.round(H * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c);

    const layout = (): void => {
      const { list: L, size: S, speed: V, area: A, offset: O } = live.current;
      const key = `${L.length}|${S}|${V}|${A}|${O}|${Math.round(W)}|${Math.round(H)}`;
      if (key === layoutKey) return;
      layoutKey = key;
      ctx.font = `700 ${S}px sans-serif`;
      if (widthFont !== S) { widths = new WeakMap(); widthFont = S; }   // 字号变了：旧宽度作废
      const lineH = S * 1.35;
      const n = Math.max(1, Math.floor(Math.min(H * A, H * (1 - O) - lineH) / lineH));
      const free = new Array<number>(n).fill(-1e9);
      const freeTop = new Array<number>(n).fill(-1e9);
      const freeBot = new Array<number>(n).fill(-1e9);
      lanes = new Array(L.length);
      L.forEach((d, i) => {
        let w = widths.get(d) ?? 0;
        if (!w) { w = ctx.measureText(d.text).width; widths.set(d, w); }
        let lane = -1;
        if (d.mode === 'scroll') {
          // 一条轨道在上一条弹幕完全进入屏幕后才可再用（速度相同，不会追尾）
          for (let l = 0; l < n; l++) if (free[l] <= d.t) { lane = l; free[l] = d.t + (w + 24) / V; break; }
        } else {
          const arr = d.mode === 'top' ? freeTop : freeBot;
          for (let l = 0; l < n; l++) if (arr[l] <= d.t) { lane = l; arr[l] = d.t + 4; break; }
        }
        lanes[i] = { x0: 0, w, lane, kind: d.mode === 'scroll' ? 0 : d.mode === 'top' ? 1 : 2 };
      });
    };

    const lo = (L: Dm[], t: number): number => {
      let a = 0, b = L.length;
      while (a < b) { const m = (a + b) >> 1; if (L[m].t < t) a = m + 1; else b = m; }
      return a;
    };

    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const { list: L, getTime: gt, size: S, speed: V, opacity: O, offset: OFF, visible: vis } = live.current;
      ctx.clearRect(0, 0, W, H);
      if (!vis || !L.length || !W) return;
      layout();
      const now = gt();
      const lineH = S * 1.35;
      ctx.font = `700 ${S}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.globalAlpha = O;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.8)';
      const maxLife = Math.max(4, (W + 600) / V);
      for (let i = lo(L, now - maxLife); i < L.length; i++) {
        const d = L[i];
        if (d.t > now) break;
        const ln = lanes[i];
        if (!ln || ln.lane < 0) continue;
        const age = now - d.t;
        let x: number, y: number;
        if (ln.kind === 0) {
          x = W - age * V;
          if (x + ln.w < 0) continue;
          y = H * OFF + ln.lane * lineH + 4;
        } else {
          if (age > 4) continue;
          x = (W - ln.w) / 2;
          y = ln.kind === 1 ? H * OFF + ln.lane * lineH + 4 : H - (ln.lane + 1) * lineH - 4;
        }
        ctx.strokeText(d.text, x, y);
        ctx.fillStyle = d.color;
        ctx.fillText(d.text, x, y);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={cv} className="we-danmaku" aria-hidden="true" />;
}
