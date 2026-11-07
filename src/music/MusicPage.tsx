// 音乐首页（网易云风格）：推荐 / 专辑 / 艺术家 / 排行榜 / 歌单 / 收藏 + 搜索
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCachedAsync } from '../lib/useAsync';
import { Cover, Ic, PlayCover, SongRow } from './MusicUi';
import { loadNd, nd, ndConfigured, type Album, type AlbumListType, type Playlist, type Song } from './navidrome';
import { playQueue, setShuffle, useMusic } from './player';

const TAB_KEY = 'wemby-music-tab2';
const TABS = [['rec', '推荐'], ['albums', '专辑'], ['artists', '艺术家'], ['charts', '排行榜'], ['lists', '歌单'], ['fav', '我喜欢']] as const;
type Tab = (typeof TABS)[number][0];
const SORTS: [AlbumListType, string][] = [['newest', '最近添加'], ['alphabeticalByName', '名称'], ['alphabeticalByArtist', '艺术家'], ['frequent', '常听'], ['random', '随机']];

function useNdKey(): string {
  const [k, setK] = useState(() => loadNd().server + loadNd().user);
  useEffect(() => {
    const f = (): void => setK(loadNd().server + loadNd().user);
    window.addEventListener('wemby-nd-changed', f);
    return () => window.removeEventListener('wemby-nd-changed', f);
  }, []);
  return k;
}

/** 歌单列表（新建 / 删除 / 加歌后自动刷新） */
export function usePlaylists(k: string): { list: Playlist[] | null; err: string; reload: () => void } {
  const [list, setList] = useState<Playlist[] | null>(null);
  const [err, setErr] = useState('');
  const reload = useCallback(() => { nd.playlists().then((l) => { setList(l); setErr(''); }).catch((e: Error) => setErr(e.message)); }, []);
  useEffect(() => { setList(null); reload(); }, [k, reload]);
  useEffect(() => { window.addEventListener('wemby-nd-playlists', reload); return () => window.removeEventListener('wemby-nd-playlists', reload); }, [reload]);
  return { list, err, reload };
}

const albumSongs = (id: string) => (): Promise<Song[]> => nd.album(id).then((r) => r.songs);
const plSongs = (id: string) => (): Promise<Song[]> => nd.playlist(id).then((r) => r.songs);
const fmtCount = (n: number): string => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n));

export function AlbumCard({ a }: { a: Album }) {
  const nav = useNavigate();
  return (
    <div className="mu-card" role="button" tabIndex={0} onClick={() => nav(`/music/album/${a.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/music/album/${a.id}`); }}>
      <PlayCover id={a.coverArt} size={360} label={a.name} onPlay={albumSongs(a.id)} badge={a.songCount ? `${a.songCount} 首` : undefined} />
      <div className="mu-card-t">{a.name}</div>
      <div className="mu-card-s">{a.artist}{a.year ? ` · ${a.year}` : ''}</div>
    </div>
  );
}

function PlaylistCard({ p }: { p: Playlist }) {
  const nav = useNavigate();
  return (
    <div className="mu-card" role="button" tabIndex={0} onClick={() => nav(`/music/playlist/${p.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/music/playlist/${p.id}`); }}>
      <PlayCover id={p.coverArt} size={360} label={p.name} onPlay={plSongs(p.id)} badge={`${fmtCount(p.songCount)} 首`} />
      <div className="mu-card-t">{p.name}</div>
      <div className="mu-card-s">{p.songCount} 首歌曲</div>
    </div>
  );
}

function SecHead({ title, more, onMore }: { title: string; more?: string; onMore?: () => void }) {
  return <div className="mu-sec-head"><h3>{title}</h3>{onMore && <button type="button" className="mu-link" onClick={onMore}>{more || '更多'} <Ic n="fwd" size={14} /></button>}</div>;
}

