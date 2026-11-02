// 原「换源」位置：显示当前账号，点开可一键切换已登录过的账号（多服务器 / 同服务器多用户）
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSession, listAccounts, sameAccount, saveSession } from '../emby/session';

export default function ServerChip({ variant }: { variant?: 'sidebar' }) {
  const nav = useNavigate();
  const s = getSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hostOf = (srv: string): string => {
    try {
      return new URL(srv).host;
    } catch {
      return srv;
    }
  };

  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', off);
    return () => window.removeEventListener('mousedown', off);
  }, [open]);

  const accs = open ? listAccounts() : [];
  return (
    <div ref={ref} className={`srcpick we-chip${variant === 'sidebar' ? ' srcpick-sidebar' : ''}`} style={{ position: 'relative' }}>
      <div
        className="srcpick-name"
        role="button"
        tabIndex={0}
        title={s ? `${s.userName} @ ${hostOf(s.server)}（点击切换账号）` : '未登录'}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setOpen((v) => !v);
        }}
      >
        {s ? `${s.userName} · ${s.serverName || hostOf(s.server)} ▾` : '未登录'}
      </div>
      {open && (
        <div className="we-ctx" style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, zIndex: 50 }} role="menu">
          {accs.map((a) => {
            const on = !!s && sameAccount(a, s);
            return (
              <div key={a.server + a.userId} className="we-ctx-item" onClick={() => { setOpen(false); if (!on) saveSession(a); }}>
                {on ? '✓ ' : ''}{a.userName}<span style={{ opacity: 0.6, marginLeft: 8, fontSize: 12 }}>{a.serverName || hostOf(a.server)}</span>
              </div>
            );
          })}
          <div className="we-ctx-item" onClick={() => { setOpen(false); nav('/config'); }}>＋ 添加 / 管理账号…</div>
        </div>
      )}
    </div>
  );
}
