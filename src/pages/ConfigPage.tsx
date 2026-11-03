// 设置：账号 / 皮肤 / 播放偏好
import { useEffect, useState } from 'react';
import { emby } from '../emby/client';
import { getSession, listAccounts, removeAccount, sameAccount, saveSession } from '../emby/session';
import type { EmbyItem, Session } from '../emby/types';
import { applyTheme, useTheme } from '../lib/theme';
import { loadPlayPrefs, savePlayPrefs } from '../lib/prefs';
import { kg, loadKg, saveKg } from '../lib/kg';
import { loadTmdb, saveTmdb, tmdbSearch } from '../lib/tmdb';
import { ALL_THEMES, THEME_LABELS } from '../lib/themeTokens';

const LANGS: [string, string][] = [
  ['', '跟随文件默认'], ['chi', '中文 / 国语'], ['yue', '粤语'], ['eng', '英语'], ['jpn', '日语'], ['kor', '韩语'],
];

/** 账号管理：按服务器分组，每个服务器下可有多个账号 */
function Accounts() {
  const [list, setList] = useState<Session[]>(listAccounts);
  const cur = getSession();
  const [adding, setAdding] = useState(false);
  const [server, setServer] = useState(cur?.server || '');
  const [user, setUser] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = (): void => setList(listAccounts());

  const groups = new Map<string, Session[]>();
  for (const a of list) groups.set(a.server, [...(groups.get(a.server) || []), a]);

  const add = async (): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      if (!server.trim() || !user.trim()) throw new Error('请填写服务器地址和用户名');
      const s = await emby.login(server, user.trim(), pw);
      saveSession(s); // 会同时切换到这个账号
      setAdding(false);
      setUser('');
      setPw('');
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/401|403/.test(m) ? '用户名或密码不对' : `登录失败：${m}`);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <div className="card we-set" style={{ marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>账号与服务器</h3>
        <button onClick={() => setAdding((v) => !v)}>{adding ? '取消' : '＋ 添加服务器 / 账号'}</button>
      </div>
      {adding && (
        <div style={{ margin: '12px 0', display: 'grid', gap: 8 }}>
          <input list="we-servers" value={server} onChange={(e) => setServer(e.target.value)} placeholder="服务器地址，如 192.168.1.10:8096" spellCheck={false} />
          <datalist id="we-servers">{[...groups.keys()].map((k) => <option key={k} value={k} />)}</datalist>
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="用户名" spellCheck={false} />
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="密码（没有可留空）" />
          {err && <div className="err">{err}</div>}
          <div><button className="primary" disabled={busy} onClick={() => void add()}>{busy ? '登录中…' : '登录并切换'}</button></div>
        </div>
      )}
      {[...groups.entries()].map(([srv, accs]) => (
        <div key={srv} style={{ marginTop: 12, border: '1px solid var(--border-soft)', borderRadius: 10, padding: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{accs.find((a) => a.serverName)?.serverName || '服务器'}</b>
            <span className="muted" style={{ fontSize: 12 }}>{srv.replace(/^https?:\/\//, '')}</span>
          </div>
          {accs.map((a) => {
            const on = !!cur && sameAccount(a, cur);
            return (
              <div key={a.userId} className="we-set-row">
                <span>{a.userName}{on && <span className="tag active" style={{ marginLeft: 8 }}>当前</span>}</span>
                <span className="row" style={{ gap: 8 }}>
                  {!on && <button onClick={() => { saveSession(a); refresh(); }}>切换</button>}
                  <button onClick={() => { removeAccount(a); refresh(); }}>{on ? '退出' : '删除'}</button>
                </span>
              </div>
            );
          })}
        </div>
      ))}
      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>只保存登录令牌，不保存密码。</div>
    </div>
  );
}

/** 首页要显示哪些媒体库（勾选 + 排序） */
function HomeLibs({ prefs, set }: { prefs: ReturnType<typeof loadPlayPrefs>; set: (p: Partial<ReturnType<typeof loadPlayPrefs>>) => void }) {
  const [views, setViews] = useState<EmbyItem[]>([]);
  useEffect(() => {
    emby.views().then(setViews).catch(() => undefined);
  }, []);
  const order = prefs.libOrder;
  const sorted = [...views].sort((a, b) => {
    const ia = order.indexOf(a.Id), ib = order.indexOf(b.Id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  const toggle = (id: string): void =>
    set({ hiddenLibs: prefs.hiddenLibs.includes(id) ? prefs.hiddenLibs.filter((x) => x !== id) : [...prefs.hiddenLibs, id] });
  const move = (i: number, d: number): void => {
    const ids = sorted.map((v) => v.Id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    set({ libOrder: ids });
  };
  return (
    <div className="card we-set" style={{ marginBottom: 14 }}>
      <h3>首页显示的媒体库</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>勾选的库会在首页各出一行「最近添加」，可用 ↑ ↓ 排序</div>
      {sorted.map((v, i) => (
        <div key={v.Id} className="we-set-row">
          <label style={{ cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}>
            <input type="checkbox" checked={!prefs.hiddenLibs.includes(v.Id)} onChange={() => toggle(v.Id)} />
            {v.Name}
          </label>
          <span className="row" style={{ gap: 6 }}>
            <button disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button disabled={i === sorted.length - 1} onClick={() => move(i, 1)}>↓</button>
          </span>
        </div>
      ))}
      {!sorted.length && <div className="muted">加载中…</div>}
    </div>
  );
}

/** TMDB 设置：片库数据直接来自 TMDB，国内访问需要代理 */
function TmdbSettings() {
  const [c, setC] = useState(loadTmdb);
  const [adv, setAdv] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const test = async (): Promise<void> => {
    saveTmdb(c);
    setBusy(true);
    setMsg('');
    try {
      const r = await tmdbSearch('肖申克的救赎');
      setMsg(`连接成功（搜到 ${r.items.length} 条），已保存`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card we-set" style={{ marginBottom: 14 }}>
      <h3>TMDB（片库数据）</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        在 themoviedb.org 免费申请：填 v3「API 密钥」或 v4「API 读访问令牌」都行。国内直连通常不通，请在下面填代理（如 Clash 默认 http://127.0.0.1:7890）。
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <input type="password" value={c.apiKey} onChange={(e) => setC({ ...c, apiKey: e.target.value })} placeholder="TMDB API Key / 读访问令牌" spellCheck={false} />
        <input value={c.proxy} onChange={(e) => setC({ ...c, proxy: e.target.value })} placeholder="代理（HTTP），如 http://127.0.0.1:7890；留空 = 直连" spellCheck={false} />
        {adv && (
          <>
            <input value={c.apiBase} onChange={(e) => setC({ ...c, apiBase: e.target.value })} placeholder="API 地址（默认 https://api.themoviedb.org/3）" spellCheck={false} />
            <input value={c.imgBase} onChange={(e) => setC({ ...c, imgBase: e.target.value })} placeholder="图片地址（默认 https://image.tmdb.org）" spellCheck={false} />
          </>
        )}
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="primary" disabled={busy || !c.apiKey.trim()} onClick={() => void test()}>{busy ? '连接中…' : '保存并测试连接'}</button>
          <button onClick={() => setAdv((v) => !v)}>{adv ? '收起高级' : '自定义域名（有反代时用）'}</button>
          {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

/** 追更服务（kuakego-plus）连接设置 */
function KgSettings() {
  const [c, setC] = useState(loadKg);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const test = async (): Promise<void> => {
    saveKg(c);
    setBusy(true);
    setMsg('');
    try {
      const r = await kg<{ version?: string }>('/api/status');
      setMsg(`连接成功${r?.version ? `（kuakego-plus ${r.version}）` : ''}，已保存`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card we-set" style={{ marginBottom: 14 }}>
      <h3>追更服务（kuakego-plus）</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>片库里点「想看 / 订阅」时，由追更服务自动找资源存入网盘（只用来订阅，不影响浏览）。需要追更服务升级到 1.45.0 或更新。</div>
      <div style={{ display: 'grid', gap: 8 }}>
        <input value={c.url} onChange={(e) => setC({ ...c, url: e.target.value })} placeholder="地址，如 192.168.1.10:8088" spellCheck={false} />
        <input value={c.username} onChange={(e) => setC({ ...c, username: e.target.value })} placeholder="用户名（默认 admin）" spellCheck={false} />
        <input type="password" value={c.password} onChange={(e) => setC({ ...c, password: e.target.value })} placeholder="密码（WEBUI_PASSWORD）" />
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <button className="primary" disabled={busy || !c.url.trim()} onClick={() => void test()}>{busy ? '连接中…' : '保存并测试连接'}</button>
          {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

export default function ConfigPage() {
  const theme = useTheme();
  const [prefs, setPrefs] = useState(loadPlayPrefs);
  const set = (p: Partial<typeof prefs>): void => setPrefs(savePlayPrefs(p));

  return (
    <>
      <div className="topbar"><h3 style={{ margin: 0 }}>设置</h3></div>
      <div className="content">
        <Accounts />
        <HomeLibs prefs={prefs} set={set} />
        <TmdbSettings />
        <KgSettings />

        <div className="card we-set" style={{ marginBottom: 14 }}>
          <h3>界面皮肤</h3>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {ALL_THEMES.map((t) => (
              <button key={t} className={`tag ${theme === t ? 'active' : ''}`} aria-pressed={theme === t} onClick={() => applyTheme(t)}>
                {THEME_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="card we-set">
          <h3>播放</h3>
          <div className="we-set-row">
            <span>
              播放内核
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>MPV 直接解码原文件，支持 HDR10 / 杜比视界、MKV、DTS / TrueHD；内置播放器依赖服务器转码</span>
            </span>
            <select value={prefs.engine} onChange={(e) => set({ engine: e.target.value as 'mpv' | 'html5' })}>
              <option value="mpv">MPV（推荐）</option>
              <option value="html5">内置网页播放器</option>
            </select>
          </div>
          <label className="we-set-row" style={{ cursor: 'pointer' }}>
            <span>
              MPV：HDR 直通显示器
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>需要在 Windows「显示设置」里打开「使用 HDR」；关闭则自动映射成 SDR 画面</span>
            </span>
            <input type="checkbox" checked={prefs.hdr} onChange={(e) => set({ hdr: e.target.checked })} />
          </label>
          <div className="we-set-row">
            <span>画质上限（仅内置播放器）</span>
            <select value={prefs.maxMbps} onChange={(e) => set({ maxMbps: Number(e.target.value) })}>
              <option value={0}>原画（不限）</option>
              {[40, 20, 10, 8, 4, 2].map((m) => <option key={m} value={m}>{m} Mbps</option>)}
            </select>
          </div>
          <label className="we-set-row" style={{ cursor: 'pointer' }}>
            <span>
              内置播放器：允许 HEVC (H.265) 直接播放
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>电脑装了 HEVC 解码（硬解 / 微软 HEVC 扩展）再打开；关闭时由服务器转成 H.264</span>
            </span>
            <input type="checkbox" checked={prefs.hevc} onChange={(e) => set({ hevc: e.target.checked })} />
          </label>
          <div className="we-set-row">
            <span>默认音轨语言</span>
            <select value={prefs.audioLang} onChange={(e) => set({ audioLang: e.target.value })}>
              {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="we-set-row">
            <span>默认字幕</span>
            <select value={prefs.subLang} onChange={(e) => set({ subLang: e.target.value })}>
              <option value="">跟随文件默认</option>
              <option value="off">不显示字幕</option>
              {LANGS.slice(1).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <label className="we-set-row" style={{ cursor: 'pointer' }}>
            <span>记住每部片上次选的音轨和字幕</span>
            <input type="checkbox" checked={prefs.rememberTracks} onChange={(e) => set({ rememberTracks: e.target.checked })} />
          </label>
          <label className="we-set-row" style={{ cursor: 'pointer' }}>
            <span>
              自动跳过片头
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>需要 Emby 里有「片头」章节标记（如装了片头检测插件）</span>
            </span>
            <input type="checkbox" checked={prefs.autoSkipIntro} onChange={(e) => set({ autoSkipIntro: e.target.checked })} />
          </label>
          <label className="we-set-row" style={{ cursor: 'pointer' }}>
            <span>播完自动播放下一集</span>
            <input type="checkbox" checked={prefs.autoNext} onChange={(e) => set({ autoNext: e.target.checked })} />
          </label>
        </div>
      </div>
    </>
  );
}
