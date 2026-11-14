// 首页（仪表盘，电脑版）：日期 + 四个数量 + 足迹（影视 / 音乐 / 有声书按时间排在一起）+ 接着来 + 本周 + 最近入库
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSession } from '../emby/session';
import { ndConfigured, loadNd } from '../music/navidrome';
import { absConfigured, useAbsKey } from '../abs/abs';
import { musicLocal, loadMusic, loadVideo, loadBooks, lastDays, dayKey, fmtCn, type BookStats, type Entry, type MusicStats, type VideoStats } from '../dash/stats';

const fmt = (n: number): string => n.toLocaleString('en-US');
const KIND = { v: '影视', m: '音乐', a: '有声书' } as const;
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function useLoad<T>(f: () => Promise<T>, on: boolean, key: string): { v: T | null; err: boolean } {
  const [s, setS] = useState<{ v: T | null; err: boolean }>({ v: null, err: false });
  useEffect(() => {
    let dead = false;
    if (!on) { setS({ v: null, err: false }); return; }
    f().then((v) => { if (!dead) setS({ v, err: false }); }).catch(() => { if (!dead) setS({ v: null, err: true }); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key]);
  return s;
}

const hue = (s: string): number => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
/** 封面：有图用图，没图（或加载失败）用书名 + 渐变色底 */
function Cv({ src, title, cls }: { src?: string; title: string; cls?: string }) {
  const [bad, setBad] = useState(!src);
  const h = hue(title);
  return (
    <div className={`ed-cv${cls ? ` ${cls}` : ''}`} style={{ background: `linear-gradient(145deg,hsl(${h},52%,38%),hsl(${(h + 40) % 360},55%,13%))` }}>
      {bad ? <span>{title.slice(0, 6)}</span> : <img src={src} alt="" loading="lazy" draggable={false} onError={() => setBad(true)} />}
    </div>
  );
}

function Ev({ e, go }: { e: Entry; go: (to: string) => void }) {
  const kind = e.kind || 'v';
  return (
    <div className={`ed-ev ${kind}`} role="button" tabIndex={0} onClick={() => go(e.to)} onKeyDown={(ev) => ev.key === 'Enter' && go(e.to)}>
      <div className="ed-t">{e.when}</div>
      <div className="ed-rail"><i /></div>
      <div className="ed-main">
        {e.imgs && e.imgs.length > 1
          ? <div className="ed-stack">{e.imgs.map((u, i) => <Cv key={i} src={u} title={e.title} />)}</div>
          : <Cv src={e.img} title={e.title} cls={kind === 'v' ? 'w' : ''} />}
        <div className="x"><div className="ed-kind">{KIND[kind]}</div><div className="ed-tt">{e.title}</div><div className="ed-ss">{e.sub}</div></div>
      </div>
      <div className="ed-note">{e.note}</div>
    </div>
  );
}

function Mini({ e, go, p }: { e: Entry; go: (to: string) => void; p?: boolean }) {
  return (
    <div className="ed-mini" role="button" tabIndex={0} onClick={() => go(e.to)} onKeyDown={(ev) => ev.key === 'Enter' && go(e.to)}>
      <Cv src={e.img} title={e.title} cls={p ? 'p' : ''} />
      <div className="x"><div className="ed-tt">{e.title}</div><div className="ed-ss">{e.sub}</div></div>
    </div>
  );
}

export default function DashboardPage() {
  const nav = useNavigate();
  const go = (to: string): void => nav(to);
  const absKey = useAbsKey();
  const hasNd = ndConfigured();
  const hasAbs = absConfigured();
  const ndKey = JSON.stringify(loadNd());
  const video = useLoad<VideoStats>(loadVideo, !!getSession(), 'v');
  const music = useLoad<MusicStats>(loadMusic, hasNd, ndKey);
  const books = useLoad<BookStats>(loadBooks, hasAbs, absKey);
  const local = useMemo(musicLocal, []);

  const now = new Date();
  const hr = now.getHours();
  const hello = hr < 5 ? '夜深了' : hr < 12 ? '上午好' : hr < 14 ? '中午好' : hr < 18 ? '下午好' : '晚上好';
  const v = video.v, m = music.v, b = books.v;
  const todayK = dayKey(now);
  const yd = new Date(now); yd.setDate(yd.getDate() - 1);
  const yestK = dayKey(yd);

  // 足迹：影视 + 音乐 + 有声书，按时间从新到旧
  const feed = useMemo(() => [...(v?.plays || []), ...local.plays, ...(b?.plays || [])].sort((a, c) => (c.at || 0) - (a.at || 0)), [v, b, local]);
  const groups = [
    { key: todayK, label: '今天', date: now, items: feed.filter((e) => dayKey(new Date(e.at || 0)) === todayK) },
    { key: yestK, label: '昨天', date: yd, items: feed.filter((e) => dayKey(new Date(e.at || 0)) === yestK) },
  ];
  const sum = (items: Entry[], k?: 'v' | 'm' | 'a'): number => items.filter((e) => !k || e.kind === k).reduce((s, e) => s + (e.sec || 0), 0);

  const week = useMemo(() => lastDays().map((d) => ({ ...d, v: v?.week[d.key] || 0, m: local.days[d.key] || 0, a: b?.days[d.key] || 0 })), [v, b, local]);
  const weekTotal = week.reduce((s, d) => s + d.v + d.m + d.a, 0);
  const peak = Math.max(1, ...week.map((d) => d.v + d.m + d.a));
  const bh = (x: number): number => (x > 0 ? Math.max(4, Math.round((x / peak) * 100)) : 0);

  const first = v?.resume[0];
  const resume = [...(b?.resume.slice(0, 2) || []), ...(v?.resume.slice(1, 3) || [])].slice(0, 3);
  const states = [['Emby', !!getSession(), video.err], ['Navidrome', hasNd, music.err], ['Audiobookshelf', hasAbs, books.err]] as const;
  const bad = states.filter(([, on, err]) => !on || err).map(([n, on]) => `${n}${on ? ' 读取失败' : ' 未连接'}`);
  const status = bad.length ? bad.join('，') : 'Emby、Navidrome、Audiobookshelf 均已连接';

  return (
    <div className="content ed-page">
      <header className="ed-mast">
        <div className="ed-date"><b>{now.getMonth() + 1}月{now.getDate()}日</b><span>星期{WEEK[now.getDay()]}</span></div>
        <div className="ed-hi">{hello}，{getSession()?.userName || ''}<small>{status}</small></div>
      </header>

      <section className="ed-count">
        <div className="ed-n v" role="button" tabIndex={0} onClick={() => go('/movies')}><div className="k">电影</div><div className="n">{v ? fmt(v.movies) : '—'}<small>部</small></div><div className="s">{v ? (v.newMovies ? <>昨天新增 <b>{v.newMovies}</b> 部</> : '昨天没有新增') : video.err ? '读取失败' : '读取中…'}</div></div>
        <div className="ed-n t" role="button" tabIndex={0} onClick={() => go('/movies')}><div className="k">剧集</div><div className="n">{v ? fmt(v.series) : '—'}<small>部</small></div><div className="s">{v ? <>共 {fmt(v.episodes)} 集{v.newEpisodes ? <>，昨天新增 <b>{v.newEpisodes}</b> 集</> : null}</> : video.err ? '读取失败' : '读取中…'}</div></div>
        <div className="ed-n m" role="button" tabIndex={0} onClick={() => go('/music')}><div className="k">歌曲</div><div className="n">{m && m.songs ? fmt(m.songs) : '—'}<small>首</small></div><div className="s">{m ? `${fmt(m.albums)} 张专辑，${fmt(m.artists)} 位艺术家` : !hasNd ? '未连接' : music.err ? '读取失败' : '读取中…'}</div></div>
        <div className="ed-n a" role="button" tabIndex={0} onClick={() => go('/audiobooks')}><div className="k">有声书</div><div className="n">{b ? fmt(b.books) : '—'}<small>本</small></div><div className="s">{b ? `约 ${fmt(b.hours)} 小时${b.listening ? `，正在听 ${b.listening} 本` : ''}` : !hasAbs ? '未连接' : books.err ? '读取失败' : '读取中…'}</div></div>
      </section>

      <div className="ed-body">
        <div className="ed-log">
          <div className="ed-h"><h2>你的足迹</h2><span>影视、音乐、有声书按时间排在一起</span></div>
          {groups.map((g) => (
            <div key={g.key}>
              <div className="ed-day"><b>{g.label}</b>周{WEEK[g.date.getDay()]}{g.items.length ? `，共 ${fmtCn(sum(g.items))}` : ''}</div>
              {g.items.length ? g.items.slice(0, 8).map((e) => <Ev key={e.id} e={e} go={go} />) : <div className="ed-empty">{g.key === todayK ? '今天还没有看过、听过东西' : '昨天没有记录'}</div>}
            </div>
          ))}
        </div>
        <aside className="ed-side">
          <section>
            <div className="ed-h"><h2>接着来</h2></div>
            {first ? (
              <div className="ed-big v" role="button" tabIndex={0} onClick={() => go(first.to)} onKeyDown={(ev) => ev.key === 'Enter' && go(first.to)}>
                <Cv src={first.img} title={first.title} cls="w" />
                <div className="bar"><i style={{ width: `${first.pct}%` }} /></div>
                <div className="ed-kind">影视</div><div className="ed-tt">{first.title}</div><div className="ed-ss">{first.note}</div>
              </div>
            ) : null}
            {resume.map((e) => (
              <div key={e.id} className={`ed-mini ${e.to.startsWith('/audiobooks') ? 'a' : 'v'}`} role="button" tabIndex={0} onClick={() => go(e.to)} onKeyDown={(ev) => ev.key === 'Enter' && go(e.to)}>
                <Cv src={e.img} title={e.title} />
                <div className="x"><div className="ed-kind">{e.to.startsWith('/audiobooks') ? '有声书' : '影视'}</div><div className="ed-tt">{e.title}</div><div className="ed-ss">{e.note}</div></div>
              </div>
            ))}
            {!first && !resume.length ? <div className="ed-ss" style={{ marginTop: 14 }}>没有看到一半、听到一半的内容</div> : null}
          </section>
          <section>
            <div className="ed-h"><h2>本周</h2><span>{weekTotal > 0 ? `共 ${fmtCn(weekTotal)}` : ''}</span></div>
            <div className="ed-wk">
              {week.map((d) => {
                const tot = d.v + d.m + d.a;
                return (
                  <div key={d.key} className={d.today ? 'today' : ''} title={`影视 ${fmtCn(d.v)}，音乐 ${fmtCn(d.m)}，有声书 ${fmtCn(d.a)}`}>
                    <u>{tot > 0 ? (tot / 3600).toFixed(1) : ''}</u>
                    {d.a > 0 ? <b className="a" style={{ height: bh(d.a) }} /> : null}
                    {d.v > 0 ? <b className="v" style={{ height: bh(d.v) }} /> : null}
                    {d.m > 0 ? <b className="m" style={{ height: bh(d.m) }} /> : null}
                    <em>{d.label}</em>
                  </div>
                );
              })}
            </div>
            <div className="ed-lg"><span className="v">影视</span><span className="m">音乐</span><span className="a">有声书</span></div>
          </section>
        </aside>
      </div>

      <section className="ed-new">
        <div className="v"><h3>影视</h3>{v?.recent.length ? v.recent.slice(0, 4).map((e) => <Mini key={e.id} e={e} go={go} p />) : <div className="ed-ss">暂无</div>}</div>
        <div className="m"><h3>音乐</h3>{m?.recent.length ? m.recent.slice(0, 4).map((e) => <Mini key={e.id} e={e} go={go} />) : <div className="ed-ss">{hasNd ? '暂无' : '未连接'}</div>}</div>
        <div className="a"><h3>有声书</h3>{b?.recent.length ? b.recent.slice(0, 4).map((e) => <Mini key={e.id} e={e} go={go} />) : <div className="ed-ss">{hasAbs ? '暂无' : '未连接'}</div>}</div>
      </section>
    </div>
  );
}
