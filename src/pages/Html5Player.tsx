// 播放页：HTML5 <video> + hls.js。
// 播放决策交给 Emby（DeviceProfile）：能直连就直连原文件；否则服务器转封装 / 转码成 HLS。
// 进度双向同步：开始时从 Emby 续播位置起播，播放中每 10 秒回报，退出 / 切集时回报停止。
import Hls from 'hls.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { absUrl, directStreamUrl, emby, subtitleUrl } from '../emby/client';
import { fmtDuration, ticksToSec } from '../emby/format';
import { httpFetch } from '../emby/http';
import { TauriLoader } from '../emby/hlsLoader';
import { buildDeviceProfile } from '../emby/profile';
import type { EmbyItem, MediaSource, MediaStream } from '../emby/types';
import { loadPlayPrefs, savePlayPrefs } from '../lib/prefs';
import { winClose, winIsFullscreen, winMinimize, winSetFullscreen, winToggleMax } from '../lib/win';

type Method = 'DirectPlay' | 'DirectStream' | 'Transcode';

interface Decision {
  url: string;
  hls: boolean;
  method: Method;
  source: MediaSource;
  playSessionId?: string;
}

/** 把 Emby 的 SRT/VTT 字幕取回来转成 blob，避免 <track> 的跨域限制 */
async function vttBlobUrl(itemId: string, sourceId: string, index: number): Promise<string> {
  const res = await httpFetch(subtitleUrl(itemId, sourceId, index));
  if (!res.ok) throw new Error(`字幕下载失败 ${res.status}`);
  const text = await res.text();
  return URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
}

const subLabel = (s: MediaStream): string =>
  s.DisplayTitle || [s.Language, s.Codec?.toUpperCase()].filter(Boolean).join(' · ') || `字幕 ${s.Index}`;
const audioLabel = (s: MediaStream): string =>
  s.DisplayTitle || [s.Language, s.Codec?.toUpperCase(), s.Channels ? `${s.Channels}ch` : ''].filter(Boolean).join(' · ') || `音轨 ${s.Index}`;

