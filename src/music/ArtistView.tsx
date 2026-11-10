// 歌手页：详情 / 歌曲 / 专辑 三个页签（专辑、歌曲可按年代 / 名称排序，排序方式本机记住）
import { useEffect, useMemo, useState } from 'react';
import { Cover, Ic, ListFab, SongRow } from './MusicUi';
import { AlbumCard } from './MusicPage';
import { nd, type Album, type Song } from './navidrome';
import { fetchArtistBio, onlineConfigured } from './online';
import { loadOpts } from './prefs';
import { playQueue, shuffled } from './player';

type TabKey = 'info' | 'songs' | 'albums';
const TABS: [TabKey, string][] = [['info', '详情'], ['songs', '歌曲'], ['albums', '专辑']];
const TAB_KEY = 'wemby-artist-tab';

// ───────── 排序（本机记住） ─────────
type SortKey = 'year' | 'name';
interface Sort { k: SortKey; d: 1 | -1 }   // d: 1 = 升序，-1 = 降序（年代降序 = 新的在前）
const SORT_KEY = 'wemby-artist-sort';
const DEF_SORT: { songs: Sort; albums: Sort } = { songs: { k: 'name', d: 1 }, albums: { k: 'year', d: -1 } };
function loadSort(): { songs: Sort; albums: Sort } {
  try { const v = JSON.parse(localStorage.getItem(SORT_KEY) || '{}') as Partial<typeof DEF_SORT>; return { songs: { ...DEF_SORT.songs, ...v.songs }, albums: { ...DEF_SORT.albums, ...v.albums } }; } catch { return { ...DEF_SORT }; }
}
const coll = new Intl.Collator(['zh-Hans-CN-u-co-pinyin', 'zh-CN', 'zh'], { numeric: true, sensitivity: 'base' });

function SortBar({ value, onChange, count, children }: { value: Sort; onChange: (s: Sort) => void; count: string; children?: React.ReactNode }) {
  return (
    <div className="mu-sortbar">
      <span className="mu-sortbar-n">{count}</span>
      <span className="mu-sortbar-sp" />
      {children}
      <span className="mu-seg" role="group" aria-label="排序方式">
        <button type="button" className={value.k === 'year' ? 'on' : ''} onClick={() => onChange({ ...value, k: 'year' })}>年代</button>
        <button type="button" className={value.k === 'name' ? 'on' : ''} onClick={() => onChange({ ...value, k: 'name' })}>名称</button>
      </span>
      <button type="button" className="mu-seg-dir" aria-label={value.d === 1 ? '升序' : '降序'} onClick={() => onChange({ ...value, d: value.d === 1 ? -1 : 1 })}>{value.d === 1 ? '升序 ↑' : '降序 ↓'}</button>
    </div>
  );
}

// ───────── 这位歌手的全部歌曲：逐张专辑取（Navidrome 没有「歌手的所有歌曲」接口） ─────────
const songCache = new Map<string, Song[]>();
function useArtistSongs(key: string, albums: Album[], enabled: boolean): { songs: Song[]; done: number; total: number; finished: boolean } {
  const hit = songCache.get(key);
  const [songs, setSongs] = useState<Song[]>(hit || []);
  const [done, setDone] = useState(hit ? albums.length : 0);
  useEffect(() => {
    if (!enabled) return;
    const c = songCache.get(key);
    if (c) { setSongs(c); setDone(albums.length); return; }
    let dead = false;
    const res: Song[][] = new Array(albums.length).fill(null).map(() => []);
    let next = 0, n = 0;
    const worker = async (): Promise<void> => {
      while (!dead && next < albums.length) {
        const i = next++;
        try { res[i] = (await nd.album(albums[i].id)).songs; } catch { res[i] = []; }
        n++;
        if (!dead) { setDone(n); if (n % 4 === 0 || n === albums.length) setSongs(res.flat()); }
      }
    };
    void Promise.all(Array.from({ length: 5 }, worker)).then(() => { if (!dead) { const all = res.flat(); songCache.set(key, all); setSongs(all); setDone(albums.length); } });
    return () => { dead = true; };
  }, [key, albums, enabled]);
  return { songs, done, total: albums.length, finished: done >= albums.length && (albums.length > 0 || enabled) };
}

