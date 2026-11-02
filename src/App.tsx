// 应用外壳：四套皮肤各有独立外壳（顶栏 / 双行头 / 玻璃侧边栏 / 胶囊导航），结构与原 Win-Box 一致。
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import AppAmbient from './components/AppAmbient';
import SearchPanel from './components/SearchPanel';
import ServerChip from './components/ServerChip';
import TitleBar from './components/TitleBar';
import { emby } from './emby/client';
import { SESSION_EVENT, clearSession, getSession } from './emby/session';
import ConfigPage from './pages/ConfigPage';
import DetailPage from './pages/DetailPage';
import FavoritesPage from './pages/FavoritesPage';
import HistoryPage from './pages/HistoryPage';
import HomePage from './pages/HomePage';
import LibraryPage from './pages/LibraryPage';
import LivePage from './pages/LivePage';
import LivePlayer from './pages/LivePlayer';
import LoginPage from './pages/LoginPage';
import PlayerPage from './pages/PlayerPage';
import SearchPage from './pages/SearchPage';
import { useSkinLayout } from './lib/theme';
import type { EmbyItem } from './emby/types';

interface NavItem { to: string; label: string; ico: string; end?: boolean }

const SHOWN_TYPES = new Set(['movies', 'tvshows', 'homevideos', 'boxsets', 'mixed', undefined, '']);
const libIco = (t?: string): string => (t === 'movies' ? '🎬' : t === 'tvshows' ? '📺' : '📁');

const AP_ICON = {
  home: <path d="M2.6 7.1 8 2.8l5.4 4.3v5.2a.9.9 0 0 1-.9.9H3.5a.9.9 0 0 1-.9-.9V7.1Z" />,
  lib: (
    <>
      <rect x="1.9" y="3.3" width="12.2" height="9.4" rx="2.3" />
      <path d="M6.7 6.2v3.6l3.2-1.8-3.2-1.8Z" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5.1V8l2.1 1.4" />
    </>
  ),
  star: <path d="M8 1.9l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.7l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />,
  gear: (
    <>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.9v1.5M8 12.6v1.5M1.9 8h1.5M12.6 8h1.5M3.7 3.7l1.1 1.1M11.2 11.2l1.1 1.1M12.3 3.7l-1.1 1.1M4.8 11.2l-1.1 1.1" />
    </>
  ),
};

function ApIcon({ k }: { k: keyof typeof AP_ICON }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {AP_ICON[k]}
    </svg>
  );
}

function PageShell() {
  const loc = useLocation();
  return (
    <div className="page-anim" key={loc.pathname}>
      <Outlet />
    </div>
  );
}

function useSession() {
  const [s, setS] = useState(getSession);
  useEffect(() => {
    const on = (): void => setS(getSession());
    window.addEventListener(SESSION_EVENT, on);
    return () => window.removeEventListener(SESSION_EVENT, on);
  }, []);
  return s;
}

export default function App() {
  const session = useSession();
  // 不显示浏览器自带的右键菜单（输入框里保留，方便复制粘贴）；影片卡片有自己的菜单
  useEffect(() => {
    const block = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
    };
    window.addEventListener('contextmenu', block);
    return () => window.removeEventListener('contextmenu', block);
  }, []);
  if (!session) return <LoginPage />;
  return <AppShell key={session.userId + session.server} />;
}

