// 弹层 / 播放页打开时占一条历史记录：安卓返回键、鼠标侧键 → 先关弹层而不是退出页面
import { useEffect, useRef } from 'react';

export function useBackClose(open: boolean, close: () => void): void {
  const cb = useRef(close);
  cb.current = close;
  useEffect(() => {
    if (!open) return;
    const mark = { ...(window.history.state as object | null), __mu: Math.random() };
    window.history.pushState(mark, '');
    let popped = false;
    const onPop = (): void => { popped = true; cb.current(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // 不是返回键关的（点了收起按钮）：把我们占的那条记录退掉；若已经跳转到别的页面则不动
      if (!popped && (window.history.state as { __mu?: number } | null)?.__mu === mark.__mu) window.history.back();
    };
  }, [open]);
}
