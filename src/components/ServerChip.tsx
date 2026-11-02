// 原「换源」位置：显示当前登录的服务器与用户，点击进入配置页
import { useNavigate } from 'react-router-dom';
import { getSession } from '../emby/session';

export default function ServerChip({ variant }: { variant?: 'sidebar' }) {
  const nav = useNavigate();
  const s = getSession();
  let host = '';
  try {
    host = s ? new URL(s.server).host : '';
  } catch {
    host = s?.server || '';
  }
  return (
    <div className={`srcpick${variant === 'sidebar' ? ' srcpick-sidebar' : ''}`}>
      <div
        className="srcpick-name"
        role="button"
        tabIndex={0}
        title={s ? `${s.userName} @ ${host}（点击进入设置）` : '未登录'}
        onClick={() => nav('/config')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') nav('/config');
        }}
      >
        {s ? `${s.userName} · ${host}` : '未登录'}
      </div>
    </div>
  );
}