/** 顶部轮播 */
function Banner({ k }: { k: string }) {
  const nav = useNavigate();
  const d = useCachedAsync(`nd:${k}:banner`, () => nd.albumList('random', 6), 5 * 60 * 1000);
  const [i, setI] = useState(0);
  const hold = useRef(false);
  const n = d.data?.length || 0;
  useEffect(() => {
    if (n < 2) return;
    const t = window.setInterval(() => { if (!hold.current && !document.hidden) setI((x) => (x + 1) % n); }, 4500);
    return () => window.clearInterval(t);
  }, [n]);
  if (!d.data || !n) return <div className="mu-banner mu-banner-ph" />;
  const list = d.data;
  const at = (o: number): Album => list[(i + o + n) % n];
  const cur = at(0);
  return (
    <div className="mu-banner" onMouseEnter={() => { hold.current = true; }} onMouseLeave={() => { hold.current = false; }}>
      <div className="mu-banner-stage">
        {n > 1 && <div className="mu-banner-side l" role="button" aria-label="上一张" onClick={() => setI((x) => (x - 1 + n) % n)}><Cover id={at(-1).coverArt} size={400} label={at(-1).name} /></div>}
        <div className="mu-banner-main" role="button" tabIndex={0} onClick={() => nav(`/music/album/${cur.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/music/album/${cur.id}`); }}>
          <Cover id={cur.coverArt} size={700} label={cur.name} />
          <div className="mu-banner-cap"><b>{cur.name}</b><span>{cur.artist}{cur.year ? ` · ${cur.year}` : ''}</span></div>
          <button type="button" className="mu-banner-play" aria-label="播放" onClick={(e) => { e.stopPropagation(); albumSongs(cur.id)().then((l) => playQueue(l, 0)).catch(() => undefined); }}><Ic n="play" size={20} /></button>
        </div>
        {n > 1 && <div className="mu-banner-side r" role="button" aria-label="下一张" onClick={() => setI((x) => (x + 1) % n)}><Cover id={at(1).coverArt} size={400} label={at(1).name} /></div>}
      </div>
      <div className="mu-dots">{list.map((_, x) => <button key={x} type="button" aria-label={`第 ${x + 1} 张`} className={x === i ? 'on' : ''} onClick={() => setI(x)} />)}</div>
    </div>
  );
}

function Shortcuts({ go }: { go: (t: Tab) => void }) {
  const nav = useNavigate();
  const play = (f: () => Promise<Song[]>): void => { f().then((l) => { if (l.length) playQueue(l, 0); }).catch(() => undefined); };
  const items: [string, string, () => void][] = [
    ['cal', '每日推荐', () => play(() => nd.randomSongs(30))],
    ['radio', '私人漫游', () => { setShuffle(true); play(() => nd.randomSongs(60)); }],
    ['list', '歌单', () => go('lists')],
    ['chart', '排行榜', () => go('charts')],
    ['heart', '我喜欢', () => go('fav')],
    ['disc', '专辑', () => go('albums')],
  ];
  void nav;
  return <div className="mu-short">{items.map(([ic, t, f]) => <button key={t} type="button" onClick={f}><i><Ic n={ic} size={24} /></i><span>{t}</span></button>)}</div>;
}

function HRow({ title, type, k, go, more }: { title: string; type: AlbumListType; k: string; go?: () => void; more?: string }) {
  const d = useCachedAsync(`nd:${k}:row:${type}`, () => nd.albumList(type, 18), 2 * 60 * 1000);
  if (d.data && d.data.length === 0) return null;
  return (
    <section className="mu-sec">
      <SecHead title={title} onMore={go} more={more} />
      {d.error ? <div className="err">{d.error}<button style={{ marginLeft: 10 }} onClick={d.reload}>重试</button></div>
        : !d.data ? <div className="muted"><span className="spinner" aria-hidden="true" />加载中…</div>
        : <div className="mu-hrow">{d.data.map((a) => <div key={a.id} className="mu-hcell"><AlbumCard a={a} /></div>)}</div>}
    </section>
  );
}

function Recommend({ k, go }: { k: string; go: (t: Tab) => void }) {
  const pl = usePlaylists(k);
  return (
    <>
      <Banner k={k} />
      <Shortcuts go={go} />
      {pl.list && pl.list.length > 0 && (
        <section className="mu-sec">
          <SecHead title="推荐歌单" onMore={() => go('lists')} />
          <div className="mu-hrow">{pl.list.slice(0, 12).map((p) => <div key={p.id} className="mu-hcell"><PlaylistCard p={p} /></div>)}</div>
        </section>
      )}
      <HRow title="新碟上架" type="newest" k={k} go={() => go('albums')} />
      <HRow title="最近播放" type="recent" k={k} />
      <HRow title="常听专辑" type="frequent" k={k} go={() => go('charts')} more="排行榜" />
      <HRow title="随机发现" type="random" k={k} />
    </>
  );
}

