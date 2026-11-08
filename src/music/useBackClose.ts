// 弹层 / 播放页打开时占一条历史记录：安卓返回键、鼠标侧键 → 先关最上面一层，而不是退出页面。
// 用一个全局栈：一次返回只关栈顶一层；从弹层里跳转页面时用 leaveOverlaysThen 先把占的记录全部退掉。
import { useEffect, useRef } from 'react';

interface Entry { mark: number; close: () => void; dead?: boolean }
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
  // 返回键：关栈顶那层；它下面如果有「已经被代码关掉、但历史记录还没退」的层，一并退回去
  let e = stack.pop();
  while (e?.dead) e = stack.pop();
  e?.close();
  let n = 0;
  while (stack.length && stack[stack.length - 1].dead) { stack.pop(); n++; }
  if (n) { ignore++; window.history.go(-n); }
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
      if (i !== stack.length - 1) { entry.dead = true; entry.close = () => undefined; return; }   // 不是栈顶：先标记，等上面的层关掉时一起退
      stack.pop();
      let n = 1;
      while (stack.length && stack[stack.length - 1].dead) { stack.pop(); n++; }
      if (markOf() === entry.mark) { ignore++; window.history.go(-n); }   // 点按钮关的：把占的记录退掉
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
