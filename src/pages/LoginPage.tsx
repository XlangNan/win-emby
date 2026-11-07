// 登录页：服务器地址 + 用户名 + 密码（只保存 token，不保存密码）
import { useState } from 'react';
import AppAmbient from '../components/AppAmbient';
import TitleBar from '../components/TitleBar';
import { emby } from '../emby/client';
import { fn } from '../emby/fnos';
import { saveSession } from '../emby/session';

const LAST = 'wemby-last-login';

function lastLogin(): { server: string; user: string; kind?: string } {
  try {
    return { server: '', user: '', ...(JSON.parse(localStorage.getItem(LAST) || '{}') as object) };
  } catch {
    return { server: '', user: '' };
  }
}

export default function LoginPage() {
  const last = lastLogin();
  const [kind, setKind] = useState<'emby' | 'fnos'>(last.kind === 'fnos' ? 'fnos' : 'emby');
  const [server, setServer] = useState(last.server);
  const [user, setUser] = useState(last.user);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const api = kind === 'fnos' ? fn : emby;
      if (!server.trim()) throw new Error(`请填写服务器地址，例如 ${kind === 'fnos' ? '192.168.1.10:8056' : '192.168.1.10:8096'}`);
      if (!user.trim()) throw new Error('请填写用户名');
      try {
        await api.ping(server);
      } catch {
        throw new Error('连接不上服务器：检查地址 / 端口，设备和服务器是否在同一局域网');
      }
      const s = await api.login(server, user.trim(), pw);
      try {
        localStorage.setItem(LAST, JSON.stringify({ server: s.server, user: user.trim(), kind }));
      } catch {
        /* ignore */
      }
      saveSession(s);
    } catch (ex) {
      const m = ex instanceof Error ? ex.message : String(ex);
      setErr(/401|403/.test(m) ? '用户名或密码不对' : m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app we-login-app">
      <AppAmbient />
      <main className="main">
        <TitleBar />
        <div className="we-login-wrap">
          <form className="card we-login" onSubmit={(e) => void submit(e)}>
            <h2 style={{ margin: '0 0 4px' }}>连接服务器</h2>
            <div className="muted" style={{ marginBottom: 10, fontSize: 12 }}>选择服务器类型，填写局域网里的地址和账号</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {([['emby', 'Emby'], ['fnos', '飞牛影视']] as const).map(([k, n]) => (
                <button key={k} type="button" className={kind === k ? 'primary' : ''} style={{ flex: 1 }} onClick={() => { setKind(k); setErr(''); }}>{n}</button>
              ))}
            </div>
            <label className="we-field">
              <span>服务器地址</span>
              <input value={server} onChange={(e) => setServer(e.target.value)} placeholder={kind === 'fnos' ? '192.168.1.10:8056' : '192.168.1.10:8096'} autoFocus spellCheck={false} />
            </label>
            <label className="we-field">
              <span>用户名</span>
              <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" spellCheck={false} />
            </label>
            <label className="we-field">
              <span>密码</span>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" placeholder="没有密码可留空" />
            </label>
            {err && <div className="err" style={{ margin: '4px 0 10px' }}>{err}</div>}
            <button type="submit" className="primary" disabled={busy} style={{ width: '100%', marginTop: 6 }}>
              {busy ? '连接中…' : '登录'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