// ───────── 简介：本机缓存 → netease-api → Navidrome 自带 ─────────
const BIO = 'wemby-bio:';
function readBio(name: string): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(BIO + name) || 'null') as { t: number; v: string } | null;
    if (!v) return null;
    return Date.now() - v.t < (v.v ? 30 : 1) * 86400000 ? v.v : null;   // 有内容缓存 30 天，没查到的缓存 1 天
  } catch { return null; }
}
function useBio(name: string, id: string): string | null {
  const [bio, setBio] = useState<string | null>(() => readBio(name));
  useEffect(() => {
    const c = readBio(name);
    if (c !== null) { setBio(c); return; }
    setBio(null);
    let dead = false;
    (async () => {
      let t = '';
      try { t = await fetchArtistBio(name); } catch { /* 网易接口不通就退到 Navidrome */ }
      if (!t) { try { t = await nd.artistBio(id); } catch { /* ignore */ } }
      try { localStorage.setItem(BIO + name, JSON.stringify({ t: Date.now(), v: t })); } catch { /* ignore */ }
      if (!dead) setBio(t);
    })();
    return () => { dead = true; };
  }, [name, id]);
  return bio;
}

const topCache = new Map<string, Song[]>();
const fmtDur = (sec: number): string => (sec >= 3600 ? `${Math.floor(sec / 3600)} 小时 ${Math.round((sec % 3600) / 60)} 分钟` : `${Math.round(sec / 60)} 分钟`);

