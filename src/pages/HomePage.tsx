// 首页：聚光卡 + 继续观看 / 下一集 / 各媒体库最近添加。
// 版式随皮肤：shelf（网飝）/ shelfWide（大果）= 横向内容行；wall（大豆）= 分区 chip + 海报墙；其余 = 朴素横滚行。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HScrollRow from '../components/HScrollRow';
import HomeSpotlight from '../components/HomeSpotlight';
import MediaCard from '../components/MediaCard';
import { emby } from '../emby/client';
import type { EmbyItem } from '../emby/types';
import { useCachedAsync } from '../lib/useAsync';
import { useSkinLayout } from '../lib/theme';
import { loadPlayPrefs } from '../lib/prefs';
import { isMobileApp } from '../lib/platform';
import { getSession } from '../emby/session';
import MobileHero from '../mobile/MobileHero';

let homeScroll = 0;

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
  // 轮播：按设置的来源媒体库 / 内容 / 数量取
  const heroViews = views.filter((v) => !prefs.heroLibs.length || prefs.heroLibs.includes(v.Id));
  const n = prefs.heroCount || 10;
  let spot: EmbyItem[] = [];
  if (prefs.heroMode === 'resume') spot = resume.filter((it) => it.Type === 'Movie' || it.Type === 'Episode').slice(0, n);
  else if (prefs.heroMode === 'random') {
    const rs = await Promise.all(heroViews.map((v) => emby.items({ parentId: v.Id, types: 'Movie,Series', sortBy: 'Random', start: 0, limit: n }).then((r) => r.Items).catch(() => [] as EmbyItem[])));
    spot = rs.flat().sort(() => Math.random() - 0.5).slice(0, n);
  } else {
    const idx = new Set(heroViews.map((v) => v.Id));
    spot = latest.filter((_, i) => idx.has(views[i].Id)).flat().filter((it) => it.Type === 'Movie' || it.Type === 'Series').slice(0, n);
  }
  if (!prefs.heroOn) spot = [];
  return { sections, spot };
}

/** 缓存键：区分账号，也区分轮播 / 媒体库显示设置——换账号、改设置后立刻按新的来 */
function homeKey(): string {
  const s = getSession();
  const p = loadPlayPrefs();
  return `home:${s?.server || ''}:${s?.userId || ''}:${JSON.stringify([p.heroOn, p.heroLibs, p.heroMode, p.heroCount, p.hiddenLibs, p.libOrder])}`;
}

export default function HomePage() {
  const nav = useNavigate();
  const layout = useSkinLayout();
  const nf = layout.discoverStyle === 'shelf';
  const ap = layout.discoverStyle === 'shelfWide';
  const db = layout.discoverStyle === 'wall';
  // 缓存首页数据（1 分钟内再进来直接用，之后后台刷新）+ 记住滚动位置：从详情返回回到原来的位置
  const { data, loading, error, reload } = useCachedAsync(homeKey(), loadSections, 60 * 1000);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (box.current && homeScroll > 0) box.current.scrollTop = homeScroll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data]);
  const [wallSec, setWallSec] = useState(0);

  // 「继续观看 / 接着看」每次进首页都立刻重新取（很快），不受缓存影响
  const [fresh, setFresh] = useState<{ resume: EmbyItem[]; next: EmbyItem[] } | null>(null);
  const refreshFresh = (): void => {
    Promise.all([emby.resume().catch(() => null), emby.nextUp().catch(() => null)]).then(([r, n]) => {
      if (r && n) setFresh({ resume: r, next: n });
    });
  };
  useEffect(() => { refreshFresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  // 菜单操作后：先立刻把该项从「继续观看」拿掉（含缓存里的旧数据），再向服务器重新取
  const changed = (info?: { id: string; remove?: boolean }): void => {
    if (info?.remove) {
      const id = info.id;
      setFresh((f) => {
        const cur = f || { resume: (data?.sections.find((x) => x.id === 'resume')?.items) || [], next: (data?.sections.find((x) => x.id === 'next')?.items) || [] };
        return { resume: cur.resume.filter((x) => x.Id !== id), next: cur.next };
      });
      if (data) for (const sec of data.sections) if (sec.id === 'resume') sec.items = sec.items.filter((x) => x.Id !== id);
      return;
    }
    refreshFresh();
    reload();
  };
  const sections: Section[] = (() => {
    const base = data?.sections || [];
    if (!fresh) return base;
    const rest = base.filter((x) => x.id !== 'resume' && x.id !== 'next');
    return [
      ...(fresh.resume.length ? [{ id: 'resume', title: '继续观看', items: fresh.resume }] : []),
      ...(fresh.next.length ? [{ id: 'next', title: '接着看下一集', items: fresh.next }] : []),
      ...rest,
    ];
  })();
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
              <MediaCard key={it.Id} it={it} landscape={cur?.id === 'resume'} inResume={cur?.id === 'resume'} onChanged={changed} onOpen={(x) => (x.Type === 'Episode' ? play(x) : open(x))} />
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
                onChanged={changed}
                onOpen={(x) => (s.id === 'resume' || s.id === 'next' ? play(x) : open(x))}
              />
            </div>
          ))}
        </HScrollRow>
      </div>
    ));
  };

  return (
    <div className="content" ref={box} onScroll={(e) => { homeScroll = e.currentTarget.scrollTop; }}>
      {isMobileApp && <div className="m-home-top" />}
      {isMobileApp && data && data.spot.length > 0 && <MobileHero items={data.spot} onOpen={open} onPlay={play} />}
      {!isMobileApp && data && data.spot.length > 0 && <HomeSpotlight items={data.spot} landscape={nf && !isMobileApp} onOpen={open} onPlay={play} />}
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
