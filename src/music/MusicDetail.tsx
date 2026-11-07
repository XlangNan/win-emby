// 专辑 / 歌单 / 艺术家详情
import { useNavigate, useParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import { useCachedAsync } from '../lib/useAsync';
import { Cover, fmtTime, Ic, SongRow } from './MusicUi';
import { AlbumCard } from './MusicPage';
import { loadNd, nd, type Album, type Song } from './navidrome';
import { playQueue, setShuffle } from './player';

function Head({ cover, title, sub, meta, songs }: { cover: string; title: string; sub?: React.ReactNode; meta: string; songs: Song[] }) {
  const go = (shuffle: boolean): void => {
    setShuffle(shuffle);
    playQueue(songs, shuffle ? Math.floor(Math.random() * songs.length) : 0);
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
  const x = d.data;
  return (
    <div className="content mu-page">
      <div style={{ padding: '4px 0 10px' }}><BackButton fallback="/music" /></div>
      {d.error && <div className="err">{d.error}<button style={{ marginLeft: 10 }} onClick={d.reload}>重试</button></div>}
      {!x && !d.error && <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>}
      {x && kind !== 'artist' && (
        <>
          <Head cover={x.cover} title={x.title} songs={x.songs}
            sub={x.sub ? (x.subTo ? <a href={`#${x.subTo}`} onClick={(e) => { e.preventDefault(); nav(x.subTo as string); }}>{x.sub}</a> : x.sub) : undefined}
            meta={[kind === 'album' ? '专辑' : '歌单', x.year || '', total(x.songs), x.fmt || ''].filter(Boolean).join(' · ')} />
          <div className="mu-songs">
            {x.songs.map((s, i) => <SongRow key={`${s.id}-${i}`} s={s} i={i} list={x.songs} showArtist={kind === 'playlist'} showCover={kind === 'playlist'} />)}
          </div>
          {kind === 'album' && x.songs.length > 0 && <div className="muted" style={{ padding: '14px 4px', fontSize: 12 }}>总时长 {fmtTime(x.songs.reduce((a, s) => a + s.duration, 0))}</div>}
        </>
      )}
      {x && kind === 'artist' && (
        <>
          <div className="mu-dhead">
            <Cover id={x.cover} size={400} radius="50%" className="mu-dhead-cv" label={x.title} />
            <div className="mu-dhead-info"><div className="mu-dhead-t">{x.title}</div><div className="mu-dhead-meta">艺术家 · {x.albums.length} 张专辑</div></div>
          </div>
          <div className="mu-grid">{x.albums.map((a) => <AlbumCard key={a.id} a={a} />)}</div>
        </>
      )}
    </div>
  );
}
