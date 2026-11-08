// 专辑 / 歌单 / 艺术家详情
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import { useCachedAsync } from '../lib/useAsync';
import { Cover, fmtTime, Ic, SongRow } from './MusicUi';
import { AlbumCard } from './MusicPage';
import { loadNd, nd, type Album, type Song } from './navidrome';
import { askConfirm, toast } from './Dialog';
import { enqueue, playQueue, shuffled } from './player';

const topCache = new Map<string, Song[]>();

function Head({ cover, title, sub, meta, songs, extra }: { cover: string; title: string; sub?: React.ReactNode; meta: string; songs: Song[]; extra?: React.ReactNode }) {
  const go = (shuffle: boolean): void => {
    // 「随机」只打乱这一次的播放顺序，不改全局随机模式
    playQueue(shuffle ? shuffled(songs) : songs, 0);
  };
  return (
    <div className="mu-dhead">
      <Cover id={cover} size={500} className="mu-dhead-cv" label={title} />
      <div className="mu-dhead-info">
        <div className="mu-dhead-t">{title}</div>
        {sub && <div className="mu-dhead-sub">{sub}</div>}
        <div className="mu-dhead-meta">{meta}</div>
        <div className="mu-dhead-btns">
          <button type="button" className="primary" disabled={!songs.length} onClick={() => go(false)}><Ic n="play" size={18} /> 播放</button>
          <button type="button" disabled={!songs.length} onClick={() => go(true)}><Ic n="shuffle" size={18} /> 随机</button>
          <button type="button" disabled={!songs.length} onClick={() => enqueue(songs)}><Ic n="plus" size={18} /> 加入队列</button>
          {extra}
        </div>
      </div>
    </div>
  );
}

const total = (songs: Song[]): string => `${songs.length} 首 · ${Math.round(songs.reduce((a, s) => a + s.duration, 0) / 60)} 分钟`;

export default function MusicDetail() {
  const { kind, id } = useParams();
  const nav = useNavigate();
  const k = loadNd().server;
  const d = useCachedAsync<{ title: string; cover: string; sub?: string; subTo?: string; songs: Song[]; albums: Album[]; year?: number; fmt?: string }>(
    `nd:${k}:${kind}:${id}`,
    async () => {
      if (kind === 'album') {
        const r = await nd.album(id || '');
        const fmts = [...new Set(r.songs.map((s) => s.suffix.toUpperCase()).filter(Boolean))].join('/');
        return { title: r.album.name, cover: r.album.coverArt, sub: r.album.artist, subTo: r.album.artistId ? `/music/artist/${r.album.artistId}` : undefined, songs: r.songs, albums: [], year: r.album.year, fmt: fmts };
      }
      if (kind === 'playlist') {
        const r = await nd.playlist(id || '');
        return { title: r.playlist.name, cover: r.playlist.coverArt, songs: r.songs, albums: [] };
      }
      const r = await nd.artist(id || '');
      return { title: r.artist.name, cover: r.artist.coverArt, songs: [], albums: r.albums };
    },
    60 * 1000,
  );
  // 热门歌曲：Navidrome 要去 Last.fm 之类的外部服务查，可能很慢甚至超时 —— 放后台加载，不挡住专辑列表
  const [top, setTop] = useState<Song[] | null>(null);
  const artistName = kind === 'artist' ? d.data?.title : undefined;
  useEffect(() => {
    setTop(null);
    if (!artistName) return;
    const hit = topCache.get(artistName);
    if (hit) { setTop(hit); return; }
    let dead = false;
    const t = new Promise<Song[]>((res) => window.setTimeout(() => res([]), 8000));
    Promise.race([nd.topSongs(artistName, 15).catch(() => [] as Song[]), t]).then((l) => { if (l.length) topCache.set(artistName, l); if (!dead) setTop(l); });
    return () => { dead = true; };
  }, [artistName]);
  useEffect(() => { if (kind !== 'playlist') return; const f = (): void => d.reload(); window.addEventListener('wemby-nd-playlists', f); return () => window.removeEventListener('wemby-nd-playlists', f); }, [kind, d]);
  const x = d.data;
  return (
    <div className="content mu-page mu-scope">
      <div style={{ padding: '4px 0 10px' }}><BackButton fallback="/music" /></div>
      {d.error && <div className="err">{d.error}<button style={{ marginLeft: 10 }} onClick={d.reload}>重试</button></div>}
      {!x && !d.error && <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>}
      {x && kind !== 'artist' && (
        <>
          <Head cover={x.cover} title={x.title} songs={x.songs}
            sub={x.sub ? (x.subTo ? <a href={`#${x.subTo}`} onClick={(e) => { e.preventDefault(); nav(x.subTo as string); }}>{x.sub}</a> : x.sub) : undefined}
            meta={[kind === 'album' ? '专辑' : '歌单', x.year || '', total(x.songs), x.fmt || ''].filter(Boolean).join(' · ')}
            extra={kind === 'playlist' ? <button type="button" className="mu-danger" onClick={() => { askConfirm(`删除歌单「${x.title}」？`).then((ok) => { if (ok) nd.deletePlaylist(id || '').then(() => { window.dispatchEvent(new Event('wemby-nd-playlists')); nav('/music', { replace: true }); }, (e: Error) => toast(e.message)); }); }}><Ic n="trash" size={18} /> 删除歌单</button> : undefined} />
          <div className="mu-songs">
            {x.songs.map((s, i) => <SongRow key={`${s.id}-${i}`} s={s} i={i} list={x.songs} showArtist={kind === 'playlist'} showCover={kind === 'playlist'}
              ctx={kind === 'playlist' ? { onRemove: () => { nd.removeFromPlaylist(id || '', i).then(() => { window.dispatchEvent(new Event('wemby-nd-playlists')); d.reload(); }, (e: Error) => toast(e.message)); } } : undefined} />)}
          </div>
          {x.songs.length === 0 && <div className="empty">这里还没有歌曲</div>}
          {kind === 'album' && x.songs.length > 0 && <div className="muted" style={{ padding: '14px 4px', fontSize: 12 }}>总时长 {fmtTime(x.songs.reduce((a, s) => a + s.duration, 0))}</div>}
        </>
      )}
      {x && kind === 'artist' && (
        <>
          <div className="mu-dhead">
            <Cover id={x.cover} size={400} radius="50%" className="mu-dhead-cv" label={x.title} />
            <div className="mu-dhead-info"><div className="mu-dhead-t">{x.title}</div><div className="mu-dhead-meta">艺术家 · {x.albums.length} 张专辑</div></div>
          </div>
          {top && top.length > 0 && (
            <section className="mu-sec">
              <div className="mu-sec-head"><h3>热门歌曲</h3><button type="button" className="primary" onClick={() => playQueue(top, 0)}><Ic n="play" size={16} /> 播放热门</button></div>
              <div className="mu-songs">{top.slice(0, 10).map((s, i) => <SongRow key={s.id} s={s} i={i} list={top} showCover />)}</div>
            </section>
          )}
          <section className="mu-sec"><h3>专辑 · {x.albums.length}</h3><div className="mu-grid">{x.albums.map((a) => <AlbumCard key={a.id} a={a} />)}</div></section>
        </>
      )}
    </div>
  );
}
