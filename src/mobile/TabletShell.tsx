// iPad 横屏外壳：左侧边栏 + 顶部搜索 / 设置 + 内容区；音乐播放条是悬浮的玻璃条（样式见 styles/tablet.css）。
// 竖屏仍用手机外壳（MobileShell），只是 tablet.css 把悬浮导航放大。
import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import MiniPlayer from '../music/MiniPlayer';
import AbsBar from '../abs/AbsBar';
import NowPlaying from '../music/NowPlaying';
import { listSources } from '../lib/live';
import { Ico, ICON } from './MobileShell';

type IcoKey = keyof typeof ICON;
interface Item { to: string; label: string; ico: IcoKey; end?: boolean; also?: string[] }

const MAIN: Item[] = [
  { to: '/', label: '影视', ico: 'film', end: true, also: ['/lib', '/search', '/detail', '/person'] },
  { to: '/media', label: '媒体库', ico: 'media' },
  { to: '/discover', label: '片库', ico: 'disc' },
  { to: '/live', label: '直播', ico: 'live' },
  { to: '/music', label: '音乐', ico: 'music' },
  { to: '/audiobooks', label: '有声书', ico: 'book' },
];
const MINE: Item[] = [
  { to: '/favorites', label: '收藏', ico: 'star' },
  { to: '/history', label: '观看历史', ico: 'clock' },
];

/** iPad 是否处于横屏（随旋转实时更新） */
export function useLandscape(): boolean {
  const get = (): boolean => window.innerWidth > window.innerHeight;
  const [v, setV] = useState(get);
  useEffect(() => {
    const f = (): void => setV(get());
    window.addEventListener('resize', f);
    window.addEventListener('orientationchange', f);
    return () => { window.removeEventListener('resize', f); window.removeEventListener('orientationchange', f); };
  }, []);
  return v;
}

export default function TabletShell({ routes }: { routes: React.ReactNode }) {
  const loc = useLocation();
  const nav = useNavigate();
  const p = loc.pathname;
  const [hasLive, setHasLive] = useState(() => listSources().length > 0);
  useEffect(() => {
    const f = (): void => setHasLive(listSources().length > 0);
    window.addEventListener('wemby-live-changed', f);
    return () => window.removeEventListener('wemby-live-changed', f);
  }, []);
  const music = p.startsWith('/music');
  const detail = p.startsWith('/detail') || /^\/discover\/(movie|tv)\//.test(p);
  const on = (it: Item): boolean => (it.end ? p === it.to : p.startsWith(it.to)) || !!it.also?.some((a) => p.startsWith(a));
  const link = (it: Item): React.ReactNode => (
    <NavLink key={it.to} to={it.to} end={it.end} className={`tb-it${on(it) ? ' on' : ''}`} title={it.label}>
      <Ico k={it.ico} />
      <span>{it.label}</span>
    </NavLink>
  );
  return (
    <div className={`tb-app${music ? ' rail' : ''}${detail ? ' detail' : ''}`}>
      <aside className="tb-side">
        <div className="tb-brand" onClick={() => nav('/')}>WEAVE</div>
        {MAIN.filter((i) => i.to !== '/live' || hasLive).map(link)}
        <div className="tb-grp">我的</div>
        {MINE.map(link)}
        <div className="tb-sp" />
        <NavLink to="/me" className={`tb-it${p.startsWith('/me') || p.startsWith('/config') ? ' on' : ''}`} title="账号">
          <Ico k="me" />
          <span>账号</span>
        </NavLink>
      </aside>
      <div className="tb-main">
        {!music && !detail && (
          <div className="tb-top">
            <button type="button" className="tb-search" onClick={() => nav('/search')}>
              <Ico k="search" />
              <span>搜索电影、剧集</span>
            </button>
            <span className="tb-sp" />
            <NavLink to="/config" className="tb-ib" aria-label="设置" title="设置"><Ico k="gear" /></NavLink>
          </div>
        )}
        <div className="tb-body">{routes}</div>
      </div>
      <MiniPlayer />
      <AbsBar />
      <NowPlaying />
    </div>
  );
}