function Charts({ k }: { k: string }) {
  const defs: [AlbumListType, string, string][] = [['newest', '新碟榜', '最近入库的专辑'], ['frequent', '热听榜', '听得最多的专辑'], ['recent', '最近播放榜', '刚刚听过的专辑'], ['starred', '喜爱榜', '你收藏的专辑']];
  return <div className="mu-charts">{defs.map(([t, n, d]) => <Chart key={t} type={t} name={n} desc={d} k={k} />)}</div>;
}
function Chart({ type, name, desc, k }: { type: AlbumListType; name: string; desc: string; k: string }) {
  const nav = useNavigate();
  const d = useCachedAsync(`nd:${k}:chart:${type}`, () => nd.albumList(type, 10), 2 * 60 * 1000);
  return (
    <div className="mu-chart">
      <div className="mu-chart-h"><b>{name}</b><span>{desc}</span></div>
      {!d.data ? <div className="muted" style={{ padding: 14 }}>{d.error || '加载中…'}</div>
        : d.data.length === 0 ? <div className="muted" style={{ padding: 14 }}>暂无数据</div>
        : d.data.map((a, i) => (
          <div key={a.id} className="mu-rank" role="button" tabIndex={0} onClick={() => nav(`/music/album/${a.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/music/album/${a.id}`); }}>
            <em className={i < 3 ? 'top' : ''}>{i + 1}</em>
            <Cover id={a.coverArt} size={80} className="mu-rank-cv" label={a.name} />
            <span className="mu-rank-t"><b>{a.name}</b><span>{a.artist}</span></span>
          </div>
        ))}
    </div>
  );
}

function Albums({ k }: { k: string }) {
  const [sort, setSort] = useState<AlbumListType>('newest');
  const [genre, setGenre] = useState('');
  const gs = useCachedAsync(`nd:${k}:genres`, () => nd.genres(), 10 * 60 * 1000);
  const [list, setList] = useState<Album[]>([]);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(true);
  const [err, setErr] = useState('');
  const seq = useRef(0);
  const load = (reset: boolean): void => {
    const my = ++seq.current;
    setBusy(true);
    const t: AlbumListType = genre ? 'byGenre' : sort;
    nd.albumList(t, 60, reset ? 0 : list.length, genre || undefined)
      .then((r) => { if (my !== seq.current) return; setList((l) => (reset ? r : [...l, ...r])); setMore(r.length === 60 && t !== 'random'); setErr(''); })
      .catch((e: Error) => { if (my === seq.current) setErr(e.message); })
      .finally(() => { if (my === seq.current) setBusy(false); });
  };
  useEffect(() => { setList([]); load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sort, genre, k]);
  return (
    <>
      <div className="mu-filter"><span>排序</span>{SORTS.map(([t, n]) => <button key={t} type="button" className={`mu-tag${!genre && sort === t ? ' on' : ''}`} onClick={() => { setGenre(''); setSort(t); }}>{n}</button>)}</div>
      {gs.data && gs.data.length > 0 && (
        <div className="mu-filter"><span>风格</span>{gs.data.slice(0, 24).map((g) => <button key={g.name} type="button" className={`mu-tag${genre === g.name ? ' on' : ''}`} onClick={() => setGenre(genre === g.name ? '' : g.name)}>{g.name}</button>)}</div>
      )}
      {err && <div className="err">{err}</div>}
      <div className="mu-grid">{list.map((a) => <AlbumCard key={a.id} a={a} />)}</div>
      {busy && <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>}
      {!busy && !err && list.length === 0 && <div className="empty">没有找到专辑</div>}
      {!busy && more && list.length > 0 && <div style={{ textAlign: 'center', padding: 16 }}><button type="button" onClick={() => load(false)}>加载更多</button></div>}
    </>
  );
}

