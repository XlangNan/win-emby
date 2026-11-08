// 弹层 / 播放页打开时占一条历史记录：安卓返回键、鼠标侧键 → 先关最上面一层，而不是退出页面。
// 用一个全局栈：一次返回只关栈顶一层；从弹层里跳转页面时用 leaveOverlaysThen 先把占的记录全部退掉。
import { useEffect, useRef } from 'react';

interface Entry { mark: number; close: () => void }
const stack: Entry[] = [];
let ignore = 0;
let after: (() => void) | null = null;
let listening = false;

function onPop(): void {
  if (ignore > 0) {
    ignore--;
    if (ignore === 0 && after) { const f = after; after = null; f(); }
    return;
  }
  stack.pop()?.close();
}

const markOf = (): number | undefined => (window.history.state as { __mu?: number } | null)?.__mu;

export function useBackClose(open: boolean, close: () => void): void {
  const cb = useRef(close);
  cb.current = close;
  useEffect(() => {
    if (!open) return;
    if (!listening) { window.addEventListener('popstate', onPop); listening = true; }
    const entry: Entry = { mark: Math.random(), close: () => cb.current() };
    window.history.pushState({ ...(window.history.state as object | null), __mu: entry.mark }, '');
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i < 0) return;                 // 已被返回键 / leaveOverlaysThen 弹出
      stack.splice(i, 1);
      if (i === stack.length && markOf() === entry.mark) { ignore++; window.history.back(); }   // 点按钮关的：把占的记录退掉
    };
  }, [open]);
}

/** 先关掉所有弹层并退回它们占的历史记录，再执行跳转（避免要多按一次返回） */
export function leaveOverlaysThen(fn: () => void): void {
  const n = stack.length;
  if (!n) { fn(); return; }
  const list = stack.splice(0, n);
  after = fn;
  ignore = 1;
  list.reverse().forEach((e) => e.close());
  window.history.go(-n);
}
