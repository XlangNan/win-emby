// 自定义无边框标题栏：最小化 / 最大化(还原) / 关闭。
// variant="mac" 仅供大果皮肤的全宽工具栏使用（左置红黄绿圆点）。
// 拖拽由 lib/dragRegion.ts 统一处理（读取 CSS 的 -webkit-app-region）。
import { useEffect, useState } from 'react';
import { isMobileApp } from '../lib/platform';
import { winClose, winIsMaximized, winMinimize, winToggleMax } from '../lib/win';

export default function TitleBar({ title = 'WEAVE', variant = 'win' }: { title?: string; variant?: 'win' | 'mac' }) {
  const [max, setMax] = useState(false);
  useEffect(() => {
    void winIsMaximized().then(setMax).catch(() => undefined);
  }, []);
  const toggleMax = async (): Promise<void> => setMax(await winToggleMax());
  if (isMobileApp) return null; // 手机上没有窗口按钮

  if (variant === 'mac') {
    return (
      <div className="titlebar ap-titlebar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="ap-lights" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button className="ap-light ap-light-close" title="关闭" aria-label="关闭" onClick={() => void winClose()}>
            <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true"><path d="M1.6 1.6l4.8 4.8M6.4 1.6L1.6 6.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
          <button className="ap-light ap-light-min" title="最小化" aria-label="最小化" onClick={() => void winMinimize()}>
            <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true"><path d="M1.2 4h5.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
          <button className="ap-light ap-light-zoom" title={max ? '还原' : '最大化'} aria-label="最大化" onClick={() => void toggleMax()}>
            <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true">
              <path d="M1.5 3V1.5H3M6.5 5v1.5H5M1.5 5v1.5H3M6.5 3V1.5H5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="titlebar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="tb-title" title={title}>
        <img className="tb-ico" src="/icon.png" alt="" draggable={false} role="button" style={{ cursor: 'pointer' }} onClick={() => { window.location.hash = '#/'; }} />
        <span className="tb-text tb-brand">{title}</span>
      </div>
      <div className="tb-controls" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button className="tb-btn" title="最小化" onClick={() => void winMinimize()}>
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><line x1="3.5" y1="8" x2="12.5" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
        <button className="tb-btn" title={max ? '还原' : '最大化'} onClick={() => void toggleMax()}>
          {max ? (
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="3" y="6.5" width="9" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M6.5 3.5h6v6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
          )}
        </button>
        <button className="tb-btn tb-close" title="关闭" onClick={() => void winClose()}>
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  );
}
