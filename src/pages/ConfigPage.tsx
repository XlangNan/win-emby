// 设置：账号 / 皮肤 / 播放偏好
import { useEffect, useRef, useState } from 'react';
import { emby } from '../emby/client';
import { getSession, listAccounts, removeAccount, sameAccount, saveSession } from '../emby/session';
import type { EmbyItem, Session } from '../emby/types';
import { isAndroid } from '../lib/platform';
import { applyFont, FONT_PRESETS, loadFont } from '../lib/font';
import { applyMode, loadMode, MODE_LABELS, type ModePref } from '../lib/mode';
import { introDbOn, loadIntroProxy, saveIntroProxy, setIntroDbOn } from '../lib/introdb';
import { loadDanmaku, saveDanmaku, testDanmaku } from '../lib/danmaku';
import { loadPlayPrefs, savePlayPrefs } from '../lib/prefs';
import { kg, loadKg, saveKg } from '../lib/kg';
import { loadNd, nd, saveNd } from '../music/navidrome';
import { saveOpts, useOpts } from '../music/prefs';
import { searchOnline } from '../music/online';
import { loadMp, mp, saveMp } from '../lib/mp';
import { BUILD_ID } from '../lib/version';
import { HOSTS_TEMPLATE, loadHostsText, saveHostsText } from '../lib/net';
import { loadTmdb, saveTmdb, tmdbSearch } from '../lib/tmdb';

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

function HeroSettings({ prefs, set }: { prefs: ReturnType<typeof loadPlayPrefs>; set: (p: Partial<ReturnType<typeof loadPlayPrefs>>) => void }) {
  const [views, setViews] = useState<EmbyItem[]>([]);
  useEffect(() => { emby.views().then(setViews).catch(() => undefined); }, []);
  const all = prefs.heroLibs.length === 0;
  const toggle = (id: string): void => {
    const cur = new Set(prefs.heroLibs);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    set({ heroLibs: [...cur] });
  };
  const chip = (on: boolean, label: string, fn: () => void): React.ReactNode => (
    <button key={label} type="button" className={`tag ${on ? 'active' : ''}`} aria-pressed={on} onClick={fn}>{label}</button>
  );
  return (
    <div className="card we-set" style={{ marginBottom: 14 }}>
      <h3>首页轮播</h3>
      <div className="we-set-row">
        <span>显示轮播</span>
        <input type="checkbox" checked={prefs.heroOn} onChange={(e) => set({ heroOn: e.target.checked })} />
      </div>
      <div className="muted" style={{ fontSize: 12, margin: '8px 0 6px' }}>来源媒体库（可多选）</div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {chip(all, '全部', () => set({ heroLibs: [] }))}
        {views.map((v) => chip(prefs.heroLibs.includes(v.Id), v.Name, () => toggle(v.Id)))}
      </div>
      <div className="muted" style={{ fontSize: 12, margin: '12px 0 6px' }}>内容</div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {chip(prefs.heroMode === 'latest', '最近添加', () => set({ heroMode: 'latest' }))}
        {chip(prefs.heroMode === 'random', '随机推荐', () => set({ heroMode: 'random' }))}
        {chip(prefs.heroMode === 'resume', '继续观看', () => set({ heroMode: 'resume' }))}
      </div>
      <div className="muted" style={{ fontSize: 12, margin: '12px 0 6px' }}>数量</div>
      <div className="row" style={{ gap: 8 }}>
        {[6, 10, 12].map((n) => chip(prefs.heroCount === n, String(n), () => set({ heroCount: n })))}
      </div>
    </div>
  );
}

