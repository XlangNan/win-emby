// 音乐首页：主页 / 专辑 / 艺术家 / 歌单 / 收藏 + 搜索
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCachedAsync } from '../lib/useAsync';
import { Cover, Ic, SongRow } from './MusicUi';
import { loadNd, nd, ndConfigured, type Album, type AlbumListType, type Song } from './navidrome';
import { playQueue } from './player';

const TAB_KEY = 'wemby-music-tab';
const TABS = [['home', '主页'], ['albums', '专辑'], ['artists', '艺术家'], ['lists', '歌单'], ['fav', '收藏']] as const;
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

export function AlbumCard({ a }: { a: Album }) {
  const nav = useNavigate();
  return (
    <div className="mu-card" role="button" tabIndex={0} onClick={() => nav(`/music/album/${a.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/music/album/${a.id}`); }}>
      <Cover id={a.coverArt} size={360} label={a.name} />
      <div className="mu-card-t">{a.name}</div>
      <div className="mu-card-s">{a.artist}{a.year ? ` · ${a.year}` : ''}</div>
    </div>
  );
}

function AlbumRow({ title, type, k }: { title: string; type: AlbumListType; k: string }) {
  const d = useCachedAsync(`nd:${k}:row:${type}`, () => nd.albumList(type, 20), 2 * 60 * 1000);
  if (d.data && d.data.length === 0) return null;
  return (
    <section className="mu-sec">
      <h3>{title}</h3>
      {d.error ? <div className="err">{d.error}<button style={{ marginLeft: 10 }} onClick={d.reload}>重试</button></div>
        : !d.data ? <div className="muted"><span className="spinner" aria-hidden="true" />加载中…</div>
        : <div className="mu-hrow">{d.data.map((a) => <div key={a.id} className="mu-hcell"><AlbumCard a={a} /></div>)}</div>}
    </section>
  );
}

function Albums({ k }: { k: string }) {
  const [sort, setSort] = useState<AlbumListType>('newest');
  const [list, setList] = useState<Album[]>([]);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(true);
  const [err, setErr] = useState('');
  const load = (reset: boolean): void => {
    setBusy(true);
    nd.albumList(sort, 60, reset ? 0 : list.length)
      .then((r) => { setList((l) => (reset ? r : [...l, ...r])); setMore(r.length === 60 && sort !== 'random'); setErr(''); })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => { load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sort, k]);
  return (
    <>
      <div className="mu-chips">{SORTS.map(([t, n]) => <button key={t} type="button" className={`mu-chip${sort === t ? ' on' : ''}`} onClick={() => setSort(t)}>{n}</button>)}</div>
      {err && <div className="err">{err}</div>}
      <div className="mu-grid">{list.map((a) => <AlbumCard key={a.id} a={a} />)}</div>
      {busy && <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>}
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

function Lists({ k }: { k: string }) {
  const nav = useNavigate();
  const d = useCachedAsync(`nd:${k}:lists`, () => nd.playlists(), 60 * 1000);
  if (!d.data) return <div className="empty">{d.error || <><span className="spinner" aria-hidden="true" />加载中…</>}</div>;
  if (!d.data.length) return <div className="empty">还没有歌单（可以在 Navidrome 网页里创建）</div>;
  return (
    <div className="mu-plist">
      {d.data.map((p) => (
        <div key={p.id} className="mu-prow" role="button" tabIndex={0} onClick={() => nav(`/music/playlist/${p.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/music/playlist/${p.id}`); }}>
          <Cover id={p.coverArt} size={120} label={p.name} className="mu-prow-cv" />
          <span className="mu-prow-main"><b>{p.name}</b><span>{p.songCount} 首</span></span>
        </div>
      ))}
    </div>
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
  const [tab, setTab] = useState(() => localStorage.getItem(TAB_KEY) || 'home');
  const [q, setQ] = useState('');
  const ok = useMemo(() => ndConfigured(), [k]);
  const pick = (t: string): void => { setTab(t); setQ(''); try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };

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
  return (
    <div className="content mu-page">
      <div className="mu-head">
        <div className="mu-title">音乐</div>
        <label className="mu-search"><Ic n="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索歌曲、专辑、艺术家" spellCheck={false} /></label>
      </div>
      <div className="mu-chips mu-tabs">{TABS.map(([t, n]) => <button key={t} type="button" className={`mu-chip${!q && tab === t ? ' on' : ''}`} onClick={() => pick(t)}>{n}</button>)}</div>
      {q.trim() ? <SearchResults q={q.trim()} /> : tab === 'home' ? (
        <>
          <AlbumRow title="最近播放" type="recent" k={k} />
          <AlbumRow title="最近添加" type="newest" k={k} />
          <AlbumRow title="随机推荐" type="random" k={k} />
          <AlbumRow title="常听专辑" type="frequent" k={k} />
        </>
      ) : tab === 'albums' ? <Albums k={k} /> : tab === 'artists' ? <Artists k={k} /> : tab === 'lists' ? <Lists k={k} /> : <Fav k={k} />}
    </div>
  );
}