export default function Html5Player({ notice }: { notice?: string }) {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const blobUrls = useRef<string[]>([]);
  const decisionRef = useRef<Decision | null>(null);
  const trackRef = useRef<{ audio?: number; sub?: number }>({});
  const hideTimer = useRef<number | null>(null);
  const startSeq = useRef(0);

  const [item, setItem] = useState<EmbyItem | null>(null);
  const [nextEp, setNextEp] = useState<EmbyItem | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);
  const [prefs, setPrefs] = useState(loadPlayPrefs);
  const [paused, setPaused] = useState(true);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [vol, setVol] = useState(prefs.volume);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [full, setFull] = useState(false);
  const [uiShown, setUiShown] = useState(true);
  const [menu, setMenu] = useState<'' | 'audio' | 'sub' | 'speed' | 'quality'>('');
  const [audioIdx, setAudioIdx] = useState<number | undefined>();
  const [subIdx, setSubIdx] = useState(-1);
  const [burned, setBurned] = useState(false);

  const source = decision?.source;
  const audios = useMemo(() => (source?.MediaStreams || []).filter((s) => s.Type === 'Audio'), [source]);
  const subs = useMemo(() => (source?.MediaStreams || []).filter((s) => s.Type === 'Subtitle'), [source]);

  // ───────────── 进度回报 ─────────────
  const report = useCallback((kind: 'start' | 'progress' | 'stop') => {
    const d = decisionRef.current;
    const v = videoRef.current;
    if (!d || !v) return;
    const b = {
      itemId: id,
      mediaSourceId: d.source.Id,
      playSessionId: d.playSessionId,
      positionSec: v.currentTime || 0,
      paused: v.paused,
      method: d.method,
      audioIndex: trackRef.current.audio,
      subtitleIndex: trackRef.current.sub != null && trackRef.current.sub >= 0 ? trackRef.current.sub : undefined,
    };
    if (kind === 'start') void emby.reportStart(b);
    else if (kind === 'progress') void emby.reportProgress(b);
    else void emby.reportStop(b);
  }, [id]);

  // ───────────── 清理 ─────────────
  const teardown = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const v = videoRef.current;
    if (v) {
      v.removeAttribute('src');
      v.querySelectorAll('track').forEach((t) => t.remove());
      v.load();
    }
    blobUrls.current.forEach((u) => URL.revokeObjectURL(u));
    blobUrls.current = [];
  }, []);

  // ───────────── 起播 ─────────────
  const start = useCallback(
    async (opts: { startSec: number; audio?: number; sub?: number; sourceId?: string }) => {
      const my = ++startSeq.current;
      setBusy(true);
      setErr('');
      try {
        const p = loadPlayPrefs();
        const info = await emby.playbackInfo(id, {
          deviceProfile: buildDeviceProfile(p),
          maxBitrate: p.maxMbps > 0 ? p.maxMbps * 1_000_000 : undefined,
          mediaSourceId: opts.sourceId,
          audioIndex: opts.audio,
          subtitleIndex: opts.sub != null && opts.sub >= 0 ? opts.sub : undefined,
        });
        if (my !== startSeq.current) return; // 已被新的起播请求取代（切集 / StrictMode 重复挂载）
        const src = info.MediaSources?.[0];
        if (!src) throw new Error('服务器没有返回可播放的媒体源');
        let d: Decision;
        if (src.SupportsDirectPlay && !(opts.audio != null && opts.audio !== src.DefaultAudioStreamIndex) && !(opts.sub != null && opts.sub >= 0 && burnNeeded(src, opts.sub))) {
          d = { url: directStreamUrl(id, src, info.PlaySessionId), hls: false, method: 'DirectPlay', source: src, playSessionId: info.PlaySessionId };
        } else if (src.TranscodingUrl) {
          const url = absUrl(src.TranscodingUrl);
          d = { url, hls: /\.m3u8/i.test(url) || src.TranscodingSubProtocol === 'hls', method: src.SupportsDirectStream ? 'DirectStream' : 'Transcode', source: src, playSessionId: info.PlaySessionId };
        } else if (src.SupportsDirectStream && src.DirectStreamUrl) {
          d = { url: absUrl(src.DirectStreamUrl), hls: false, method: 'DirectStream', source: src, playSessionId: info.PlaySessionId };
        } else if (src.SupportsDirectPlay) {
          d = { url: directStreamUrl(id, src, info.PlaySessionId), hls: false, method: 'DirectPlay', source: src, playSessionId: info.PlaySessionId };
        } else {
          throw new Error('服务器无法为此片源转码（检查 Emby 的转码设置 / ffmpeg 是否可用）');
        }

        teardown();
        decisionRef.current = d;
        trackRef.current = { audio: opts.audio ?? src.DefaultAudioStreamIndex, sub: opts.sub ?? -1 };
        setDecision(d);
        setAudioIdx(trackRef.current.audio);
        setSubIdx(opts.sub ?? -1);
        setBurned(opts.sub != null && opts.sub >= 0 && burnNeeded(src, opts.sub));

        const v = videoRef.current;
        if (!v) return;
        v.volume = p.volume;
        const begin = (): void => {
          if (opts.startSec > 1 && !d.hls) v.currentTime = opts.startSec;
          void v.play().catch(() => undefined);
        };
        if (d.hls) {
          if (Hls.isSupported()) {
            const hls = new Hls({
              loader: TauriLoader as never,
              startPosition: opts.startSec > 1 ? opts.startSec : -1,
              maxBufferLength: 60,
              enableWorker: true,
            });
            hlsRef.current = hls;
            hls.on(Hls.Events.ERROR, (_e, data) => {
              if (data.fatal) setErr(`播放出错：${data.details}`);
            });
            hls.loadSource(d.url);
            hls.attachMedia(v);
            hls.on(Hls.Events.MANIFEST_PARSED, () => void v.play().catch(() => undefined));
          } else {
            throw new Error('当前环境不支持 HLS 播放');
          }
        } else {
          v.src = d.url;
          v.addEventListener('loadedmetadata', begin, { once: true });
        }

        // 文本字幕：客户端挂载（图片字幕已在服务器烧录）
        if (opts.sub != null && opts.sub >= 0 && !burnNeeded(src, opts.sub)) {
          try {
            const blob = await vttBlobUrl(id, src.Id, opts.sub);
            blobUrls.current.push(blob);
            const tr = document.createElement('track');
            tr.kind = 'subtitles';
            tr.src = blob;
            tr.default = true;
            tr.label = 'sub';
            v.appendChild(tr);
            tr.track.mode = 'showing';
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          }
        }
        report('start');
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [id, report, teardown],
  );

  // ───────────── 载入影片 ─────────────
  useEffect(() => {
    let dead = false;
    setItem(null);
    setNextEp(null);
    setDecision(null);
    decisionRef.current = null;
    emby
      .item(id)
      .then(async (it) => {
        if (dead) return;
        setItem(it);
        const resume = ticksToSec(it.UserData?.PlaybackPositionTicks);
        // 看完一半以上才续播；几乎看完就从头
        const startSec = it.RunTimeTicks && resume > ticksToSec(it.RunTimeTicks) * 0.95 ? 0 : resume;
        void start({ startSec });
        if (it.Type === 'Episode' && it.SeriesId) {
          const all = await emby.episodes(it.SeriesId).catch(() => [] as EmbyItem[]);
          const i = all.findIndex((e) => e.Id === it.Id);
          if (!dead && i >= 0 && all[i + 1]) setNextEp(all[i + 1]);
        }
      })
      .catch((e: unknown) => {
        if (!dead) {
          setErr(e instanceof Error ? e.message : String(e));
          setBusy(false);
        }
      });
    return () => {
      dead = true;
      startSeq.current++;
      report('stop');
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 每 10 秒回报一次进度
  useEffect(() => {
    const t = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) report('progress');
    }, 10000);
    return () => clearInterval(t);
  }, [report]);

  // ───────────── 操作 ─────────────
  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);

  const seekBy = useCallback((d: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, Math.min((v.duration || 1e9) - 1, v.currentTime + d));
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
    if (nextEp) nav(`/player/${nextEp.Id}`, { replace: true });
  }, [nav, nextEp]);

  const restartAt = (o: { audio?: number; sub?: number }): void => {
    const t = videoRef.current?.currentTime || 0;
    report('stop');
    void start({ startSec: t, audio: o.audio ?? trackRef.current.audio, sub: o.sub ?? trackRef.current.sub, sourceId: decisionRef.current?.source.Id });
  };

  const pickAudio = (idx: number): void => {
    setMenu('');
    if (idx !== trackRef.current.audio) restartAt({ audio: idx });
  };

  const pickSub = (idx: number): void => {
    setMenu('');
    const src = decisionRef.current?.source;
    if (!src) return;
    const needBurn = idx >= 0 && burnNeeded(src, idx);
    // 当前是烧录字幕、或要切到需烧录的字幕 → 重新请求；否则只切客户端字幕轨
    if (needBurn || burned) {
      restartAt({ sub: idx });
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    v.querySelectorAll('track').forEach((t) => t.remove());
    trackRef.current.sub = idx;
    setSubIdx(idx);
    if (idx < 0) return;
    void vttBlobUrl(id, src.Id, idx)
      .then((blob) => {
        blobUrls.current.push(blob);
        const tr = document.createElement('track');
        tr.kind = 'subtitles';
        tr.src = blob;
        tr.default = true;
        v.appendChild(tr);
        tr.track.mode = 'showing';
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  };

  const setQuality = (mbps: number): void => {
    setMenu('');
    setPrefs(savePlayPrefs({ maxMbps: mbps }));
    restartAt({});
  };

  // ───────────── 控制条自动隐藏 + 快捷键 ─────────────
  const poke = useCallback(() => {
    setUiShown(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setUiShown(false);
    }, 3000);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
      const v = videoRef.current;
      switch (e.key) {
        case ' ': e.preventDefault(); toggle(); break;
        case 'ArrowLeft': e.preventDefault(); seekBy(e.shiftKey ? -30 : -10); break;
        case 'ArrowRight': e.preventDefault(); seekBy(e.shiftKey ? 30 : 10); break;
        case 'ArrowUp': e.preventDefault(); if (v) { v.volume = Math.min(1, v.volume + 0.05); } break;
        case 'ArrowDown': e.preventDefault(); if (v) { v.volume = Math.max(0, v.volume - 0.05); } break;
        case 'f': case 'F': void toggleFull(); break;
        case 'm': case 'M': if (v) v.muted = !v.muted; break;
        case 'n': case 'N': goNext(); break;
        case 'Escape': void exit(); break;
        case 'Backspace': break;
        default: return;
      }
      poke();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, seekBy, toggleFull, exit, goNext, poke]);

  // ───────────── 渲染 ─────────────
  const title = item
    ? item.Type === 'Episode'
      ? `${item.SeriesName || ''}  S${item.ParentIndexNumber ?? 1}E${item.IndexNumber ?? 1} · ${item.Name}`
      : item.Name
    : '';
  const pct = dur > 0 ? (cur / dur) * 100 : 0;
  const bufPct = dur > 0 ? (buffered / dur) * 100 : 0;
  const mbpsOpts = [0, 40, 20, 10, 8, 4, 2];

  return (
    <div className={`we-player${uiShown || paused ? '' : ' hide-ui'}`} ref={wrapRef} onMouseMove={poke} onClick={() => menu && setMenu('')}>
      <video
        ref={videoRef}
        className="we-video"
        playsInline
        onClick={(e) => { e.stopPropagation(); if (menu) setMenu(''); else toggle(); }}
        onDoubleClick={() => void toggleFull()}
        onPlay={() => setPaused(false)}
        onPause={() => { setPaused(true); report('progress'); }}
        onWaiting={() => setBusy(true)}
        onPlaying={() => setBusy(false)}
        onCanPlay={() => setBusy(false)}
        onSeeked={() => report('progress')}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDur(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : ticksToSec(item?.RunTimeTicks))}
        onProgress={(e) => {
          const b = e.currentTarget.buffered;
          if (b.length) setBuffered(b.end(b.length - 1));
        }}
        onVolumeChange={(e) => {
          setVol(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
          savePlayPrefs({ volume: e.currentTarget.volume });
        }}
        onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
        onEnded={() => {
          report('stop');
          if (loadPlayPrefs().autoNext && nextEp) goNext();
          else setUiShown(true);
        }}
        onError={() => {
          const v = videoRef.current;
          if (v?.error && decisionRef.current?.method === 'DirectPlay') setErr(`原文件无法直接播放（${v.error.message || v.error.code}），可在右下角降低画质上限让服务器转码`);
        }}
      />

      {notice && <div className="we-notice">{notice}</div>}
      {busy && !err && <div className="we-loading"><span className="spinner" aria-hidden="true" />{decision ? '缓冲中…' : '正在准备播放…'}</div>}
      {err && (
        <div className="we-error">
          <div>{err}</div>
          <div className="row" style={{ justifyContent: 'center', marginTop: 10, gap: 8 }}>
            <button onClick={() => restartAt({})}>重试</button>
            <button onClick={() => void exit()}>返回</button>
          </div>
        </div>
      )}

      <div className="we-top">
        <button className="we-btn" title="返回（Esc）" onClick={(e) => { e.stopPropagation(); void exit(); }}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M15.5 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="we-title" title={title}>{title}</div>
        {decision && (
          <span className="we-badge" title="播放方式">
            {decision.method === 'DirectPlay' ? '直连' : decision.method === 'DirectStream' ? '转封装' : '转码'}
            {decision.source.Container ? ` · ${decision.source.Container.split(',')[0].toUpperCase()}` : ''}
          </span>
        )}
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

      <div className="we-bottom" onClick={(e) => e.stopPropagation()}>
        <div
          className="we-seek"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const v = videoRef.current;
            if (v && dur > 0) v.currentTime = ((e.clientX - r.left) / r.width) * dur;
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
          {nextEp && (
            <button className="we-btn" title="下一集（N）" onClick={goNext}>
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M6 5v14l9-7-9-7Zm10 0h2.5v14H16z" fill="currentColor" /></svg>
            </button>
          )}
          <span className="we-time">{fmtDuration(cur)} / {fmtDuration(dur)}</span>
          <span style={{ flex: 1 }} />
          <button className="we-btn" title="静音（M）" onClick={() => { if (videoRef.current) videoRef.current.muted = !muted; }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" />
              {muted || vol === 0 ? <path d="M16 9l5 6M21 9l-5 6" /> : <path d="M16 9a4.5 4.5 0 0 1 0 6" />}
            </svg>
          </button>
          <input
            className="we-vol"
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={muted ? 0 : vol}
            aria-label="音量"
            onChange={(e) => {
              const v = videoRef.current;
              if (!v) return;
              v.muted = false;
              v.volume = Number(e.target.value);
            }}
          />
          <div className="we-menu-wrap">
            <button className="we-btn we-txt" onClick={() => setMenu(menu === 'speed' ? '' : 'speed')}>{rate === 1 ? '倍速' : `${rate}x`}</button>
            {menu === 'speed' && (
              <div className="we-menu">
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                  <div key={r} className={`we-menu-item${r === rate ? ' active' : ''}`} onClick={() => { if (videoRef.current) videoRef.current.playbackRate = r; setMenu(''); }}>{r}x</div>
                ))}
              </div>
            )}
          </div>
          {audios.length > 1 && (
            <div className="we-menu-wrap">
              <button className="we-btn we-txt" onClick={() => setMenu(menu === 'audio' ? '' : 'audio')}>音轨</button>
              {menu === 'audio' && (
                <div className="we-menu">
                  {audios.map((a) => (
                    <div key={a.Index} className={`we-menu-item${a.Index === audioIdx ? ' active' : ''}`} onClick={() => pickAudio(a.Index)}>{audioLabel(a)}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {subs.length > 0 && (
            <div className="we-menu-wrap">
              <button className="we-btn we-txt" onClick={() => setMenu(menu === 'sub' ? '' : 'sub')}>字幕{subIdx >= 0 ? ' ●' : ''}</button>
              {menu === 'sub' && (
                <div className="we-menu">
                  <div className={`we-menu-item${subIdx < 0 ? ' active' : ''}`} onClick={() => pickSub(-1)}>关闭</div>
                  {subs.map((s) => (
                    <div key={s.Index} className={`we-menu-item${s.Index === subIdx ? ' active' : ''}`} onClick={() => pickSub(s.Index)}>
                      {subLabel(s)}{burnNeeded(source, s.Index) ? '（烧录）' : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="we-menu-wrap">
            <button className="we-btn we-txt" onClick={() => setMenu(menu === 'quality' ? '' : 'quality')}>{prefs.maxMbps ? `${prefs.maxMbps}M` : '画质'}</button>
            {menu === 'quality' && (
              <div className="we-menu">
                {mbpsOpts.map((m) => (
                  <div key={m} className={`we-menu-item${m === prefs.maxMbps ? ' active' : ''}`} onClick={() => setQuality(m)}>{m === 0 ? '原画（不限）' : `${m} Mbps`}</div>
                ))}
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

/** 图片字幕（PGS / VobSub / DVB）浏览器渲染不了，需要服务器烧录进画面 */
function burnNeeded(src: MediaSource | null | undefined, index: number): boolean {
  const s = src?.MediaStreams?.find((x) => x.Type === 'Subtitle' && x.Index === index);
  return !!s && s.IsTextSubtitleStream === false;
}