/** TMDB 设置：片库数据直接来自 TMDB，国内访问需要代理 */
function TmdbSettings() {
  const [c, setC] = useState(loadTmdb);
  const [adv, setAdv] = useState(false);
  const [hosts, setHosts] = useState(loadHostsText);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const test = async (): Promise<void> => {
    saveTmdb(c);
    saveHostsText(hosts);
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
        <input value={c.proxy} onChange={(e) => setC({ ...c, proxy: e.target.value })} placeholder="代理，如 http://127.0.0.1:7890 或 socks5://127.0.0.1:7891；留空 = 直连" spellCheck={false} />
        {isAndroid && (
          <>
            <div className="muted" style={{ fontSize: 12 }}>
              手机上没有代理时，可以在这里写 hosts（域名 → IP，IPv4 / IPv6 都行）。填了代理就以代理为准，hosts 不再生效。
            </div>
            <textarea
              value={hosts}
              onChange={(e) => setHosts(e.target.value)}
              rows={6}
              spellCheck={false}
              autoCapitalize="off"
              placeholder={HOSTS_TEMPLATE}
              style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12.5, padding: 8, borderRadius: 8, background: 'var(--surface-3)', color: 'inherit', border: '1px solid var(--border-soft)', resize: 'vertical' }}
            />
            <div><button type="button" onClick={() => setHosts((t) => (t.trim() ? t : HOSTS_TEMPLATE))}>插入示例</button></div>
          </>
        )}
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

