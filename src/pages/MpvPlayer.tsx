// MPV 播放页：画面由内嵌的 libmpv 渲染（原生子窗口，支持 HDR10 / HLG / 杜比视界），
// 网页层背景透明，只画控制条与右侧信息抽屉。mpv 起不来时通知上层改用 HTML5 播放器。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PlayerDrawer from '../components/PlayerDrawer';
import { directStreamUrl, emby, subtitleUrl } from '../emby/client';
import { fmtDuration, ticksToSec } from '../emby/format';
import type { EmbyItem, MediaSource, MediaStream } from '../emby/types';
import { openMpv, type MpvSession } from '../lib/mpv';
import { loadPlayPrefs, savePlayPrefs, setTrackMemory } from '../lib/prefs';
import { pickInitialTracks } from '../lib/tracks';
import { usePlayItem } from '../lib/usePlayItem';
import { winClose, winIsFullscreen, winMinimize, winSetFullscreen, winToggleMax } from '../lib/win';

/** 告诉 Emby「什么都能直接播」，只是为了拿到 PlaySessionId，真正的文件由 mpv 解码 */
const DIRECT_ALL_PROFILE = {
  Name: 'Win-Emby MPV',
  MaxStreamingBitrate: 1_000_000_000,
  MaxStaticBitrate: 1_000_000_000,
  DirectPlayProfiles: [{ Type: 'Video' }, { Type: 'Audio' }],
  TranscodingProfiles: [],
  SubtitleProfiles: [],
};

const audioLabel = (s: MediaStream): string =>
  s.DisplayTitle || [s.Language, s.Codec?.toUpperCase(), s.Channels ? `${s.Channels}ch` : ''].filter(Boolean).join(' · ') || `音轨 ${s.Index}`;
const subLabel = (s: MediaStream): string =>
  s.DisplayTitle || [s.Language, s.Codec?.toUpperCase()].filter(Boolean).join(' · ') || `字幕 ${s.Index}`;

/** 「4K · 杜比视界」之类的画面标签 */
function videoBadge(src?: MediaSource): string {
  const v = src?.MediaStreams?.find((s) => s.Type === 'Video');
  if (!v) return '';
  const h = v.Height || 0;
  const res = h >= 2000 ? '4K' : h >= 1400 ? '2K' : h >= 1000 ? '1080P' : h >= 700 ? '720P' : h ? `${h}P` : '';
  const t = `${v.VideoRangeType || ''} ${v.VideoRange || ''}`.toLowerCase();
  const range = t.includes('dovi') || t.includes('dolby')
    ? '杜比视界'
    : t.includes('hdr10plus')
      ? 'HDR10+'
      : t.includes('hlg')
        ? 'HLG'
        : t.includes('hdr10')
          ? 'HDR10'
          : t.includes('hdr')
            ? 'HDR'
            : '';
  return [res, range].filter(Boolean).join(' · ');
}

