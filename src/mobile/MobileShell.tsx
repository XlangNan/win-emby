// 手机外壳（安卓）：底部标签栏 + 首页顶部品牌/分类条。结构参照主流流媒体手机 App 的交互习惯。
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { androidBridge } from '../lib/platform';
import type { EmbyItem } from '../emby/types';
import { listSources } from '../lib/live';

const ICON = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z" />,
  media: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m10 9 5 3-5 3V9Z" />
    </>
  ),
  disc: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  live: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="m9 3 3 3 3-3" />
    </>
  ),
  me: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.2-4 4.2-6 8-6s6.8 2 8 6" />
    </>
  ),
};

function Ico({ k }: { k: keyof typeof ICON }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON[k]}
    </svg>
  );
}

const TABS: { to: string; label: string; ico: keyof typeof ICON; end?: boolean; also?: string[] }[] = [
  { to: '/', label: '首页', ico: 'home', end: true },
  { to: '/media', label: '媒体', ico: 'media', also: ['/lib'] },
  { to: '/discover', label: '片库', ico: 'disc' },
  { to: '/live', label: '直播', ico: 'live' },
  { to: '/me', label: '我的', ico: 'me', also: ['/favorites', '/history', '/config'] },
];

export default function MobileShell({ views, routes }: { views: EmbyItem[]; routes: React.ReactNode }) {
  const loc = useLocation();
  const nav = useNavigate();
  const p = loc.pathname;
  const home = p === '/';
  const [hasLive, setHasLive] = useState(() => listSources().length > 0);
  useEffect(() => {
    const f = (): void => setHasLive(listSources().length > 0);
    window.addEventListener('wemby-live-changed', f);
    return () => window.removeEventListener('wemby-live-changed', f);
  }, []);
  // 状态栏高度 → --sat（原生不再给顶部留白，详情页的图片才能铺到状态栏下面）
  useEffect(() => {
    const set = (): void => {
      try {
        const v = androidBridge()?.getInsetTop?.();
        if (typeof v === 'number') document.documentElement.style.setProperty('--sat', `${v}px`);
      } catch { /* ignore */ }
    };
    set();
    const t = window.setTimeout(set, 400);
    window.addEventListener('resize', set);
    return () => { window.clearTimeout(t); window.removeEventListener('resize', set); };
  }, []);
  const hideTabs = p.startsWith('/live/play') || p.startsWith('/detail') || /^\/discover\/(movie|tv)\//.test(p);

  return (
    <div className={`m-app${p.startsWith('/detail') ? ' m-app-detail' : ''}`}>
      <div className="m-main">
        {home && (
          <header className="m-head">
            <div className="m-head-top">
              <span className="m-brand" onClick={() => nav('/')}>WEAVE</span>
              <span style={{ flex: 1 }} />
              <button className="m-iconbtn" aria-label="搜索" onClick={() => nav('/search')}><Ico k="search" /></button>
            </div>
          </header>
        )}
        {routes}
      </div>
      {!hideTabs && (
        <nav className="m-tabs" aria-label="主导航">
          {TABS.filter((t) => t.to !== '/live' || hasLive).map((t) => {
            const active = t.end ? p === t.to : p.startsWith(t.to) || !!t.also?.some((a) => p.startsWith(a));
            return (
              <NavLink key={t.to} to={t.to} end={t.end} className={`m-tab${active ? ' active' : ''}`}>
                <Ico k={t.ico} />
                <span>{t.label}</span>
              </NavLink>
            );
          })}
        </nav>
      )}
    </div>
  );
}