function Artists({ k }: { k: string }) {
  const nav = useNavigate();
  const d = useCachedAsync(`nd:${k}:artists`, () => nd.artists(), 5 * 60 * 1000);
  if (!d.data) return <div className="empty">{d.error || <><span className="spinner" aria-hidden="true" />加载中…</>}</div>;
  return (
    <div className="mu-grid mu-artists">
      {d.data.map((a) => (
        <div key={a.id} className="mu-card mu-artist" role="button" tabIndex={0} onClick={() => nav(`/music/artist/${a.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/music/artist/${a.id}`); }}>
          <Cover id={a.coverArt} size={300} radius="50%" label={a.name} />
          <div className="mu-card-t" style={{ textAlign: 'center' }}>{a.name}</div>
          <div className="mu-card-s" style={{ textAlign: 'center' }}>{a.albumCount} 张专辑</div>
        </div>
      ))}
    </div>
  );
}

export function createPlaylistPrompt(k?: () => void): void {
  const name = window.prompt('新建歌单名称');
  if (!name?.trim()) return;
  nd.createPlaylist(name.trim()).then(() => { window.dispatchEvent(new Event('wemby-nd-playlists')); k?.(); }, (e: Error) => window.alert(e.message));
}

function Lists({ k }: { k: string }) {
  const pl = usePlaylists(k);
  if (!pl.list) return <div className="empty">{pl.err || <><span className="spinner" aria-hidden="true" />加载中…</>}</div>;
  return (
    <>
      <div className="mu-sec-head"><h3>我的歌单 · {pl.list.length}</h3><button type="button" className="primary" onClick={() => createPlaylistPrompt()}><Ic n="plus" size={16} /> 新建歌单</button></div>
      {!pl.list.length ? <div className="empty">还没有歌单，点右上角新建，或在歌曲菜单里「添加到歌单」</div>
        : <div className="mu-grid">{pl.list.map((p) => <PlaylistCard key={p.id} p={p} />)}</div>}
    </>
  );
}

function Fav({ k }: { k: string }) {
  const d = useCachedAsync(`nd:${k}:fav`, () => nd.starred(), 20 * 1000);
  if (!d.data) return <div className="empty">{d.error || <><span className="spinner" aria-hidden="true" />加载中…</>}</div>;
  const { songs, albums } = d.data;
  if (!songs.length && !albums.length) return <div className="empty">还没有收藏，点歌曲后面的心形就会出现在这里</div>;
  return (
    <>
      {songs.length > 0 && (
        <section className="mu-sec">
          <div className="mu-sec-head"><h3>收藏的歌曲 · {songs.length}</h3><button type="button" className="primary" onClick={() => playQueue(songs, 0)}><Ic n="play" size={16} /> 播放全部</button></div>
          <div className="mu-songs">{songs.map((s, i) => <SongRow key={s.id} s={s} i={i} list={songs} showArtist showCover />)}</div>
        </section>
      )}
      {albums.length > 0 && (
        <section className="mu-sec"><h3>收藏的专辑</h3><div className="mu-grid">{albums.map((a) => <AlbumCard key={a.id} a={a} />)}</div></section>
      )}
    </>
  );
}

function SearchResults({ q }: { q: string }) {
  const nav = useNavigate();
  const [r, setR] = useState<{ songs: Song[]; albums: Album[]; artists: { id: string; name: string; coverArt: string; albumCount: number }[] } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let dead = false;
    const t = setTimeout(() => nd.search(q).then((x) => { if (!dead) { setR(x); setErr(''); } }).catch((e: Error) => !dead && setErr(e.message)), 300);
    return () => { dead = true; clearTimeout(t); };
  }, [q]);
  if (err) return <div className="err">{err}</div>;
  if (!r) return <div className="empty"><span className="spinner" aria-hidden="true" />搜索中…</div>;
  if (!r.songs.length && !r.albums.length && !r.artists.length) return <div className="empty">没有匹配「{q}」的内容</div>;
  return (
    <>
      {r.artists.length > 0 && (
        <section className="mu-sec"><h3>艺术家</h3>
          <div className="mu-hrow">{r.artists.map((a) => (
            <div key={a.id} className="mu-hcell mu-artist" role="button" tabIndex={0} onClick={() => nav(`/music/artist/${a.id}`)}>
              <Cover id={a.coverArt} size={240} radius="50%" label={a.name} /><div className="mu-card-t" style={{ textAlign: 'center' }}>{a.name}</div>
            </div>))}</div></section>
      )}
      {r.albums.length > 0 && <section className="mu-sec"><h3>专辑</h3><div className="mu-hrow">{r.albums.map((a) => <div key={a.id} className="mu-hcell"><AlbumCard a={a} /></div>)}</div></section>}
      {r.songs.length > 0 && <section className="mu-sec"><h3>歌曲</h3><div className="mu-songs">{r.songs.map((s, i) => <SongRow key={s.id} s={s} i={i} list={r.songs} showArtist showCover />)}</div></section>}
    </>
  );
}

