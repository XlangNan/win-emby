// 「我的」：历史 / 收藏 / 直播 / 设置 的入口
import { useNavigate } from 'react-router-dom';
import ServerChip from '../components/ServerChip';
import { getSession } from '../emby/session';

const ROWS: { to: string; label: string; sub: string }[] = [
  { to: '/history', label: '观看历史', sub: '看过的影片和进度' },
  { to: '/favorites', label: '我的收藏', sub: '收藏的电影和剧集' },
  { to: '/live', label: '直播源设置', sub: '添加 M3U 直播源后，底部会出现「直播」' },
  { to: '/config', label: '设置', sub: '账号、播放、片库订阅、字体' },
];

export default function MePage() {
  const nav = useNavigate();
  const s = getSession();
  return (
    <div className="content m-me">
      <div className="m-me-head">
        <div className="m-me-avatar">{(s?.userName || 'U').slice(0, 1).toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <div className="m-me-name">{s?.userName || '未登录'}</div>
          <div className="muted m-me-srv">{s?.serverName || s?.server || ''}</div>
        </div>
        <span style={{ flex: 1 }} />
        <ServerChip />
      </div>
      <div className="m-me-list">
        {ROWS.map((r) => (
          <div key={r.to} className="m-me-row" role="button" tabIndex={0} onClick={() => nav(r.to)}>
            <div>
              <div className="m-me-l">{r.label}</div>
              <div className="muted m-me-s">{r.sub}</div>
            </div>
            <span className="m-me-arrow">›</span>
          </div>
        ))}
      </div>
    </div>
  );
}