export default function ArtistView({ id, name, cover, albums }: { id: string; name: string; cover: string; albums: Album[] }) {
  const [tab, setTab] = useState<TabKey>(() => { const v = localStorage.getItem(TAB_KEY); return TABS.find((t) => t[0] === v)?.[0] || 'info'; });
  const [sort, setSort] = useState(loadSort);
  const [pending, setPending] = useState<'play' | 'shuffle' | null>(null);
  const [cap, setCap] = useState(120);
  const [bioOpen, setBioOpen] = useState(false);
  const pick = (t: TabKey): void => { setTab(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };
  const setS = (w: 'songs' | 'albums', s: Sort): void => { const n = { ...sort, [w]: s }; setSort(n); try { localStorage.setItem(SORT_KEY, JSON.stringify(n)); } catch { /* ignore */ } };

  const { songs, done, total, finished } = useArtistSongs(id, albums, tab === 'songs' || pending !== null);
  const albumYear = useMemo(() => new Map(albums.map((a) => [a.id, a.year])), [albums]);
  const yearOf = (s: Song): number => s.year || albumYear.get(s.albumId) || 0;

  const sortedAlbums = useMemo(() => {
    const { k, d } = sort.albums;
    return [...albums].sort((a, b) => {
      if (k === 'year') {
        if (!a.year && !b.year) return coll.compare(a.name, b.name);
        if (!a.year) return 1;
        if (!b.year) return -1;
        return (a.year - b.year) * d || coll.compare(a.name, b.name);
      }
      return coll.compare(a.name, b.name) * d;
    });
  }, [albums, sort.albums]);
  const sortedSongs = useMemo(() => {
    const { k, d } = sort.songs;
    return [...songs].sort((a, b) => {
      if (k === 'year') {
        const ya = yearOf(a), yb = yearOf(b);
        if (!ya && !yb) return coll.compare(a.title, b.title);
        if (!ya) return 1;
        if (!yb) return -1;
        return (ya - yb) * d || coll.compare(a.album, b.album) || a.discNumber - b.discNumber || a.track - b.track;
      }
      return coll.compare(a.title, b.title) * d;
    });
  }, [songs, sort.songs, albumYear]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 「播放全部 / 随机」：歌曲还没读完时先读，读完自动开始
  useEffect(() => {
    if (!pending || !finished || !songs.length) return;
    // 顺序播放用「名称 / 年代」排序后的顺序，和你在页面上看到的一致
    playQueue(pending === 'shuffle' ? shuffled(songs) : sortedSongs, 0);
    setPending(null);
  }, [pending, finished, songs, sortedSongs]);

  // 热门歌曲（Navidrome 向外部服务查，可能很慢：放后台，8 秒没回就放弃）
  const [top, setTop] = useState<Song[] | null>(null);
  useEffect(() => {
    setTop(null);
    const hit = topCache.get(name);
    if (hit) { setTop(hit); return; }
    let dead = false;
    const t = new Promise<Song[]>((res) => window.setTimeout(() => res([]), 8000));
    void Promise.race([nd.topSongs(name, 15).catch(() => [] as Song[]), t]).then((l) => { if (l.length) topCache.set(name, l); if (!dead) setTop(l); });
    return () => { dead = true; };
  }, [name]);

  const bio = useBio(name, id);
  const years = albums.map((a) => a.year).filter(Boolean);
  const songTotal = albums.reduce((a, x) => a + x.songCount, 0);
  const durTotal = albums.reduce((a, x) => a + x.duration, 0);
  const span = years.length ? (Math.min(...years) === Math.max(...years) ? String(years[0]) : `${Math.min(...years)} – ${Math.max(...years)}`) : '—';
  const busy = pending !== null && !finished;

  return (
    <>
      <div className="mu-dhead">
        <Cover id={cover} size={400} radius="50%" className="mu-dhead-cv" label={name} />
        <div className="mu-dhead-info">
          <div className="mu-dhead-t">{name}</div>
          <div className="mu-dhead-meta">艺术家 · {albums.length} 张专辑{songTotal ? ` · ${songTotal} 首歌` : ''}</div>
          <div className="mu-dhead-btns">
            <button type="button" className="primary" disabled={!albums.length || busy} onClick={() => setPending('play')}><Ic n="play" size={18} /> {busy && pending === 'play' ? `读取中 ${done}/${total}` : '播放全部'}</button>
            <button type="button" disabled={!albums.length || busy} onClick={() => setPending('shuffle')}><Ic n="shuffle" size={18} /> {busy && pending === 'shuffle' ? `读取中 ${done}/${total}` : '随机'}</button>
          </div>
        </div>
      </div>

      <div className="mu-atabs" role="tablist">
        {TABS.map(([t, n]) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => pick(t)}>{n}</button>)}
      </div>

      {tab === 'info' && (
        <>
          <div className="mu-astats">
            <div><b>{albums.length}</b><span>专辑</span></div>
            <div><b>{songTotal || '—'}</b><span>歌曲</span></div>
            <div><b>{durTotal ? fmtDur(durTotal) : '—'}</b><span>总时长</span></div>
            <div><b>{span}</b><span>年代</span></div>
          </div>
          <section className="mu-sec">
            <h3>简介</h3>
            {bio === null ? <div className="muted"><span className="spinner" aria-hidden="true" /> 正在获取简介…</div>
              : bio ? (
                <>
                  <div className={`mu-bio${bioOpen ? ' open' : ''}`}>{bio}</div>
                  {bio.length > 160 && <button type="button" className="mu-link" onClick={() => setBioOpen((v) => !v)}>{bioOpen ? '收起' : '展开全部'}</button>}
                </>
              )
                : <div className="muted">暂无简介{!onlineConfigured() || !loadOpts().neteaseApi ? '。到「设置 → 音乐选项」填写 netease-api 地址后，可以自动获取歌手简介。' : '。'}</div>}
          </section>
          {top && top.length > 0 && (
            <section className="mu-sec">
              <div className="mu-sec-head"><h3>热门歌曲</h3><button type="button" className="primary" onClick={() => playQueue(top, 0)}><Ic n="play" size={16} /> 播放热门</button></div>
              <div className="mu-songs">{top.slice(0, 10).map((s, i) => <SongRow key={s.id} s={s} i={i} list={top} showCover />)}</div>
            </section>
          )}
        </>
      )}

      {tab === 'songs' && (
        <section className="mu-sec">
          <SortBar value={sort.songs} onChange={(s) => setS('songs', s)} count={finished ? `${songs.length} 首` : `已读取 ${done} / ${total} 张专辑 · ${songs.length} 首`} />
          {!finished && <div className="mu-aprog"><i style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>}
          <div className="mu-songs">
            {sortedSongs.slice(0, cap).map((s, i) => <SongRow key={`${s.id}-${i}`} s={s} i={i} list={sortedSongs} showCover />)}
          </div>
          {sortedSongs.length > cap && <button type="button" className="mu-more-btn" onClick={() => setCap((c) => c + 200)}>显示更多（还有 {sortedSongs.length - cap} 首）</button>}
          {finished && !songs.length && <div className="empty">没有找到这位歌手的歌曲</div>}
        </section>
      )}

      {tab === 'albums' && (
        <section className="mu-sec">
          <SortBar value={sort.albums} onChange={(s) => setS('albums', s)} count={`${albums.length} 张专辑`} />
          <div className="mu-grid">{sortedAlbums.map((a) => <AlbumCard key={a.id} a={a} />)}</div>
        </section>
      )}

      <ListFab songs={tab === 'songs' ? sortedSongs : tab === 'info' && top ? top : undefined}
        onBeforeLocate={(sid) => { const i = sortedSongs.findIndex((s) => s.id === sid); if (i >= cap) setCap(i + 30); }} />
    </>
  );
}