export default function MpvPlayer({ id, onFail }: { id: string; onFail: (msg: string) => void }) {
  const nav = useNavigate();
  const [qs] = useSearchParams();
  const wantSrc = qs.get('src') || '';
  const { item, episodes, nextEp } = usePlayItem(id);
  const sessRef = useRef<MpvSession | null>(null);
  const playRef = useRef<{ source: MediaSource; playSessionId?: string } | null>(null);
  const posRef = useRef(0);
  const pausedRef = useRef(true);
  const endedRef = useRef(false);
  const hideTimer = useRef<number | null>(null);
  const extSid = useRef<Map<number, number>>(new Map());
  const nextRef = useRef<EmbyItem | null>(null);
  nextRef.current = nextEp;

  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [paused, setPaused] = useState(true);
  const [caching, setCaching] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [vol, setVol] = useState(100);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [aid, setAid] = useState<number | null>(null);
  const [sid, setSid] = useState<number | null>(null);
  const [hw, setHw] = useState('');
  const [full, setFull] = useState(false);
  const [uiShown, setUiShown] = useState(true);
  const [menu, setMenu] = useState<'' | 'audio' | 'sub' | 'speed' | 'eps'>('');
  const [fps, setFps] = useState(0);
  const [vbr, setVbr] = useState(0);
  const autoSkipArmed = useRef(false);
  const pendingSub = useRef<MediaStream | null>(null);
  const [drawer, setDrawer] = useState(false);

  const source = item?.MediaSources?.find((m) => m.Id === wantSrc) || item?.MediaSources?.[0];
  const streams = source?.MediaStreams || [];
  const audios = useMemo(() => streams.filter((s) => s.Type === 'Audio'), [streams]);
  const embSubs = useMemo(() => streams.filter((s) => s.Type === 'Subtitle' && !s.IsExternal), [streams]);
  const extSubs = useMemo(() => streams.filter((s) => s.Type === 'Subtitle' && s.IsExternal), [streams]);
  const badge = videoBadge(source);
  const vstream = streams.find((x) => x.Type === 'Video');
  const srcFps = vstream?.RealFrameRate || vstream?.AverageFrameRate || 0;
  const fpsShow = fps || srcFps;
  const intro = useMemo(() => {
    const ch = item?.Chapters || [];
    const a = ch.find((c) => c.MarkerType === 'IntroStart');
    const b = ch.find((c) => c.MarkerType === 'IntroEnd');
    if (!a || !b) return null;
    const st = ticksToSec(a.StartPositionTicks), en = ticksToSec(b.StartPositionTicks);
    return en > st ? { st, en } : null;
  }, [item]);

  // ───────── 进度回报 ─────────
  const report = useCallback((kind: 'start' | 'progress' | 'stop') => {
    const p = playRef.current;
    if (!p) return;
    const b = {
      itemId: id,
      mediaSourceId: p.source.Id,
      playSessionId: p.playSessionId,
      positionSec: posRef.current,
      paused: pausedRef.current,
      method: 'DirectPlay' as const,
    };
    if (kind === 'start') void emby.reportStart(b);
    else if (kind === 'progress') void emby.reportProgress(b);
    else void emby.reportStop(b);
  }, [id]);

  // ───────── mpv 属性回调 ─────────
  const onProp = useCallback((name: string, data: unknown) => {
    switch (name) {
      case 'pause': pausedRef.current = !!data; setPaused(!!data); if (data) report('progress'); break;
      case 'time-pos': if (typeof data === 'number') { posRef.current = data; setCur(data); setBusy(false); } break;
      case 'duration':
        if (typeof data === 'number') {
          setDur(data);
          const p = pendingSub.current;
          if (p) {
            pendingSub.current = null;
            void pickSubRef.current(p, true);
          }
        }
        break;
      case 'container-fps': setFps(typeof data === 'number' ? data : 0); break;
      case 'video-bitrate': setVbr(typeof data === 'number' ? data : 0); break;
      case 'demuxer-cache-time': if (typeof data === 'number') setBuffered(data); break;
      case 'paused-for-cache': setCaching(!!data); break;
      case 'speed': if (typeof data === 'number') setRate(data); break;
      case 'volume': if (typeof data === 'number') setVol(data); break;
      case 'mute': setMuted(!!data); break;
      case 'aid': setAid(typeof data === 'number' ? data : null); break;
      case 'sid': setSid(typeof data === 'number' ? data : null); break;
      case 'hwdec-current': setHw(typeof data === 'string' ? data : ''); break;
      case 'eof-reached':
        if (data === true && !endedRef.current) {
          endedRef.current = true;
          report('stop');
          const n = nextRef.current;
          if (loadPlayPrefs().autoNext && n) nav(`/player/${n.Id}`, { replace: true });
          else setUiShown(true);
        }
        break;
      default: break;
    }
  }, [nav, report]);
  const pickSubRef = useRef<(s: MediaStream | null, silent?: boolean) => Promise<void>>(async () => undefined);
  const onPropRef = useRef(onProp);
  onPropRef.current = onProp;

  // ───────── 起播 ─────────
  useEffect(() => {
    if (!item) return;
    const src = item.MediaSources?.find((m) => m.Id === wantSrc) || item.MediaSources?.[0];
    if (!src) {
      onFail('这个条目没有可播放的媒体源');
      return;
    }
    let dead = false;
    endedRef.current = false;
    document.documentElement.classList.add('mpv-on'); // 页面背景透明，让底下的 mpv 画面透出来
    (async () => {
      try {
        const info = await emby.playbackInfo(id, { deviceProfile: DIRECT_ALL_PROFILE });
        if (dead) return;
        const psrc = info.MediaSources?.find((s) => s.Id === src.Id) || info.MediaSources?.[0] || src;
        playRef.current = { source: { ...psrc, MediaStreams: psrc.MediaStreams || src.MediaStreams }, playSessionId: info.PlaySessionId };
        const resume = ticksToSec(item.UserData?.PlaybackPositionTicks);
        const total = ticksToSec(item.RunTimeTicks);
        const startSec = total && resume > total * 0.95 ? 0 : resume;
        const sess = await openMpv({ hdr: loadPlayPrefs().hdr, onProp: (n, d) => onPropRef.current(n, d) });
        if (dead) {
          await sess.close();
          return;
        }
        sessRef.current = sess;
        await sess.set('volume', Math.round(loadPlayPrefs().volume * 100));
        const mst = psrc.MediaStreams || src.MediaStreams || [];
        const pick = pickInitialTracks(id, mst, loadPlayPrefs(), {
          audio: qs.get('aud') ? Number(qs.get('aud')) : undefined,
          sub: qs.get('sub') ? Number(qs.get('sub')) : undefined,
        });
        const opts: Record<string, string> = {};
        if (startSec > 1) opts.start = startSec.toFixed(1);
        const aList = mst.filter((x) => x.Type === 'Audio');
        const eList = mst.filter((x) => x.Type === 'Subtitle' && !x.IsExternal);
        if (pick.audio != null) {
          const ai = aList.findIndex((x) => x.Index === pick.audio);
          if (ai >= 0) opts.aid = String(ai + 1);
        }
        if (pick.sub === -1) opts.sid = 'no';
        else if (pick.sub != null) {
          const ei = eList.findIndex((x) => x.Index === pick.sub);
          if (ei >= 0) opts.sid = String(ei + 1);
          else pendingSub.current = mst.find((x) => x.Index === pick.sub) || null; // 外挂字幕：载入后再挂
        }
        await sess.loadfile(directStreamUrl(id, psrc, info.PlaySessionId), opts);
        if (loadPlayPrefs().autoSkipIntro) autoSkipArmed.current = true;
        report('start');
      } catch (e) {
        if (!dead) onFail(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      dead = true;
      report('stop');
      const s = sessRef.current;
      sessRef.current = null;
      void s?.close();
      document.documentElement.classList.remove('mpv-on');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.Id]);

  // 每 10 秒回报进度
  useEffect(() => {
    const t = setInterval(() => {
      if (!pausedRef.current) report('progress');
    }, 10000);
    return () => clearInterval(t);
  }, [report]);

  const inIntro = !!intro && cur >= intro.st - 0.5 && cur < intro.en - 1;
  useEffect(() => {
    if (inIntro && intro && autoSkipArmed.current) {
      autoSkipArmed.current = false; // 每部片只自动跳一次，之后想回看不会被再次弹走
      void sessRef.current?.cmd('seek', [String(intro.en), 'absolute']);
    }
  }, [inIntro, intro]);

  // ───────── 操作 ─────────
  const toggle = useCallback(() => {
    void sessRef.current?.cmd('cycle', ['pause']);
  }, []);
  const seekBy = useCallback((d: number) => {
    void sessRef.current?.cmd('seek', [String(d), 'relative']);
  }, []);
  const seekTo = (sec: number): void => {
    void sessRef.current?.cmd('seek', [String(sec), 'absolute']);
    report('progress');
  };
  const setVolume = useCallback((v: number) => {
    const c = Math.max(0, Math.min(100, v));
    void sessRef.current?.set('volume', Math.round(c));
    savePlayPrefs({ volume: c / 100 });
  }, []);
  const toggleFull = useCallback(async () => {
    const next = !(await winIsFullscreen());
    await winSetFullscreen(next);
    setFull(next);
  }, []);
  const exit = useCallback(async () => {
    if (await winIsFullscreen()) {
      await winSetFullscreen(false);
      setFull(false);
    }
    if (window.history.length > 1) nav(-1);
    else nav('/', { replace: true });
  }, [nav]);
  const goNext = useCallback(() => {
    if (nextRef.current) nav(`/player/${nextRef.current.Id}`, { replace: true });
  }, [nav]);

  const pickAudio = (i: number): void => {
    setMenu('');
    void sessRef.current?.set('aid', i + 1);
    if (loadPlayPrefs().rememberTracks && audios[i]) setTrackMemory(id, { audio: audios[i].Index });
  };

  const pickSub = async (s: MediaStream | null, silent = false): Promise<void> => {
    setMenu('');
    const sess = sessRef.current;
    if (!sess) return;
    if (!silent && loadPlayPrefs().rememberTracks) setTrackMemory(id, { sub: s ? s.Index : -1 });
    if (!s) {
      await sess.set('sid', 'no');
      return;
    }
    const e = embSubs.indexOf(s);
    if (e >= 0) {
      await sess.set('sid', e + 1);
      return;
    }
    // 外挂字幕：第一次选择时从 Emby 取回并挂到 mpv
    const known = extSid.current.get(s.Index);
    if (known) {
      await sess.set('sid', known);
      return;
    }
    const p = playRef.current;
    if (!p) return;
    const ext = s.Codec === 'ass' || s.Codec === 'ssa' ? 'ass' : 'srt';
    await sess.cmd('sub-add', [subtitleUrl(id, p.source.Id, s.Index, ext), 'select', subLabel(s), s.Language || '']);
    const now = Number(await sess.get('sid', 'int64'));
    if (Number.isFinite(now)) extSid.current.set(s.Index, now);
  };

  pickSubRef.current = pickSub;

  const setSpeed = (r: number): void => {
    setMenu('');
    void sessRef.current?.set('speed', r);
  };

  // 当前选中的字幕（用来高亮菜单）
  const curSub: MediaStream | null = useMemo(() => {
    if (!sid) return null;
    const emb = embSubs[sid - 1];
    if (emb && sid <= embSubs.length) return emb;
    for (const [idx, v] of extSid.current) if (v === sid) return extSubs.find((x) => x.Index === idx) || null;
    return null;
  }, [sid, embSubs, extSubs]);

  // ───────── 控制条自动隐藏 + 快捷键 ─────────
  const poke = useCallback(() => {
    setUiShown(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!pausedRef.current) setUiShown(false);
    }, 3000);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
      switch (e.key) {
        case ' ': e.preventDefault(); toggle(); break;
        case 'ArrowLeft': e.preventDefault(); seekBy(e.shiftKey ? -30 : -10); break;
        case 'ArrowRight': e.preventDefault(); seekBy(e.shiftKey ? 30 : 10); break;
        case 'ArrowUp': e.preventDefault(); setVolume(vol + 5); break;
        case 'ArrowDown': e.preventDefault(); setVolume(vol - 5); break;
        case 'f': case 'F': void toggleFull(); break;
        case 'm': case 'M': void sessRef.current?.cmd('cycle', ['mute']); break;
        case 'n': case 'N': goNext(); break;
        case 'i': case 'I': setDrawer((v) => !v); break;
        case 'Escape': if (drawer) setDrawer(false); else void exit(); break;
        default: return;
      }
      poke();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, seekBy, setVolume, vol, toggleFull, goNext, exit, poke, drawer]);

  // ───────── 渲染 ─────────
  const title = item
    ? item.Type === 'Episode'
      ? `${item.SeriesName || ''}  S${item.ParentIndexNumber ?? 1}E${item.IndexNumber ?? 1} · ${item.Name}`
      : item.Name
    : '';
  const total = dur || ticksToSec(item?.RunTimeTicks);
  const pct = total > 0 ? (cur / total) * 100 : 0;
  const bufPct = total > 0 ? (buffered / total) * 100 : 0;
  const showUi = uiShown || paused || drawer || !!menu;

  return (
    <div className={`we-player mpv${showUi ? '' : ' hide-ui'}`} onMouseMove={poke} onClick={() => menu && setMenu('')}>
      {/* 透明点击层：mpv 画面在它下面的原生窗口里 */}
      <div className="we-surface" onClick={(e) => { e.stopPropagation(); if (menu) setMenu(''); else toggle(); }} onDoubleClick={() => void toggleFull()} />

      {(busy || caching) && !err && <div className="we-loading"><span className="spinner" aria-hidden="true" />{busy ? '正在加载…' : '缓冲中…'}</div>}
      {err && <div className="we-error">{err}</div>}

      <div className="we-top">
        <button className="we-btn we-back" title="返回（Esc）" onClick={(e) => { e.stopPropagation(); void exit(); }}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M15.5 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>返回</span>
        </button>
        <div className="we-title" title={title}>{title}</div>
        {vstream?.Width && vstream?.Height ? <span className="we-badge" title="分辨率">{vstream.Width}×{vstream.Height}</span> : null}
        {badge && <span className="we-badge" title="画面">{badge}</span>}
        {vstream?.Codec && <span className="we-badge" title="视频编码">{vstream.Codec.toUpperCase()}</span>}
        {fpsShow > 0 && <span className="we-badge we-badge-hi" title="帧率">{Number(fpsShow.toFixed(3))} fps</span>}
        {vbr > 0 && <span className="we-badge" title="当前视频码率">{(vbr / 1e6).toFixed(1)} Mbps</span>}
        <span className="we-badge" title="播放内核">MPV{hw && hw !== 'no' ? ` · ${hw}` : ''}</span>
        <button className="we-btn we-txt" title="简介 / 演职员 / 选集（I）" onClick={(e) => { e.stopPropagation(); setDrawer((v) => !v); }}>
          {drawer ? '收起信息' : '信息'}
        </button>
        {!full && (
          <div className="we-winbtns">
            <button className="we-btn" title="最小化" onClick={(e) => { e.stopPropagation(); void winMinimize(); }}>
              <svg width="12" height="12" viewBox="0 0 16 16"><line x1="3.5" y1="8" x2="12.5" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
            <button className="we-btn" title="最大化" onClick={(e) => { e.stopPropagation(); void winToggleMax(); }}>
              <svg width="12" height="12" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
            <button className="we-btn" title="关闭" onClick={(e) => { e.stopPropagation(); void winClose(); }}>
              <svg width="12" height="12" viewBox="0 0 16 16"><line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          </div>
        )}
      </div>

      {drawer && (
        <PlayerDrawer
          item={item}
          episodes={episodes}
          currentId={id}
          onClose={() => setDrawer(false)}
          onPickEpisode={(e) => nav(`/player/${e.Id}`, { replace: true })}
        />
      )}

      {inIntro && intro && (
        <button className={`we-skip${showUi ? ' up' : ''}`} onClick={(e) => { e.stopPropagation(); void sessRef.current?.cmd('seek', [String(intro.en), 'absolute']); }}>
          跳过片头 ›
        </button>
      )}
      {!showUi && <div className="we-thin"><div style={{ width: `${pct}%` }} /></div>}

      <div className="we-bottom" onClick={(e) => e.stopPropagation()}>
        <div
          className="we-seek"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (total > 0) seekTo(((e.clientX - r.left) / r.width) * total);
          }}
        >
          <div className="we-seek-buf" style={{ width: `${bufPct}%` }} />
          <div className="we-seek-cur" style={{ width: `${pct}%` }} />
          <div className="we-seek-dot" style={{ left: `${pct}%` }} />
        </div>
        <div className="we-ctrls">
          <button className="we-btn" title="播放/暂停（空格）" onClick={toggle}>
            {paused ? (
              <svg width="20" height="20" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" /></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor" /></svg>
            )}
          </button>
          <button className="we-btn we-txt" title="后退 10 秒" onClick={() => seekBy(-10)}>-10s</button>
          <button className="we-btn we-txt" title="快进 10 秒" onClick={() => seekBy(10)}>+10s</button>
          {nextEp && (
            <button className="we-btn" title="下一集（N）" onClick={goNext}>
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M6 5v14l9-7-9-7Zm10 0h2.5v14H16z" fill="currentColor" /></svg>
            </button>
          )}
          <span className="we-time">{fmtDuration(cur)} / {fmtDuration(total)}</span>
          <span style={{ flex: 1 }} />
          <div className="we-volgrp" title="鼠标滚轮调节音量" onWheel={(e) => { setVolume(vol + (e.deltaY < 0 ? 5 : -5)); void sessRef.current?.set('mute', 'no'); poke(); }}>
          <button className="we-btn" title="静音（M）" onClick={() => void sessRef.current?.cmd('cycle', ['mute'])}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" />
              {muted || vol === 0 ? <path d="M16 9l5 6M21 9l-5 6" /> : <path d="M16 9a4.5 4.5 0 0 1 0 6" />}
            </svg>
          </button>
          <input className="we-vol" type="range" min={0} max={100} step={1} value={muted ? 0 : vol} aria-label="音量" onChange={(e) => { void sessRef.current?.set('mute', 'no'); setVolume(Number(e.target.value)); }} />
          <span className="we-volnum">{muted ? '静音' : Math.round(vol)}</span>
          </div>

          {episodes.length > 1 && (
            <div className="we-menu-wrap">
              <button className="we-btn we-txt" title="选集" onClick={() => setMenu(menu === 'eps' ? '' : 'eps')}>选集</button>
              {menu === 'eps' && (
                <div className="we-menu we-menu-eps">
                  <div className="we-menu-head">{item?.SeasonName || item?.SeriesName || '选集'}</div>
                  {episodes.map((e) => (
                    <div
                      key={e.Id}
                      ref={e.Id === id ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}
                      className={`we-menu-item${e.Id === id ? ' active' : ''}`}
                      onClick={() => { setMenu(''); if (e.Id !== id) nav(`/player/${e.Id}`, { replace: true }); }}
                    >
                      {`S${e.ParentIndexNumber ?? 1}E${e.IndexNumber ?? 0} · ${e.Name}`}{e.Id === id ? '（正在播放）' : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="we-menu-wrap">
            <button className="we-btn we-txt" onClick={() => setMenu(menu === 'speed' ? '' : 'speed')}>{rate === 1 ? '倍速' : `${rate}x`}</button>
            {menu === 'speed' && (
              <div className="we-menu">
                {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((r) => (
                  <div key={r} className={`we-menu-item${r === rate ? ' active' : ''}`} onClick={() => setSpeed(r)}>{r}x</div>
                ))}
              </div>
            )}
          </div>

          {audios.length > 0 && (
            <div className="we-menu-wrap">
              <button className="we-btn we-txt" onClick={() => setMenu(menu === 'audio' ? '' : 'audio')}>音轨</button>
              {menu === 'audio' && (
                <div className="we-menu">
                  {audios.map((a, i) => (
                    <div key={a.Index} className={`we-menu-item${aid === i + 1 ? ' active' : ''}`} onClick={() => pickAudio(i)}>{audioLabel(a)}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="we-menu-wrap">
            <button className="we-btn we-txt" onClick={() => setMenu(menu === 'sub' ? '' : 'sub')}>字幕{sid ? ' ●' : ''}</button>
            {menu === 'sub' && (
              <div className="we-menu">
                <div className={`we-menu-item${!sid ? ' active' : ''}`} onClick={() => void pickSub(null)}>关闭</div>
                {embSubs.map((s) => (
                  <div key={s.Index} className={`we-menu-item${curSub === s ? ' active' : ''}`} onClick={() => void pickSub(s)}>{subLabel(s)}</div>
                ))}
                {extSubs.map((s) => (
                  <div key={s.Index} className={`we-menu-item${curSub === s ? ' active' : ''}`} onClick={() => void pickSub(s)}>{subLabel(s)}（外挂）</div>
                ))}
                {embSubs.length + extSubs.length === 0 && <div className="we-menu-item" style={{ opacity: 0.6 }}>没有字幕轨</div>}
              </div>
            )}
          </div>

          <button className="we-btn" title="全屏（F）" onClick={() => void toggleFull()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {full ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