function AppShell() {
  const nav = useNavigate();
  const loc = useLocation();
  const shell = useSkinLayout().shell ?? 'topbar';
  const [views, setViews] = useState<EmbyItem[]>([]);

  useEffect(() => {
    emby
      .views()
      .then((v) => setViews(v.filter((x) => SHOWN_TYPES.has(x.CollectionType))))
      .catch((e: Error & { status?: number }) => {
        if (e.status === 401) clearSession(); // token 失效 → 回登录页
      });
  }, []);

  const mainNav: NavItem[] = useMemo(
    () => [{ to: '/', label: '首页', ico: '🧭', end: true }, ...views.map((v) => ({ to: `/lib/${v.Id}`, label: v.Name, ico: libIco(v.CollectionType) }))],
    [views],
  );
  const myNav: NavItem[] = [
    { to: '/live', label: '直播', ico: '📡' },
    { to: '/favorites', label: '收藏', ico: '⭐' },
    { to: '/history', label: '历史', ico: '🕘' },
    { to: '/config', label: '设置', ico: '⚙' },
  ];
  const allNav = [...mainNav, ...myNav];

  const isPlayer = loc.pathname.startsWith('/player/') || loc.pathname === '/live/play';
  const pageTitle = useMemo(() => {
    const p = loc.pathname;
    if (p === '/') return '首页';
    if (p.startsWith('/lib/')) return views.find((v) => p.endsWith(v.Id))?.Name || '媒体库';
    if (p.startsWith('/detail')) return '影片详情';
    if (p.startsWith('/search')) return '搜索';
    return allNav.find((n) => p.startsWith(n.to))?.label || 'Win-Emby';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname, views]);

  const goBack = (): void => {
    if (window.history.length > 1) nav(-1);
    else nav('/', { replace: true });
  };

  // 返回：Alt+← / Backspace（输入控件内不拦截；播放页自己处理）
  useEffect(() => {
    if (isPlayer) return;
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (((e.altKey && e.key === 'ArrowLeft') || e.key === 'Backspace') && loc.pathname !== '/') {
        e.preventDefault();
        goBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname, isPlayer]);

  const routes = (
    <Routes>
      <Route element={<PageShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/lib/:id" element={<LibraryPage />} />
        <Route path="/detail/:id" element={<DetailPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/live" element={<LivePage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );

  // 播放页：独占整个窗口，不带外壳
  if (isPlayer) {
    return (
      <Routes>
        <Route path="/player/:id" element={<PlayerPage />} />
        <Route path="/live/play" element={<LivePlayer />} />
      </Routes>
    );
  }

  // ── 大果：全宽工具栏 + 玻璃侧边栏 ──
  if (shell === 'sidebar') {
    const apIco = (n: NavItem): React.ReactNode =>
      n.to === '/' ? <ApIcon k="home" /> : n.to === '/favorites' ? <ApIcon k="star" /> : n.to === '/history' ? <ApIcon k="clock" /> : n.to === '/config' ? <ApIcon k="gear" /> : <ApIcon k="lib" />;
    const groups = [
      { label: '媒体', items: mainNav },
      { label: '我的', items: myNav },
    ];
    return (
      <div className="app ap-app">
        <AppAmbient />
        <header className="ap-toolbar">
          <TitleBar variant="mac" />
          <button className="ap-navbtn" title="返回" aria-label="返回" disabled={loc.pathname === '/'} onClick={goBack}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9.8 3.4 5.2 8l4.6 4.6" />
            </svg>
          </button>
          <span className="ap-toolbar-title">{pageTitle}</span>
          <span className="ap-spacer" />
          <SearchPanel />
        </header>
        <div className="ap-body">
          <aside className="ap-sidebar">
            <div className="ap-brand" title="Win-Emby">
              <img className="ap-brand-ico" src="/icon.png" alt="" draggable={false} />
              <span className="ap-brand-name">Win-Emby</span>
            </div>
            {groups.map((g) => (
              <div key={g.label} className="ap-group">
                <div className="ap-group-label">{g.label}</div>
                {g.items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'ap-nav' + (isActive ? ' active' : '')}>
                    <span className="ap-nav-ico">{apIco(n)}</span>
                    <span className="ap-nav-txt">{n.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
            <div className="ap-side-spacer" />
            <ServerChip variant="sidebar" />
          </aside>
          <main className="ap-main">{routes}</main>
        </div>
      </div>
    );
  }

  // ── 哔哔：双行头 ──
  if (shell === 'dualbar') {
    return (
      <div className="app bb-app">
        <AppAmbient />
        <header className="bb-head">
          <div className="bb-top">
            <span className="bb-brand" title="Win-Emby">
              <span className="bb-brand-mark" aria-hidden="true">b</span>
              WIN-EMBY
            </span>
            <SearchPanel bar />
            <span className="bb-spacer" />
            <ServerChip />
            <TitleBar />
          </div>
          <nav className="bb-tabs">
            {allNav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'bb-tab' + (isActive ? ' active' : '')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="bb-main">{routes}</main>
      </div>
    );
  }

  // ── 大豆：胶囊导航 ──
  if (shell === 'pillbar') {
    return (
      <div className="app db-app">
        <AppAmbient />
        <header className="db-head">
          <div className="db-topbar">
            <span className="db-brand" title="Win-Emby">
              <img className="db-brand-ico" src="/icon.png" alt="" draggable={false} />
              WIN-EMBY
            </span>
            <span className="db-title">{pageTitle}</span>
            <SearchPanel bar />
            <span className="db-spacer" />
            <ServerChip />
            <TitleBar />
          </div>
          <nav className="db-nav">
            {allNav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'db-chip' + (isActive ? ' active' : '')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="db-main">{routes}</main>
      </div>
    );
  }

  // ── 网飝（默认）：单行顶栏 ──
  return (
    <div className="app nf netflix">
      <AppAmbient />
      <main className="main">
        <nav className="nf-nav">
          <span className="nf-logo">WIN-EMBY</span>
          <div className="we-navlinks" onWheel={(e) => { e.currentTarget.scrollLeft += e.deltaY; }}>
            {allNav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'nf-link' + (isActive ? ' active' : '')}>
                {n.label}
              </NavLink>
            ))}
          </div>
          <span className="nf-spacer" />
          <SearchPanel />
          <ServerChip />
          <TitleBar />
        </nav>
        {routes}
      </main>
    </div>
  );
}
