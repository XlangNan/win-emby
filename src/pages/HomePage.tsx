// 首页：聚光卡 + 继续观看 / 下一集 / 各媒体库最近添加。
// 版式随皮肤：shelf（网飝）/ shelfWide（大果）= 横向内容行；wall（大豆）= 分区 chip + 海报墙；其余 = 朴素横滚行。
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HScrollRow from '../components/HScrollRow';
import HomeSpotlight from '../components/HomeSpotlight';
import MediaCard from '../components/MediaCard';
import { emby } from '../emby/client';
import type { EmbyItem } from '../emby/types';
import { useAsync } from '../lib/useAsync';
import { useSkinLayout } from '../lib/theme';
import { loadPlayPrefs } from '../lib/prefs';
import { isAndroid } from '../lib/platform';
import MobileHero from '../mobile/MobileHero';

interface Section {
  id: string;
  title: string;
  items: EmbyItem[];
}

const MEDIA_COLLECTIONS = new Set(['movies', 'tvshows', 'homevideos', 'boxsets', 'mixed', undefined, '']);

async function loadSections(): Promise<{ sections: Section[]; spot: EmbyItem[] }> {
  const prefs = loadPlayPrefs();
  const views = (await emby.views())
    .filter((v) => MEDIA_COLLECTIONS.has(v.CollectionType) && !prefs.hiddenLibs.includes(v.Id))
    .sort((a, b) => {
      const ia = prefs.libOrder.indexOf(a.Id), ib = prefs.libOrder.indexOf(b.Id);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
  const [resume, nextUp, ...latest] = await Promise.all([
    emby.resume().catch(() => []),
    emby.nextUp().catch(() => []),
    ...views.map((v) => emby.latest(v.Id).catch(() => [] as EmbyItem[])),
  ]);
  const sections: Section[] = [];
  if (resume.length) sections.push({ id: 'resume', title: '继续观看', items: resume });
  if (nextUp.length) sections.push({ id: 'next', title: '接着看下一集', items: nextUp });
  views.forEach((v, i) => {
    if (latest[i]?.length) sections.push({ id: `latest-${v.Id}`, title: `最近添加 · ${v.Name}`, items: latest[i] });
  });
  // 聚光卡：优先取各库最近添加（电影/剧集），没有再退回继续观看
  const spot = latest.flat().filter((it) => it.Type === 'Movie' || it.Type === 'Series').slice(0, 12);
  return { sections, spot: spot.length ? spot : resume.slice(0, 6) };
}

export default function HomePage() {
  const nav = useNavigate();
  const layout = useSkinLayout();
  const nf = layout.discoverStyle === 'shelf';
  const ap = layout.discoverStyle === 'shelfWide';
  const db = layout.discoverStyle === 'wall';
  const { data, loading, error, reload } = useAsync(loadSections, []);
  const [wallSec, setWallSec] = useState(0);

  const sections = data?.sections || [];
  const open = (it: EmbyItem): void => nav(`/detail/${it.Type === 'Episode' && it.SeriesId ? it.SeriesId : it.Id}`);
  const play = (it: EmbyItem): void => {
    if (it.Type === 'Series') nav(`/detail/${it.Id}`);
    else nav(`/player/${it.Id}`);
  };

  const sectionsView = (): React.ReactNode => {
    if (db) {
      const cur = sections[Math.min(wallSec, Math.max(0, sections.length - 1))];
      return (
        <div className="db-wall">
          <div className="db-wall-chips">
            {sections.map((s, i) => (
              <button key={s.id} type="button" className={'db-wall-chip' + (i === wallSec ? ' active' : '')} onClick={() => setWallSec(i)}>
                {s.title}
              </button>
            ))}
          </div>
          <div className="grid db-wall-grid" key={`wall-${wallSec}`}>
            {(cur?.items || []).map((it) => (
              <MediaCard key={it.Id} it={it} landscape={cur?.id === 'resume'} inResume={cur?.id === 'resume'} onChanged={reload} onOpen={(x) => (x.Type === 'Episode' ? play(x) : open(x))} />
            ))}
          </div>
        </div>
      );
    }
    return sections.map((s) => (
      <div key={s.id} className={nf ? 'nf-row' : ap ? 'ap-row' : undefined} style={nf || ap ? undefined : { marginBottom: 22 }}>
        <h3 className={nf ? 'nf-row-title' : ap ? 'ap-row-title' : undefined} style={nf || ap ? undefined : { margin: '0 0 10px' }}>{s.title}</h3>
        <HScrollRow
          className={nf ? 'nf-row-scroll' : ap ? 'ap-row-scroll' : undefined}
          style={nf || ap ? undefined : { display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}
        >
          {s.items.map((it) => (
            <div key={it.Id} style={s.id === 'resume' ? { flex: '0 0 280px', minWidth: 0 } : nf ? undefined : { flex: ap ? '0 0 168px' : '0 0 132px', minWidth: 0 }}>
              {/* 继续观看里的单集：点击直接续播；其它进详情 */}
              <MediaCard
                it={it}
                landscape={s.id === 'resume'}
                inResume={s.id === 'resume'}
                onChanged={reload}
                onOpen={(x) => (s.id === 'resume' || s.id === 'next' ? play(x) : open(x))}
              />
            </div>
          ))}
        </HScrollRow>
      </div>
    ));
  };

  return (
    <div className="content">
      {isAndroid && <div className="m-home-top" />}
      {isAndroid && data && data.spot.length > 0 && <MobileHero items={data.spot} onOpen={open} onPlay={play} />}
      {!isAndroid && data && data.spot.length > 0 && <HomeSpotlight items={data.spot} landscape={nf && !isAndroid} onOpen={open} onPlay={play} />}
      {loading && !data ? (
        <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
      ) : error ? (
        <div className="err">
          {error}
          <button style={{ marginLeft: 10 }} onClick={reload}>重试</button>
        </div>
      ) : sections.length === 0 ? (
        <div className="empty">媒体库里还没有内容</div>
      ) : (
        sectionsView()
      )}
    </div>
  );
}
