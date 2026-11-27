// 织绿皮肤的左侧栏：可收成纯图标模式（收起状态记在 localStorage；窗口很窄时自动收起）
import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

export interface RailItem { to: string; label: string; end?: boolean; ico: string }

const KEY = 'weave-rail-mini';
const P: Record<string, React.ReactNode> = {
  home: <path d="M3 11l9-8 9 8v10h-6v-6H9v6H3z" />,
  film: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M8 4v16M16 4v16M3 9h5M3 15h5M16 9h5M16 15h5" /></>,
  music: <><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>,
  book: <path d="M12 6c-2-1.6-5-2-8-1.5v13c3-.5 6-.1 8 1.5 2-1.6 5-2 8-1.5v-13C17 4 14 4.4 12 6zM12 6v13" />,
  live: <><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M8 3l4 4 4-4" /></>,
  disc: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>,
  dice: <><rect x="4" y="4" width="16" height="16" rx="4" /><circle cx="9" cy="9" r="1" fill="currentColor" /><circle cx="15" cy="15" r="1" fill="currentColor" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>,
};
const Ico = ({ k }: { k: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[k] || P.folder}</svg>
);

function useMini(): [boolean, () => void, boolean] {
  const [pref, setPref] = useState<boolean>(() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } });
  const [narrow, setNarrow] = useState<boolean>(() => window.innerWidth < 980);
  useEffect(() => {
    const on = (): void => setNarrow(window.innerWidth < 980);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const toggle = (): void => {
    const next = !(pref || narrow);
    // 窄窗口下强制收起；用户点展开时，把偏好记成「不收起」，窗口变宽后保持展开
    setPref(next);
    try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* ignore */ }
  };
  return [pref || narrow, toggle, narrow];
}

export default function JadeRail({ browse, libs, mine }: { browse: RailItem[]; libs: RailItem[]; mine: RailItem[] }) {
  const nav = useNavigate();
  const [mini, toggle] = useMini();
  const link = (n: RailItem): React.ReactNode => (
    <NavLink key={n.to} to={n.to} end={n.end} title={mini ? n.label : undefined} aria-label={n.label} className={({ isActive }) => 'jd-nav' + (isActive ? ' active' : '')}>
      <span className="jd-ico"><Ico k={n.ico} /></span>
      <span className="jd-txt">{n.label}</span>
    </NavLink>
  );
  return (
    <aside className={'jd-side' + (mini ? ' mini' : '')}>
      <div className="jd-brand" title="回到首页" role="button" tabIndex={0} onClick={() => nav('/')} onKeyDown={(e) => e.key === 'Enter' && nav('/')}>
        <img className="jd-brand-ico" src="/icon.png" alt="" draggable={false} />
        <span className="jd-txt jd-brand-name">Weave</span>
      </div>
      <div className="jd-scroll">
        <div className="jd-group">{browse.map(link)}</div>
        {libs.length > 0 && <div className="jd-group"><div className="jd-label">媒体库</div>{libs.map(link)}</div>}
        <div className="jd-group"><div className="jd-label">我的</div>{mine.map(link)}</div>
      </div>
      <button className="jd-fold" onClick={toggle} title={mini ? '展开侧栏' : '收起侧栏'} aria-label={mini ? '展开侧栏' : '收起侧栏'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: mini ? 'rotate(180deg)' : 'none' }}><path d="M15 5l-7 7 7 7" /></svg>
        <span className="jd-txt">收起</span>
      </button>
    </aside>
  );
}
