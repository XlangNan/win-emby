// 随便看看：连接群晖 → 首页（播放列表 / 继续播放 / 全部视频）。点视频进入播放页（/local/play）。
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Cover from './Cover';
import { isMobileApp } from '../lib/platform';
import {
  clearCovers, clearDsm, coverStat, dsmBrowse, dsmConfigured, fmtClock, fmtSize, loadDsm, loadLibrary, readMyLists, readPos, saveDsm, writeMyLists, setPlayQueue, useDsmKey,
  type DsmConfig, type DsmEntry, type LocalLibrary, type LocalVideo, type MyList,
} from './dsm';

// ───────── 连接 + 选文件夹 ─────────
function Connect({ onDone, pick }: { onDone?: () => void; pick?: boolean }) {
  const old = loadDsm();
  const [server, setServer] = useState(old.server || '');
  const [user, setUser] = useState(old.user || '');
  const [pass, setPass] = useState(old.pass || '');
  const [step, setStep] = useState<1 | 2>(1);
  const [path, setPath] = useState('');
  const [rows, setRows] = useState<DsmEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const cfg = (): DsmConfig => ({ server, user, pass, folder: '' });

  const open = async (p: string): Promise<void> => {
    setErr('');
    setBusy(true);
    try {
      const list = await dsmBrowse(cfg(), p);
      setRows(list.filter((e) => e.isdir));
      setPath(p);
      setStep(2);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const connect = (): void => {
    if (!server.trim() || !user.trim() || !pass) { setErr('地址、账号、密码都要填'); return; }
    void open('');
  };
  const up = (): void => {
    const i = path.lastIndexOf('/');
    void open(i <= 0 ? '' : path.slice(0, i));
  };
  useEffect(() => { if (pick) void open(old.folder || ''); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choose = (): void => {
    saveDsm({ ...cfg(), folder: path });
    onDone?.();
  };

  return (
    <div className="content lc-page">
      <div className="lc-conn">
        <h1>随便看看</h1>
        <p className="lc-sub">直接播放群晖里的本地视频，不经过 Emby。群晖里每个子文件夹会变成一个播放列表。</p>
        {step === 1 ? (
          <>
            <label>群晖地址<input value={server} onChange={(e) => setServer(e.target.value)} placeholder="例如 192.168.1.10:5000 或 https://nas.example.com:5001" autoCapitalize="off" autoCorrect="off" /></label>
            <label>账号<input value={user} onChange={(e) => setUser(e.target.value)} placeholder="建议建一个只读的专用账号" autoCapitalize="off" autoCorrect="off" /></label>
            <label>密码<input type="password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
            {err && <div className="lc-err">{err}</div>}
            <div className="lc-acts">
              <button className="lc-pri" disabled={busy} onClick={connect}>{busy ? '连接中…' : '连接'}</button>
              {onDone && <button onClick={onDone}>取消</button>}
            </div>
            <p className="lc-tip">账号不能开两步验证；需要有 File Station 的访问权限。外面用的话，地址要能从外网直接访问（DDNS 或端口转发），QuickConnect 不行。</p>
          </>
        ) : (
          <>
            <div className="lc-path">{path || '选一个文件夹，里面的视频会出现在随便看看里'}</div>
            <div className="lc-rows">
              {path && <button className="lc-row" onClick={up}>‹ 上一级</button>}
              {rows.map((r) => <button key={r.path} className="lc-row" onClick={() => void open(r.path)}>📁 {r.name}</button>)}
              {!rows.length && <div className="lc-empty">这里没有子文件夹了</div>}
            </div>
            {err && <div className="lc-err">{err}</div>}
            <div className="lc-acts">
              <button className="lc-pri" disabled={!path || busy} onClick={choose}>{path ? '就用这个文件夹' : '先点进一个文件夹'}</button>
              <button onClick={() => setStep(1)}>返回</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ───────── 自建播放列表：挑视频 ─────────
function Picker({ all, init, onSave, onClose, onDelete }: { all: LocalVideo[]; init: MyList | null; onSave: (name: string, paths: string[]) => void; onClose: () => void; onDelete?: () => void }) {
  const [name, setName] = useState(init?.name || '');
  const [paths, setPaths] = useState<string[]>(init ? init.paths.filter((p) => all.some((v) => v.path === p)) : []);
  const [q, setQ] = useState('');
  const k = q.trim().toLowerCase();
  const rows = k ? all.filter((v) => v.title.toLowerCase().includes(k) || v.list.toLowerCase().includes(k)) : all;
  const toggle = (p: string): void => setPaths((a) => (a.includes(p) ? a.filter((x) => x !== p) : [...a, p]));
  const ok = name.trim().length > 0 && paths.length > 0;
  return createPortal(
    <div className="lc-pk-bg" onClick={onClose}>
      <div className="lc-pk" onClick={(e) => e.stopPropagation()}>
        <div className="lc-pk-h">
          <input className="lc-pk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="给列表起个名字" maxLength={30} />
          <button onClick={onClose}>取消</button>
        </div>
        <input className="lc-pk-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索视频或文件夹" />
        <div className="lc-pk-bar">
          <span>已选 {paths.length} 个，按点选的先后顺序播放</span>
          {rows.length > 0 && <button onClick={() => setPaths((a) => Array.from(new Set([...a, ...rows.map((v) => v.path)])))}>全选当前{k ? '结果' : ''}</button>}
          {paths.length > 0 && <button onClick={() => setPaths([])}>清空</button>}
        </div>
        <div className="lc-pk-list">
          {rows.map((v) => {
            const n = paths.indexOf(v.path);
            return (
              <div key={v.path} className={`lc-pk-r${n >= 0 ? ' on' : ''}`} role="button" tabIndex={0} onClick={() => toggle(v.path)} onKeyDown={(e) => e.key === 'Enter' && toggle(v.path)}>
                <i className="lc-pk-ck">{n >= 0 ? n + 1 : ''}</i>
                <Cover className="lc-pk-th" path={v.path} title={v.title} plain />
                <div className="lc-pk-x"><b>{v.title}</b><span>{[v.list !== '未分组' ? v.list : '', fmtSize(v.size)].filter(Boolean).join('　·　')}</span></div>
              </div>
            );
          })}
          {rows.length === 0 && <div className="lc-empty">没有匹配的视频</div>}
        </div>
        <div className="lc-pk-f">
          {onDelete && <button className="lc-danger" onClick={onDelete}>删除列表</button>}
          <button className="lc-pri" disabled={!ok} onClick={() => onSave(name.trim(), paths)}>{ok ? `保存（${paths.length} 个）` : name.trim() ? '先选几个视频' : '先起个名字'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ───────── 首页 ─────────
export default function LocalPage() {
  const key = useDsmKey();
  const nav = useNavigate();
  const [setting, setSetting] = useState<false | 'conn' | 'pick'>(false);
  const [lib, setLib] = useState<LocalLibrary | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState('');
  const [q, setQ] = useState('');
  const [chipsOpen, setChipsOpen] = useState(false);
  const [mine, setMine] = useState<MyList[]>(readMyLists);
  const [pk, setPk] = useState<null | 'new' | string>(null);
  useEffect(() => {
    const f = (): void => setMine(readMyLists());
    window.addEventListener('wemby-mylists', f);
    return () => window.removeEventListener('wemby-mylists', f);
  }, []);
  const myItems = (m: MyList): LocalVideo[] => {
    const by = new Map((lib?.all ?? []).map((v) => [v.path, v] as const));
    return m.paths.map((p) => by.get(p)).filter((v): v is LocalVideo => !!v);
  };
  const curMine = sel.startsWith('my:') ? mine.find((m) => m.id === sel.slice(3)) : undefined;
  const configured = dsmConfigured();
  const [, bump] = useState(0);
  useEffect(() => {
    const f = (): void => bump((n) => n + 1);
    window.addEventListener('wemby-cover-stat', f);
    return () => window.removeEventListener('wemby-cover-stat', f);
  }, []);

  const load = (force: boolean): void => {
    if (force) clearCovers();
    setBusy(true);
    setErr('');
    loadLibrary(force).then((l) => setLib(l)).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
  };
  useEffect(() => {
    if (configured && !setting) load(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setting]);

  const pos = useMemo(readPos, [lib]);
  const shown: LocalVideo[] = useMemo(() => {
    if (!lib) return [];
    const base = curMine ? myItems(curMine) : sel ? lib.lists.find((l) => l.name === sel)?.items ?? [] : lib.all;
    const k = q.trim().toLowerCase();
    return k ? base.filter((v) => v.title.toLowerCase().includes(k)) : base;
  }, [lib, sel, q, curMine, mine]);
  const resume = useMemo(() => {
    if (!lib || sel || q.trim()) return [];
    return lib.all.filter((v) => pos[v.path] && pos[v.path].t > 30).sort((a, b) => pos[b.path].at - pos[a.path].at).slice(0, 8);
  }, [lib, pos, sel, q]);

  const play = (items: LocalVideo[], i: number, title: string): void => {
    setPlayQueue(items, i, title);
    nav('/local/play');
  };
  const saveMine = (name: string, paths: string[]): void => {
    const cur = pk && pk !== 'new' ? mine.find((m) => m.id === pk) : undefined;
    if (cur) writeMyLists(mine.map((m) => (m.id === cur.id ? { ...m, name, paths } : m)));
    else {
      const id = Date.now().toString(36);
      writeMyLists([...mine, { id, name, paths }]);
      setSel(`my:${id}`);
    }
    setPk(null);
  };
  const delMine = (): void => {
    if (!pk || pk === 'new' || !confirm('删除这个播放列表？里面的视频不会被删。')) return;
    writeMyLists(mine.filter((m) => m.id !== pk));
    if (sel === `my:${pk}`) setSel('');
    setPk(null);
  };
  const shuffle = (items: LocalVideo[]): LocalVideo[] => {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  if (!configured || setting) return <Connect key={String(setting)} pick={setting === 'pick'} onDone={configured ? () => setSetting(false) : undefined} />;

  const Card = ({ v, i, items, title }: { v: LocalVideo; i: number; items: LocalVideo[]; title: string }) => {
    const p = pos[v.path];
    return (
      <div className="lc-card" role="button" tabIndex={0} onClick={() => play(items, i, title)} onKeyDown={(e) => e.key === 'Enter' && play(items, i, title)}>
        <Cover className="lc-th" path={v.path} title={v.title}>
          {p && p.d > 0 && <i className="lc-prog"><b style={{ width: `${Math.min(100, (p.t / p.d) * 100)}%` }} /></i>}
          {p && p.d > 0 && <span className="lc-dur">{fmtClock(p.d)}</span>}
        </Cover>
        <div className="lc-t">{v.title}</div>
        <div className="lc-m">{[v.list !== '未分组' ? v.list : '', fmtSize(v.size), p && p.t > 30 ? `看到 ${fmtClock(p.t)}` : ''].filter(Boolean).join('　·　')}</div>
      </div>
    );
  };

  return (
    <div className="content lc-page lc-home">
      <div className="lc-head">
        <h1>随便看看</h1>
        <input className="lc-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索视频" />
        <button onClick={() => load(true)} disabled={busy}>{busy ? '读取中…' : '刷新'}</button>
        {isMobileApp && <button className="lc-pri" onClick={() => nav('/local/feed')}>▶ 刷刷看</button>}
        <button onClick={() => setSetting('pick')}>换文件夹</button>
        <button onClick={() => setSetting('conn')}>设置</button>
      </div>
      {err && (
        <div className="lc-err">
          {err}
          <div className="lc-acts"><button className="lc-pri" onClick={() => load(true)}>重试</button><button onClick={() => { if (confirm('断开群晖？')) clearDsm(); }}>断开</button></div>
        </div>
      )}
      {coverStat.ok === 0 && coverStat.fail > 2 && <div className="lc-sub">封面取不到：{coverStat.why}</div>}
      {!lib && !err && <div className="lc-empty">正在读取群晖里的视频…</div>}
      {lib && lib.all.length === 0 && <div className="lc-empty">这个文件夹里没有视频。可以到「设置」里换一个文件夹。</div>}
      {lib && lib.all.length > 0 && (
        <>
          <div className={`lc-chipbar${chipsOpen ? ' open' : ''}`}>
            <div className="lc-chips">
              <button className={!sel ? 'on' : ''} onClick={() => setSel('')}>全部 {lib.all.length}</button>
              {mine.map((m) => <button key={m.id} className={sel === `my:${m.id}` ? 'on' : ''} onClick={() => setSel(`my:${m.id}`)}>★ {m.name}</button>)}
              {lib.lists.map((l) => <button key={l.name} className={sel === l.name ? 'on' : ''} onClick={() => setSel(l.name)}>{l.name}</button>)}
            </div>
            {(lib.lists.length + mine.length) > 1 && <button className="lc-more" onClick={() => setChipsOpen(!chipsOpen)}>{chipsOpen ? '收起' : '展开'}</button>}
          </div>

          {!sel && !q.trim() && (
            <>
              <h2 className="lc-sec">我的列表</h2>
              <div className="lc-hrow">
                <div className="lc-pl lc-pl-new" role="button" tabIndex={0} onClick={() => setPk('new')} onKeyDown={(e) => e.key === 'Enter' && setPk('new')}>
                  <div className="lc-th lc-new"><span>＋</span></div>
                  <div className="lc-t">新建播放列表</div>
                  <div className="lc-m">自己挑视频</div>
                </div>
                {mine.map((m) => {
                  const it = myItems(m);
                  return (
                    <div key={m.id} className="lc-pl" role="button" tabIndex={0} onClick={() => setSel(`my:${m.id}`)} onKeyDown={(e) => e.key === 'Enter' && setSel(`my:${m.id}`)}>
                      <Cover className="lc-th" path={it[0]?.path ?? ''} title={m.name}><span className="lc-cnt">≡<br />{it.length}</span></Cover>
                      <div className="lc-t">{m.name}</div>
                      <div className="lc-m">{it.length} 个视频</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {!sel && !q.trim() && lib.lists.length > 1 && (
            <>
              <h2 className="lc-sec">播放列表</h2>
              <div className="lc-hrow">
                {lib.lists.map((l) => (
                  <div key={l.name} className="lc-pl" role="button" tabIndex={0} onClick={() => setSel(l.name)}>
                    <Cover className="lc-th" path={l.items[0]?.path ?? ''} title={l.name}>
                      <span className="lc-cnt">≡<br />{l.items.length}</span>
                    </Cover>
                    <div className="lc-t">{l.name}</div>
                    <div className="lc-m">{l.items.length} 个视频</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {resume.length > 0 && (
            <>
              <h2 className="lc-sec">继续播放</h2>
              <div className="lc-hrow">
                {resume.map((v) => <Card key={v.path} v={v} i={lib.all.indexOf(v)} items={lib.all} title="全部视频" />)}
              </div>
            </>
          )}

          <h2 className="lc-sec">{curMine ? `★ ${curMine.name}` : sel ? sel : q.trim() ? '搜索结果' : '全部视频'}</h2>
          {sel && (shown.length > 0 || curMine) && (
            <div className="lc-acts">
              <button className="lc-pri" disabled={!shown.length} onClick={() => play(shown, 0, curMine ? curMine.name : sel)}>播放全部</button>
              <button disabled={!shown.length} onClick={() => play(shuffle(shown), 0, curMine ? curMine.name : sel)}>随机播放</button>
              {curMine && <button onClick={() => setPk(curMine.id)}>编辑列表</button>}
            </div>
          )}
          {shown.length === 0 ? <div className="lc-empty">{curMine ? '这个列表里的视频都找不到了，点「编辑列表」重新选' : '没有匹配的视频'}</div> : (
            <div className="lc-grid">
              {shown.map((v, i) => <Card key={v.path} v={v} i={i} items={shown} title={curMine ? curMine.name : sel || '全部视频'} />)}
            </div>
          )}
        </>
      )}
      {pk && lib && <Picker key={pk} all={lib.all} init={pk === 'new' ? null : mine.find((m) => m.id === pk) ?? null} onSave={saveMine} onClose={() => setPk(null)} onDelete={pk === 'new' ? undefined : delMine} />}
    </div>
  );
}
