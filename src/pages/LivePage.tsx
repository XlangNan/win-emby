// 电视直播：分组 + 频道列表 + 直播源管理。点频道进入全窗口播放（/live/play）。
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  cacheSource, listSources, loadChannels, loadFavs, newId, refreshSource, removeCache, saveSources, toggleFav, type LiveSource,
} from '../lib/live';

export default function LivePage() {
  const nav = useNavigate();
  const [sources, setSources] = useState<LiveSource[]>(listSources);
  const [chs, setChs] = useState(loadChannels);
  const [favs, setFavs] = useState(loadFavs);
  const [group, setGroup] = useState('');
  const [q, setQ] = useState('');
  const [mgr, setMgr] = useState(() => listSources().length === 0);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const reloadChs = (): void => setChs(loadChannels());

  const groups = useMemo(() => {
    const g: string[] = [];
    for (const c of chs) if (!g.includes(c.group)) g.push(c.group);
    return g;
  }, [chs]);

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return chs.filter((c) => {
      if (kw) return c.name.toLowerCase().includes(kw);
      if (group === '__fav') return favs.includes(c.name);
      return !group || c.group === group;
    });
  }, [chs, group, q, favs]);

  useEffect(() => {
    if (group && group !== '__fav' && !groups.includes(group)) setGroup('');
  }, [groups, group]);

  const addUrl = async (): Promise<void> => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) {
      setMsg('请填写 http(s):// 开头的订阅链接');
      return;
    }
    setBusy(true);
    setMsg('');
    const s: LiveSource = { id: newId(), name: name.trim() || `直播源 ${sources.length + 1}`, url: u };
    try {
      const n = await refreshSource(s);
      if (!n) throw new Error('没有解析出频道（需要 M3U / M3U8 / txt 格式）');
      const next = [...sources, s];
      saveSources(next);
      setSources(next);
      reloadChs();
      setName('');
      setUrl('');
      setMsg(`已添加，共 ${n} 条线路`);
    } catch (e) {
      removeCache(s.id);
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    const text = await f.text();
    const s: LiveSource = { id: newId(), name: name.trim() || f.name.replace(/\.[^.]+$/, ''), url: '' };
    const n = cacheSource(s.id, text);
    if (!n) {
      removeCache(s.id);
      setMsg('文件里没有解析出频道');
      return;
    }
    const next = [...sources, s];
    saveSources(next);
    setSources(next);
    reloadChs();
    setMsg(`已导入 ${n} 条线路`);
  };

  const refreshAll = async (): Promise<void> => {
    setBusy(true);
    const r: string[] = [];
    for (const s of sources) {
      try {
        r.push(`${s.name}：${await refreshSource(s)} 条`);
      } catch (e) {
        r.push(e instanceof Error ? e.message : String(e));
      }
    }
    reloadChs();
    setMsg(r.join('；'));
    setBusy(false);
  };

  const del = (s: LiveSource): void => {
    removeCache(s.id);
    const next = sources.filter((x) => x.id !== s.id);
    saveSources(next);
    setSources(next);
    reloadChs();
  };

  return (
    <>
      <div className="topbar">
        <h3 style={{ margin: 0 }}>电视直播</h3>
        <input style={{ marginLeft: 16, width: 200 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索频道…" />
        <span style={{ flex: 1 }} />
        <button onClick={() => setMgr((v) => !v)}>{mgr ? '收起直播源' : '直播源管理'}</button>
      </div>
      <div className="content">
        {mgr && (
          <div className="card we-set" style={{ marginBottom: 14 }}>
            <h3>直播源</h3>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '160px 1fr auto auto' }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称（可选）" />
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="M3U / M3U8 订阅链接，http(s)://…" spellCheck={false} />
              <button className="primary" disabled={busy} onClick={() => void addUrl()}>{busy ? '处理中…' : '添加链接'}</button>
              <label className="we-filebtn">
                导入本地文件
                <input type="file" accept=".m3u,.m3u8,.txt" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </div>
            {msg && <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>{msg}</div>}
            {sources.map((s) => (
              <div key={s.id} className="we-set-row">
                <span>{s.name}<span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{s.url ? s.url.slice(0, 60) : '本地文件'}</span></span>
                <button onClick={() => del(s)}>删除</button>
              </div>
            ))}
            {sources.length > 0 && <div style={{ marginTop: 10 }}><button disabled={busy} onClick={() => void refreshAll()}>刷新全部直播源</button></div>}
          </div>
        )}

        {chs.length === 0 ? (
          <div className="empty">还没有频道：点右上角「直播源管理」，添加 M3U 订阅链接或导入文件</div>
        ) : (
          <div className="we-live">
            <div className="we-live-groups">
              <button className={`tag ${group === '' ? 'active' : ''}`} onClick={() => setGroup('')}>全部 {chs.length}</button>
              <button className={`tag ${group === '__fav' ? 'active' : ''}`} onClick={() => setGroup('__fav')}>★ 收藏 {favs.length}</button>
              {groups.map((g) => (
                <button key={g} className={`tag ${group === g ? 'active' : ''}`} onClick={() => setGroup(g)}>{g}</button>
              ))}
            </div>
            <div className="we-live-grid">
              {list.map((c) => (
                <div
                  key={c.name}
                  className="we-live-ch"
                  role="button"
                  tabIndex={0}
                  onClick={() => nav(`/live/play?ch=${encodeURIComponent(c.name)}${group ? `&g=${encodeURIComponent(group)}` : ''}`)}
                  onKeyDown={(e) => e.key === 'Enter' && nav(`/live/play?ch=${encodeURIComponent(c.name)}${group ? `&g=${encodeURIComponent(group)}` : ''}`)}
                >
                  {c.logo ? <img src={c.logo} loading="lazy" alt="" referrerPolicy="no-referrer" /> : <span className="we-live-ph">{c.name.slice(0, 2)}</span>}
                  <span className="we-live-name">{c.name}</span>
                  {c.lines.length > 1 && <span className="muted we-live-n">{c.lines.length} 线路</span>}
                  <button
                    className="we-live-star"
                    title={favs.includes(c.name) ? '取消收藏' : '收藏'}
                    onClick={(e) => { e.stopPropagation(); setFavs(toggleFav(c.name)); }}
                  >
                    {favs.includes(c.name) ? '★' : '☆'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