export default function MusicPage() {
  const nav = useNavigate();
  const k = useNdKey();
  const m = useMusic();
  const [tab, setTab] = useState<Tab>(() => { const v = localStorage.getItem(TAB_KEY); return (TABS.find((t) => t[0] === v)?.[0]) || 'rec'; });
  const [q, setQ] = useState('');
  const ok = useMemo(() => ndConfigured(), [k]);
  const pl = usePlaylists(ok ? k : '');
  const pick = (t: Tab): void => { setTab(t); setQ(''); try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };

  if (!ok) {
    return (
      <div className="content mu-page">
        <div className="mu-title">音乐</div>
        <div className="card" style={{ padding: 20, maxWidth: 520 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>还没有连接 Navidrome</div>
          <div className="muted" style={{ marginBottom: 14 }}>到设置里填写 Navidrome 的地址、用户名和密码，就能在这里听音乐了。</div>
          <button type="button" className="primary" onClick={() => nav('/config')}>去设置</button>
        </div>
      </div>
    );
  }
  const side = (t: Tab, n: string, ic: string): React.ReactNode => (
    <button key={t} type="button" className={`mu-side-i${!q && tab === t ? ' on' : ''}`} onClick={() => pick(t)}><Ic n={ic} size={18} /><span>{n}</span></button>
  );
  return (
    <div className="content mu-page mu-wy">
      <aside className="mu-side">
        <div className="mu-side-g">发现音乐</div>
        {side('rec', '推荐', 'note')}
        {side('albums', '专辑', 'disc')}
        {side('artists', '艺术家', 'user')}
        {side('charts', '排行榜', 'chart')}
        <div className="mu-side-g">我的音乐</div>
        {side('fav', '我喜欢的音乐', 'heart')}
        <div className="mu-side-g">创建的歌单<button type="button" className="mu-side-add" aria-label="新建歌单" onClick={() => createPlaylistPrompt()}><Ic n="plus" size={16} /></button></div>
        <div className="mu-side-pl">
          {(pl.list || []).map((p) => <button key={p.id} type="button" className="mu-side-i" onClick={() => nav(`/music/playlist/${p.id}`)}><Ic n="list" size={18} /><span>{p.name}</span></button>)}
          {pl.list && !pl.list.length && <div className="muted" style={{ padding: '4px 12px', fontSize: 12.5 }}>还没有歌单</div>}
        </div>
      </aside>
      <div className="mu-main">
        <div className="mu-head">
          <label className="mu-search"><Ic n="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={m.cur ? `搜索 · 正在播放 ${m.cur.title}` : '搜索歌曲、专辑、艺术家'} spellCheck={false} />{q && <button type="button" className="mu-search-x" aria-label="清除" onClick={() => setQ('')}><Ic n="close" size={14} /></button>}</label>
        </div>
        <div className="mu-utabs">{TABS.map(([t, n]) => <button key={t} type="button" className={!q && tab === t ? 'on' : ''} onClick={() => pick(t)}>{n}</button>)}</div>
        {q.trim() ? <SearchResults q={q.trim()} /> : tab === 'rec' ? <Recommend k={k} go={pick} /> : tab === 'albums' ? <Albums k={k} />
          : tab === 'artists' ? <Artists k={k} /> : tab === 'charts' ? <Charts k={k} /> : tab === 'lists' ? <Lists k={k} /> : <Fav k={k} />}
      </div>
    </div>
  );
}