function DanmakuSettings() {
  const [c, setC] = useState(loadDanmaku);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const test = async (): Promise<void> => {
    saveDanmaku(c);
    setBusy(true);
    setMsg('');
    try { setMsg(`${await testDanmaku(c)}，已保存`); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="card we-set" style={{ marginBottom: 14 }}>
      <h3>弹幕</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>播放时按片名自动匹配并加载 B 站、腾讯、爱奇艺、优酷等平台的弹幕。填弹幕聚合服务的地址（兼容弹弹play 接口，如自建的 danmu_api）；如果服务地址里带 token，一起填进去，如 http://192.168.1.10:9321/你的token。</div>
      <div style={{ display: 'grid', gap: 8 }}>
        <input value={c.url} onChange={(e) => setC({ ...c, url: e.target.value })} placeholder="服务地址，如 192.168.1.10:9321" spellCheck={false} />
        <input value={c.appId} onChange={(e) => setC({ ...c, appId: e.target.value })} placeholder="AppId（用弹弹play 官方才需要，自建可留空）" spellCheck={false} />
        <input type="password" value={c.appSecret} onChange={(e) => setC({ ...c, appSecret: e.target.value })} placeholder="AppSecret（同上）" />
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <button className="primary" disabled={busy || !c.url.trim()} onClick={() => void test()}>{busy ? '连接中…' : '保存并测试连接'}</button>
          {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

function MpSettings() {
  const [c, setC] = useState(loadMp);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const test = async (): Promise<void> => {
    saveMp(c);
    setBusy(true);
    setMsg('');
    try {
      const subs = await mp<unknown[]>('/subscribe/');
      setMsg(`连接成功，MoviePilot 里现有 ${Array.isArray(subs) ? subs.length : 0} 个订阅，已保存`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card we-set" style={{ marginBottom: 14 }}>
      <h3>MoviePilot（下载到本地）</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>片库里订阅时可选「MoviePilot」，由它搜索资源并下载到本地。填用户名密码即可；只想用 API 令牌的话，用户名留空、填下面的令牌。与追更服务可同时配置，订阅时二选一。</div>
      <div style={{ display: 'grid', gap: 8 }}>
        <input value={c.url} onChange={(e) => setC({ ...c, url: e.target.value })} placeholder="地址，如 192.168.1.10:3000（不用加 /api/v1）" spellCheck={false} />
        <input value={c.username} onChange={(e) => setC({ ...c, username: e.target.value })} placeholder="用户名（如 admin）" spellCheck={false} />
        <input type="password" value={c.password} onChange={(e) => setC({ ...c, password: e.target.value })} placeholder="密码" />
        <input type="password" value={c.apiToken} onChange={(e) => setC({ ...c, apiToken: e.target.value })} placeholder="API 令牌（可选，用户名留空时才用）" spellCheck={false} />
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <button className="primary" disabled={busy || !c.url.trim()} onClick={() => void test()}>{busy ? '连接中…' : '保存并测试连接'}</button>
          {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

function ModeSettings() {
  const [m, setM] = useState<ModePref>(loadMode);
  const pick = (v: ModePref): void => { setM(v); applyMode(v); };
  return (
    <div className="card we-set" style={{ marginBottom: 14 }}>
      <h3>外观</h3>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {MODE_LABELS.map(([v, n]) => <button key={v} className={`tag ${m === v ? 'active' : ''}`} aria-pressed={m === v} onClick={() => pick(v)}>{n}</button>)}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>浅色只改界面底色和文字；视频播放器、影片详情页和音乐的全屏播放页保持深色。</div>
    </div>
  );
}

function FontSettings() {
  const [f, setF] = useState(loadFont());
  const upd = (n: Partial<typeof f>): void => {
    const next = { ...f, ...n };
    setF(next);
    applyFont(next);
  };
  const cur = FONT_PRESETS.find((x) => x.id === f.id);
  return (
    <div className="card we-set" style={{ marginBottom: 14 }}>
      <h3>界面字体</h3>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {FONT_PRESETS.map((p) => (
          <button key={p.id} className={`tag ${!f.custom && f.id === p.id ? 'active' : ''}`} aria-pressed={!f.custom && f.id === p.id}
            style={p.stack ? { fontFamily: p.stack } : undefined} onClick={() => upd({ id: p.id, custom: '' })}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="we-set-row" style={{ marginTop: 10 }}>
        <span>自定义字体名<span className="muted" style={{ display: 'block', fontSize: 12 }}>填已安装在系统里的字体名称（如「霞鹜文楷」「LXGW WenKai」），留空则用上面的选择</span></span>
        <input value={f.custom} placeholder={cur?.label || ''} onChange={(e) => upd({ custom: e.target.value })} style={{ width: 200 }} />
      </div>
    </div>
  );
}

/** Navidrome（音乐）设置 */
function NavidromeSettings() {
  const [c, setC] = useState(loadNd);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const test = async (): Promise<void> => {
    setBusy(true);
    setMsg('');
    try {
      const r = await nd.ping(c);
      saveNd(c);
      setMsg(`连接成功：${r.server}${r.version ? ` ${r.version}` : ''}，已保存`);
    } catch (e) {
      setMsg(`连接失败：${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };
  return (
    <div className="card we-set" style={{ marginBottom: 14 }}>
      <h3>音乐（Navidrome）</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>填写 Navidrome 的地址（不写端口默认 4533，用域名 / https 请写完整）、用户名和密码，连接成功后底部会出现「音乐」。</div>
      <div style={{ display: 'grid', gap: 8 }}>
        <input value={c.server} onChange={(e) => setC({ ...c, server: e.target.value })} placeholder="如 192.168.1.10:4533 或 https://music.example.com" spellCheck={false} autoCapitalize="off" />
        <input value={c.user} onChange={(e) => setC({ ...c, user: e.target.value })} placeholder="用户名" autoComplete="username" spellCheck={false} autoCapitalize="off" />
        <input type="password" value={c.pass} onChange={(e) => setC({ ...c, pass: e.target.value })} placeholder="密码" autoComplete="current-password" />
        <input value={c.proxy} onChange={(e) => setC({ ...c, proxy: e.target.value })} placeholder="代理（可选，一般局域网不用填）" spellCheck={false} />
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="primary" disabled={busy || !c.server.trim() || !c.user.trim()} onClick={() => void test()}>{busy ? '连接中…' : '测试并保存'}</button>
          {msg && <span className={msg.startsWith('连接成功') ? 'muted' : 'err'} style={{ fontSize: 12.5 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

function MusicOptionsSettings() {
  const o = useOpts();
  const [a, setA] = useState(String(o.randomN));
  const [b, setB] = useState(String(o.radioN));
  const [n, setN] = useState(o.neteaseApi);
  const [mt, setMt] = useState(o.metingApi);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const saveAll = (): void => {
    const r = saveOpts({ randomN: Number(a), radioN: Number(b), neteaseApi: n, metingApi: mt });
    setA(String(r.randomN)); setB(String(r.radioN)); setN(r.neteaseApi); setMt(r.metingApi);
  };
  const test = async (): Promise<void> => {
    saveAll();
    setBusy(true); setMsg('');
    try {
      const r = await searchOnline('周杰伦');
      setMsg(r.length ? `在线来源可用（搜到 ${r.length} 条）` : '接口通了，但没有搜到结果');
    } catch (e) { setMsg(`失败：${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  };
  return (
    <div className="card we-set" style={{ marginBottom: 14 }}>
      <h3>音乐选项</h3>
      <div style={{ display: 'grid', gap: 10 }}>
        <label className="row" style={{ gap: 10, alignItems: 'center' }}>随机推荐歌曲数
          <input type="number" min={5} max={300} value={a} onChange={(e) => setA(e.target.value)} onBlur={saveAll} style={{ width: 90 }} />
        </label>
        <label className="row" style={{ gap: 10, alignItems: 'center' }}>随心听歌曲数
          <input type="number" min={10} max={300} value={b} onChange={(e) => setB(e.target.value)} onBlur={saveAll} style={{ width: 90 }} />
        </label>
        <label className="row" style={{ gap: 10, alignItems: 'center' }}>
          <input type="checkbox" checked={o.barLyric} onChange={(e) => saveOpts({ barLyric: e.target.checked })} />在底部播放条显示当前歌词
        </label>
        <label className="row" style={{ gap: 10, alignItems: 'center' }}>
          <input type="checkbox" checked={o.autoLyric} onChange={(e) => saveOpts({ autoLyric: e.target.checked })} />服务器没有歌词时，自动从下面的在线来源匹配
        </label>
        <div className="muted" style={{ fontSize: 12 }}>在线歌词 / 封面来源（用于歌曲「···」菜单里的「匹配 / 编辑 歌词与封面」，二选一，都填时优先 netease-api；只改本机显示，不会改动 Navidrome）。</div>
        <input value={n} onChange={(e) => setN(e.target.value)} onBlur={saveAll} placeholder="NeteaseCloudMusicApi 地址，如 http://192.168.1.10:3000" spellCheck={false} autoCapitalize="off" />
        <input value={mt} onChange={(e) => setMt(e.target.value)} onBlur={saveAll} placeholder="Meting API 地址，如 https://api.example.com/meting/" spellCheck={false} autoCapitalize="off" />
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="primary" disabled={busy || (!n.trim() && !mt.trim())} onClick={() => void test()}>{busy ? '测试中…' : '保存并测试'}</button>
          {msg && <span className={msg.startsWith('失败') ? 'err' : 'muted'} style={{ fontSize: 12.5 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

export default function ConfigPage() {
  const [prefs, setPrefs] = useState(loadPlayPrefs);
  const [introOn, setIntroOn] = useState(introDbOn);
  const set = (p: Partial<typeof prefs>): void => setPrefs(savePlayPrefs(p));

  // 每个设置卡片按标题折叠：默认只展开「账号与服务器」，展开状态记在本机
  const root = useRef<HTMLDivElement>(null);
  const FOLD_KEY = 'wemby-cfg-open';
  const readOpen = (): string[] => { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '["账号与服务器"]') as string[]; } catch { return ['账号与服务器']; } };
  const titleOf = (c: Element): string => c.querySelector('h3')?.textContent?.trim() || '';
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    // 有的卡片是稍后才渲染出来的（等数据 / 重新挂载），所以要盯着新出现的卡片，每张只初始化一次
    const apply = (): void => {
      const open = new Set(readOpen());
      el.querySelectorAll<HTMLElement>(':scope > .we-set').forEach((c) => {
        if (c.dataset.foldInit) return;
        c.dataset.foldInit = '1';
        // 标记「标题所在的那一块」，折叠时只留它（不依赖 :has，旧 WebView 也能用）
        for (let n = 0; n < c.children.length; n++) { const k = c.children[n]; if (k.tagName === 'H3' || k.querySelector('h3')) k.setAttribute('data-fold-head', ''); }
        if (!open.has(titleOf(c))) c.classList.add('fold');
      });
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(el, { childList: true });
    return () => mo.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onFold = (e: React.MouseEvent): void => {
    const h = (e.target as HTMLElement).closest('h3');
    const c = h?.closest('.we-set');
    if (!h || !c || c.parentElement !== root.current) return;
    c.classList.toggle('fold');
    const t = titleOf(c);
    const open = new Set(readOpen());
    if (c.classList.contains('fold')) open.delete(t); else open.add(t);
    try { localStorage.setItem(FOLD_KEY, JSON.stringify([...open])); } catch { /* ignore */ }
  };

  return (
    <>
      <div className="topbar"><h3 style={{ margin: 0 }}>设置</h3></div>
      <div className="content cfg-fold" ref={root} onClick={onFold}>
        <Accounts />
        <HeroSettings prefs={prefs} set={set} />
        <HomeLibs prefs={prefs} set={set} />
        <NavidromeSettings />
        <MusicOptionsSettings />
        <TmdbSettings />
        <KgSettings />
        <MpSettings />
        <DanmakuSettings />

        <ModeSettings />
        <FontSettings />

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
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>优先用 Emby 里的「片头」章节标记；没有时可用下面的 TheIntroDB</span>
            </span>
            <input type="checkbox" checked={prefs.autoSkipIntro} onChange={(e) => set({ autoSkipIntro: e.target.checked })} />
          </label>
          <label className="we-set-row" style={{ cursor: 'pointer' }}>
            <span>
              用 TheIntroDB 查片头时间
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>按 TMDB 编号查在线片头库；可在剧集详情页手动扫描、查看有没有数据</span>
            </span>
            <input type="checkbox" checked={introOn} onChange={(e) => { setIntroOn(e.target.checked); setIntroDbOn(e.target.checked); }} />
          </label>
          <div className="we-set-row" style={{ display: 'block' }}>
            <span>
              TheIntroDB 代理
              <span className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>留空 = 沿用上面 TMDB 的代理；安卓可在 TMDB 设置里写 hosts，对它同样生效</span>
            </span>
            <input defaultValue={loadIntroProxy()} onChange={(e) => saveIntroProxy(e.target.value)} placeholder="如 http://127.0.0.1:7890 或 socks5://127.0.0.1:7891" spellCheck={false} style={{ width: '100%', boxSizing: 'border-box' }} />
          </div>
          <label className="we-set-row">
            <span>
              没有片尾标记时，播到 {prefs.creditsPct}% 显示「下一集」
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>和 Emby 一样按整片比例；有片尾标记时以标记为准</span>
            </span>
            <input type="range" min={85} max={99} value={prefs.creditsPct} onChange={(e) => set({ creditsPct: Number(e.target.value) })} />
          </label>
          <label className="we-set-row" style={{ cursor: 'pointer' }}>
            <span>播完自动播放下一集</span>
            <input type="checkbox" checked={prefs.autoNext} onChange={(e) => set({ autoNext: e.target.checked })} />
          </label>
        </div>
        <div className="muted" style={{ textAlign: 'center', fontSize: 12, padding: '14px 0 6px' }}>织影 · 版本编号 {BUILD_ID}</div>
      </div>
    </>
  );
}
