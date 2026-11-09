// MPV 播放页：画面由内嵌的 libmpv 渲染（原生子窗口，支持 HDR10 / HLG / 杜比视界），
// 网页层背景透明，只画控制条与右侧信息抽屉。mpv 起不来时通知上层改用 HTML5 播放器。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PlayerDrawer from '../components/PlayerDrawer';
import { directStreamUrl, emby, posterUrl, subtitleUrl, thumbUrl } from '../emby/client';
import { fmtDuration, ticksToSec } from '../emby/format';
import type { EmbyItem, MediaSource, MediaStream } from '../emby/types';
import { openMpv, type MpvSession } from '../lib/mpv';
import { androidBridge, isIOS, isMobileApp } from '../lib/platform';
import { getManual, setManual } from '../lib/introManual';
import { syncSeriesMarkers } from '../lib/markerSync';
import DanmakuLayer from '../components/DanmakuLayer';
import { fetchDanmaku, loadDanmaku, saveDanmaku, type Dm } from '../lib/danmaku';
import { fetchIntroDb, introDbOn, type IntroInfo } from '../lib/introdb';
import { loadPlayPrefs, savePlayPrefs, setTrackMemory } from '../lib/prefs';
import { applySubStyle, loadSubStyle, saveSubStyle, SUB_DEFAULT, type SubStyle } from '../lib/substyle';
import { pickInitialTracks } from '../lib/tracks';
import { usePlayItem } from '../lib/usePlayItem';
import { winClose, winIsFullscreen, winMinimize, winOnClose, winSetFullscreen, winToggleMax } from '../lib/win';

/** 告诉 Emby「什么都能直接播」，只是为了拿到 PlaySessionId，真正的文件由 mpv 解码 */
const DIRECT_ALL_PROFILE = {
  Name: 'Weave MPV',
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
  const startedRef = useRef(false); // 已经收到真实播放位置（之前不回报，避免用 0 覆盖续播进度）
  const stoppedRef = useRef(false);
  const hoverUi = useRef(false);
  const hideTimer = useRef<number | null>(null);
  const extSid = useRef<Map<number, number>>(new Map());
  const nextRef = useRef<EmbyItem | null>(null);
  const exitRef = useRef<() => Promise<void>>(async () => {});
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
  const [menu, setMenu] = useState<'' | 'audio' | 'sub' | 'speed' | 'eps' | 'substyle' | 'sleep' | 'danmu' | 'intro'>('');
  const seekRef = useRef<HTMLDivElement | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubDrag = useRef(false);
  const scrubHold = useRef(0);
  // 松手后先保持在目标位置，等 mpv 的进度追上来（或 1.5 秒超时）再放开，避免滑块弹回旧位置
  const holdScrub = (t: number): void => {
    setScrub(t);
    window.clearTimeout(scrubHold.current);
    scrubHold.current = window.setTimeout(() => setScrub(null), 1500);
  };
  const [subStyle, setSubStyleState] = useState<SubStyle>(loadSubStyle);
  const [fps, setFps] = useState(0);
  const [dmCfg, setDmCfg] = useState(loadDanmaku);
  const [dmList, setDmList] = useState<Dm[]>([]);
  const [dmMsg, setDmMsg] = useState('');
  const [idb, setIdb] = useState<IntroInfo | null>(null);
  const synced = useRef(new Set<string>());
  const [manual, setManualS] = useState<{ st?: number; en?: number; tail?: number } | null>(null);
  const [introTip, setIntroTip] = useState('');
  const [clock, setClockNow] = useState(() => new Date());
  const [sleepWarn, setSleepWarn] = useState(false);
  useEffect(() => { const t = window.setInterval(() => setClockNow(new Date()), 15000); return () => window.clearInterval(t); }, []);

  const posAt = useRef(0);
  const rateRef = useRef(1);
  rateRef.current = rate;
  const updDm = (p: Partial<typeof dmCfg>): void => setDmCfg(saveDanmaku(p));
  // 定时关闭（手机）：sleepAt=到点时间戳；sleepEnd=播完本集/本部后退出
  const [sleepAt, setSleepAt] = useState(0);
  const [sleepEnd, setSleepEnd] = useState(false);
  const [sleepCustom, setSleepCustom] = useState('');
  useEffect(() => {
    setSleepWarn(false);
    if (!sleepAt) return;
    const t = window.setInterval(() => { const left = sleepAt - Date.now(); setSleepWarn(left > 0 && left <= 60000); }, 1000);
    return () => window.clearInterval(t);
  }, [sleepAt]);
  const sleepEndRef = useRef(false);
  sleepEndRef.current = sleepEnd;
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
    const mm = getManual(item?.SeriesId);
    if (mm && mm.en > mm.st) return mm; // 手动设置优先
    const ch = item?.Chapters || [];
    const a = ch.find((c) => c.MarkerType === 'IntroStart');
    const b = ch.find((c) => c.MarkerType === 'IntroEnd');
    if (a && b) {
      const st = ticksToSec(a.StartPositionTicks), en = ticksToSec(b.StartPositionTicks);
      if (en > st) return { st, en };
    }
    return idb?.intro || null; // Emby 没有片头标记 → 用 TheIntroDB
  }, [item, idb, manual]);

  // 本剧设置过片头/片尾规则：新增的集一播放就自动补写到 Emby（只补没有标记的集）
  useEffect(() => {
    if (!item || item.Type !== 'Episode' || !item.SeriesId) return;
    const mm = getManual(item.SeriesId);
    if (!mm || synced.current.has(item.SeriesId)) return;
    const ch = item.Chapters || [];
    if (ch.some((c) => c.MarkerType === 'IntroStart') && (mm.tail == null || ch.some((c) => c.MarkerType === 'CreditsStart'))) return;
    synced.current.add(item.SeriesId);
    syncSeriesMarkers(item.SeriesId, { st: mm.en > mm.st ? mm.st : undefined, en: mm.en > mm.st ? mm.en : undefined, tail: mm.tail, onlyMissing: true }).catch(() => undefined);
  }, [item]);

  // TheIntroDB 片头时间 + 弹幕：都按 TMDB 编号 / 片名匹配
  useEffect(() => {
    setIdb(null);
    setDmList([]);
    setDmMsg('');
    if (!item) return;
    let dead = false;
    const ep = item.Type === 'Episode';
    void (async () => {
      try {
        const tid = ep ? (item.SeriesId ? (await emby.item(item.SeriesId)).ProviderIds?.Tmdb : '') : item.ProviderIds?.Tmdb;
        if (tid && !dead && introDbOn()) { const r = await fetchIntroDb(tid, ep ? item.ParentIndexNumber ?? 1 : undefined, ep ? item.IndexNumber : undefined); if (!dead) setIdb(r); }
      } catch { /* 查不到就算了 */ }
    })();
    const c = loadDanmaku();
    if (c.url.trim()) {
      setDmMsg('弹幕加载中…');
      fetchDanmaku(c, ep ? item.SeriesName || item.Name : item.Name, ep ? item.IndexNumber : undefined, ep ? item.ParentIndexNumber : undefined)
        .then((l) => { if (!dead) { setDmList(l); setDmMsg(`${l.length} 条`); } })
        .catch((e: unknown) => { if (!dead) setDmMsg(e instanceof Error ? e.message : '弹幕加载失败'); });
    }
    return () => { dead = true; };
  }, [item]);

  // ───────── 进度回报 ─────────
  const report = useCallback((kind: 'start' | 'progress' | 'stop'): Promise<void> => {
    const p = playRef.current;
    if (!p) return Promise.resolve();
    if (kind !== 'start' && !startedRef.current) return Promise.resolve();
    if (kind === 'stop') {
      if (stoppedRef.current) return Promise.resolve();
      stoppedRef.current = true;
    }
    const b = {
      itemId: id,
      mediaSourceId: p.source.Id,
      playSessionId: p.playSessionId,
      positionSec: posRef.current,
      paused: pausedRef.current,
      method: 'DirectPlay' as const,
    };
    if (kind === 'start') return emby.reportStart(b);
    if (kind === 'progress') return emby.reportProgress(b);
    return emby.reportStop(b);
  }, [id]);

  // ───────── mpv 属性回调 ─────────
  const onProp = useCallback((name: string, data: unknown) => {
    switch (name) {
      case 'pause': pausedRef.current = !!data; setPaused(!!data); if (data) void report('progress'); break;
      case 'time-pos':
        if (typeof data === 'number') {
          posRef.current = data;
          posAt.current = performance.now();
          setCur(data);
          setBusy(false);
          if (!startedRef.current) {
            startedRef.current = true;
            void syncPauseRef.current(); // 初始 pause 事件可能没送达：起播后主动读一次
          }
        }
        break;
      case 'duration':
        if (typeof data === 'number') {
          setDur(data);
          void syncPauseRef.current();
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
          void report('stop');
          const n = nextRef.current;
          // 有下一集且开了自动连播 → 接着播；否则播完直接退出播放页（同时解除常亮，不会一直停在片尾）
          if (!sleepEndRef.current && loadPlayPrefs().autoNext && n) nav(`/player/${n.Id}`, { replace: true });
          else void exitRef.current();
        }
        break;
      default: break;
    }
  }, [nav, report]);
  // 稳定的 ref 回调：只在菜单刚打开时滚到当前集（内联函数每次渲染都会触发，导致滚动被拉回）
  const scrollToActive = useCallback((el: HTMLElement | null) => el?.scrollIntoView({ block: 'center' }), []);
  const syncPauseRef = useRef<() => Promise<void>>(async () => undefined);
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
    startedRef.current = false;
    stoppedRef.current = false;
    posRef.current = 0;
    playRef.current = null;
    pausedRef.current = false;
    setPaused(false);
    setBusy(true);
    setCur(0);
    document.documentElement.classList.add('mpv-on'); // 页面背景透明，让底下的 mpv 画面透出来
    (async () => {
      try {
        const info = await emby.playbackInfo(id, { deviceProfile: DIRECT_ALL_PROFILE });
        if (dead) return;
        const psrc = info.MediaSources?.find((s) => s.Id === src.Id) || info.MediaSources?.[0] || src;
        playRef.current = { source: { ...psrc, MediaStreams: psrc.MediaStreams || src.MediaStreams }, playSessionId: info.PlaySessionId };
        const resume = ticksToSec(item.UserData?.PlaybackPositionTicks);
        const total = ticksToSec(item.RunTimeTicks);
        const startSec = qs.get('from') === '0' ? 0 : total && resume > total * 0.95 ? 0 : resume;
        const sess = await openMpv({ hdr: loadPlayPrefs().hdr, onProp: (n, d) => onPropRef.current(n, d) });
        if (dead) {
          await sess.close();
          return;
        }
        sessRef.current = sess;
        syncPauseRef.current = async () => {
          try {
            const v = await sess.get('pause', 'flag');
            if (dead || sessRef.current !== sess || typeof v !== 'boolean') return;
            pausedRef.current = v;
            setPaused(v);
          } catch { /* ignore */ }
        };
        // 安卓：mpv 内部音量固定 100%，音量完全跟随手机的媒体音量（音量键 / 手势）
        await sess.set('volume', isMobileApp ? 100 : Math.round(loadPlayPrefs().volume * 100));
        await applySubStyle(sess, loadSubStyle());
        const mst = psrc.MediaStreams || src.MediaStreams || [];
        // 杜比视界 Profile 5（没有 HDR10 / SDR 兼容层）：硬解拿不到 RPU 元数据，画面会偏紫偏绿 → 改软解，交给 libplacebo 重塑
        if (isMobileApp) {
          const v = mst.find((x) => x.Type === 'Video');
          const tag = `${v?.VideoRangeType ?? ''} ${v?.ExtendedVideoSubType ?? ''} ${v?.ExtendedVideoSubTypeDescription ?? ''} ${v?.DvProfile ?? ''}`.toLowerCase();
          const p5 = /profile\s*5|doviprofile50|dovi50/.test(tag) || String(v?.VideoRangeType ?? '').toLowerCase() === 'dovi' || Number(v?.DvProfile) === 5;
          // iOS 用 VideoToolbox（先零拷贝，不行退到拷贝模式）；mediacodec 是安卓专用，iOS 上写它会变成 CPU 软解
          await sess.set('hwdec', isIOS ? 'videotoolbox,videotoolbox-copy' : p5 ? 'no' : 'mediacodec-copy');
        }
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
        void report('start');
        void syncPauseRef.current();
        poke();
      } catch (e) {
        if (!dead) onFail(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      dead = true;
      void report('stop');
      const s = sessRef.current;
      sessRef.current = null;
      void s?.close();
      document.documentElement.classList.remove('mpv-on');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.Id]);

  // 关窗口（✕ / Alt+F4 / 任务栏）前先把进度写回 Emby
  useEffect(() => {
    let un: (() => void) | null = null;
    let gone = false;
    void winOnClose(async () => {
      await Promise.race([report('stop'), new Promise((r) => setTimeout(r, 1500))]);
    }).then((f) => (gone ? f() : (un = f)));
    return () => {
      gone = true;
      un?.();
    };
  }, [report]);

  // 每 10 秒回报进度
  useEffect(() => {
    const t = setInterval(() => {
      if (!pausedRef.current) void report('progress');
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
    void sessRef.current?.cmd('cycle', ['pause']).then(() => syncPauseRef.current());
  }, []);
  const seekBy = useCallback((d: number) => {
    void sessRef.current?.cmd('seek', [String(d), 'relative']);
  }, []);
  const seekTo = (sec: number): void => {
    void sessRef.current?.cmd('seek', [String(sec), 'absolute']);
    void report('progress');
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
    await Promise.race([report('stop'), new Promise((r) => setTimeout(r, 1500))]); // 先把进度写回 Emby 再离开
    if (await winIsFullscreen()) {
      await winSetFullscreen(false);
      setFull(false);
    }
    if (window.history.length > 1) nav(-1);
    else nav('/', { replace: true });
  }, [nav, report]);
  exitRef.current = exit;
  useEffect(() => {
    if (!sleepAt) return;
    const t = window.setTimeout(() => { setSleepAt(0); void sessRef.current?.set('pause', 'yes'); void exitRef.current(); }, Math.max(0, sleepAt - Date.now()));
    return () => window.clearTimeout(t);
  }, [sleepAt]);
  const setSleepMin = (m: number): void => { setSleepEnd(false); setSleepAt(m > 0 ? Date.now() + m * 60000 : 0); setMenu(''); };
  const setSleepClock = (hhmm: string): boolean => {
    const m = /^(\d{1,2})[:：](\d{2})$/.exec(hhmm.trim());
    if (!m) return false;
    const d = new Date(); d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    setSleepEnd(false); setSleepAt(d.getTime()); setMenu('');
    return true;
  };
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

  const changeSubStyle = (patch: Partial<SubStyle>): void => {
    const next = { ...subStyle, ...patch };
    setSubStyleState(next);
    saveSubStyle(next);
    if (sessRef.current) void applySubStyle(sessRef.current, next);
  };

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
      if (!pausedRef.current && !hoverUi.current) setUiShown(false);
    }, 3000);
  }, []);

  // 暂停 ↔ 播放切换时重新计时：恢复播放后，不动鼠标 3 秒也会渐隐
  useEffect(() => {
    if (!paused) poke();
  }, [paused, poke]);
  useEffect(() => () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
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

  // ───────── 触屏手势（安卓）：单击显隐控制条 / 双击左右快进快退、中间暂停 / 横滑进度 / 右侧竖滑音量 / 左侧竖滑亮度 ─────────
  const [hud, setHud] = useState('');
  const hudTimer = useRef<number | null>(null);
  const showHud = (t: string): void => {
    setHud(t);
    if (hudTimer.current) window.clearTimeout(hudTimer.current);
    hudTimer.current = window.setTimeout(() => setHud(''), 900);
  };
  const tg = useRef<{ x: number; y: number; w: number; h: number; mode: '' | 'seek' | 'vol' | 'bri'; base: number; val: number } | null>(null);
  const lastTap = useRef(0);
  const tapTimer = useRef<number | null>(null);
  const tapAct = useRef<(x: number, w: number, dbl: boolean) => void>(() => undefined);
  tapAct.current = (x, w, dbl) => {
    if (menu) { setMenu(''); return; }
    if (dbl) {
      if (x < w / 3) { seekBy(-10); showHud('« 10 秒'); }
      else if (x > (w * 2) / 3) { seekBy(10); showHud('10 秒 »'); }
      else toggle();   // 中间区域双击：播放 / 暂停
      poke();
      return;
    }
    if (uiShown && !paused) {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      setUiShown(false);
    } else poke();
  };
  const onTouchStart = (e: React.TouchEvent): void => {
    const t = e.touches[0];
    const r = e.currentTarget.getBoundingClientRect();
    tg.current = { x: t.clientX, y: t.clientY, w: r.width, h: r.height, mode: '', base: 0, val: 0 };
  };
  const onTouchMove = (e: React.TouchEvent): void => {
    const g = tg.current;
    if (!g) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (!g.mode) {
      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)) { g.mode = 'seek'; g.base = cur; }
      else if (Math.abs(dy) > 14) {
        if (g.x < g.w / 2) { g.mode = 'bri'; g.base = androidBridge()?.getBrightness() ?? 0.5; }
        else { g.mode = 'vol'; g.base = (androidBridge()?.getSysVolume() ?? 0.5) * 100; }
      } else return;
    }
    if (g.mode === 'seek') {
      g.val = Math.max(0, g.base + (dx / g.w) * 150);
      if (total > 0) g.val = Math.min(total, g.val);   // 时长未知时不设上限，免得松手跳回 0
      showHud(`${fmtDuration(g.val)} / ${fmtDuration(total)}`);
    } else if (g.mode === 'vol') {
      g.val = Math.max(0, Math.min(100, g.base - (dy / g.h) * 130));
      androidBridge()?.setSysVolume(g.val / 100); // 直接调系统媒体音量
      showHud(`音量 ${Math.round(g.val)}%`);
    } else {
      g.val = Math.max(0.02, Math.min(1, g.base - (dy / g.h) * 1.3));
      androidBridge()?.setBrightness(g.val);
      showHud(`亮度 ${Math.round(g.val * 100)}%`);
    }
  };
  const onTouchEnd = (e: React.TouchEvent): void => {
    e.preventDefault(); // 不要再触发合成的鼠标点击
    const g = tg.current;
    tg.current = null;
    if (!g) return;
    if (g.mode === 'seek') { seekTo(g.val); holdScrub(g.val); return; }
    if (g.mode) return;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      // 左右两侧连续点：第三下起每下继续 ±10 秒；中间区域双击后重新计时
      lastTap.current = g.x < g.w / 3 || g.x > (g.w * 2) / 3 ? now : 0;
      if (tapTimer.current) window.clearTimeout(tapTimer.current);
      tapAct.current(g.x, g.w, true);
    } else {
      lastTap.current = now;
      if (tapTimer.current) window.clearTimeout(tapTimer.current);
      tapTimer.current = window.setTimeout(() => tapAct.current(g.x, g.w, false), 300);
    }
  };

  // 安卓：进入播放页即横屏沉浸全屏，离开时恢复
  useEffect(() => {
    if (!isMobileApp) return;
    void winSetFullscreen(true);
    setFull(true);
    return () => {
      void winSetFullscreen(false);
    };
  }, []);

  // ───────── 渲染 ─────────
  const title = item
    ? item.Type === 'Episode'
      ? `${item.SeriesName || ''}  S${item.ParentIndexNumber ?? 1}E${item.IndexNumber ?? 1} · ${item.Name}`
      : item.Name
    : '';
  const total = dur || ticksToSec(item?.RunTimeTicks);
  // 片尾：Emby 的「片尾」章节标记优先，没有再用 TheIntroDB
  const creditsAt = useMemo(() => {
    const mm = getManual(item?.SeriesId);
    if (mm?.tail != null && total > mm.tail) return total - mm.tail;
    const c = item?.Chapters?.find((x) => x.MarkerType === 'CreditsStart');
    if (c) return ticksToSec(c.StartPositionTicks);
    if (idb?.credits) return idb.credits.st;
    // 没有任何片尾标记：按整片比例（和 Emby 一样）
    return total > 0 && nextRef.current ? total * (loadPlayPrefs().creditsPct / 100) : null;
  }, [item, idb, total, manual]);
  const inCredits = creditsAt != null && total > 0 && cur >= creditsAt && cur < total - 1;
  const skipCredits = (): void => {
    if (nextRef.current) goNext();
    else void sessRef.current?.cmd('seek', [String(Math.max(0, total - 0.5)), 'absolute']);
  };

  useEffect(() => {
    if (scrub !== null && !scrubDrag.current && Math.abs(cur - scrub) < 1.2) setScrub(null);
  }, [cur, scrub]);
  const shownCur = scrub ?? cur;
  const pct = total > 0 ? Math.max(0, Math.min(100, (shownCur / total) * 100)) : 0;
  const scrubAt = (clientX: number): number => {
    const r = seekRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0 || total <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * total;
  };
  const bufPct = total > 0 ? (buffered / total) * 100 : 0;
  const showUi = uiShown || paused || drawer || !!menu || scrub !== null;

  return (
    <div className={`we-player mpv${showUi ? '' : ' hide-ui'}`} onMouseMove={poke} onClick={() => menu && setMenu('')}>
      {/* 透明点击层：mpv 画面在它下面的原生窗口里 */}
      {isMobileApp ? (
        <div className="we-surface" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} />
      ) : (
        <div className="we-surface" onClick={(e) => { e.stopPropagation(); if (menu) setMenu(''); else toggle(); }} onDoubleClick={() => void toggleFull()} />
      )}
      {hud && <div className="we-hud">{hud}</div>}

      {sleepWarn && (
        <div className="we-sleepwarn" onClick={(e) => e.stopPropagation()}>
          <span>1 分钟后将关闭播放</span>
          <button onClick={() => { setSleepAt(0); setSleepWarn(false); }}>取消定时，继续播放</button>
        </div>
      )}
      <DanmakuLayer list={dmList} getTime={() => (pausedRef.current ? posRef.current : posRef.current + ((performance.now() - posAt.current) / 1000) * rateRef.current)} size={dmCfg.size} speed={dmCfg.speed} opacity={dmCfg.opacity} area={dmCfg.area} offset={dmCfg.offset} visible={dmCfg.on && scrub === null} />
      {(busy || caching) && !err && <div className="we-loading"><span className="spinner" aria-hidden="true" />{busy ? '正在加载…' : '缓冲中…'}</div>}
      {err && <div className="we-error">{err}</div>}

      <div className="we-top" onMouseEnter={() => { hoverUi.current = true; }} onMouseLeave={() => { hoverUi.current = false; poke(); }}>
        <button className="we-btn we-back" title="返回（Esc）" aria-label="返回" onClick={(e) => { e.stopPropagation(); void exit(); }}>
          <svg width="26" height="26" viewBox="0 0 24 24"><path d="M15.5 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="we-titlebox">
          <div className="we-title" title={title}>{title}</div>
          <div className="we-subline">
            {[vstream?.Width && vstream?.Height ? `${vstream.Width}×${vstream.Height}` : '', badge, vstream?.Codec?.toUpperCase(), fpsShow > 0 ? `${Number(fpsShow.toFixed(3))} fps` : '', vbr > 0 ? `${(vbr / 1e6).toFixed(1)} Mbps` : '', `MPV${hw && hw !== 'no' ? ` · ${hw}` : ''}`].filter(Boolean).join('  ·  ')}
          </div>
        </div>
        <button className="we-btn we-txt" title="简介 / 演职员 / 选集（I）" onClick={(e) => { e.stopPropagation(); setDrawer((v) => !v); }}>
          {drawer ? '收起' : '信息'}
        </button>
        {!full && !isMobileApp && (
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

      {/* 中间大按钮：后退 10 秒 / 播放暂停 / 快进 10 秒 */}
      {isMobileApp && (<div className="we-center" onClick={(e) => e.stopPropagation()}>
        {isMobileApp && (<button className="we-cbtn" title="后退 10 秒（←）" aria-label="后退 10 秒" onClick={() => { seekBy(-10); poke(); }}>
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4" /><text x="8.4" y="15.2" fontSize="6.6" fill="currentColor" stroke="none" fontWeight="700">10</text></svg>
        </button>)}
        <button className="we-cbtn we-cplay" title="播放/暂停（空格）" aria-label={paused ? '播放' : '暂停'} onClick={toggle}>
          {paused ? (
            <svg width="64" height="64" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" /></svg>
          ) : (
            <svg width="64" height="64" viewBox="0 0 24 24"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor" /></svg>
          )}
        </button>
        {isMobileApp && (<button className="we-cbtn" title="快进 10 秒（→）" aria-label="快进 10 秒" onClick={() => { seekBy(10); poke(); }}>
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a8 8 0 1 1-3-6.2M20 4v4h-4" /><text x="8.4" y="15.2" fontSize="6.6" fill="currentColor" stroke="none" fontWeight="700">10</text></svg>
        </button>)}
      </div>)}

      {drawer && (
        <PlayerDrawer
          item={item}
          episodes={episodes}
          currentId={id}
          onClose={() => setDrawer(false)}
          onPickEpisode={(e) => nav(`/player/${e.Id}`, { replace: true })}
        />
      )}

      {inCredits && !inIntro && (
        <div className={`we-upnext${showUi ? ' up' : ''}`} onClick={(e) => e.stopPropagation()}>
          {nextEp ? (
            <>
              <div className="we-upnext-h">接下来播放</div>
              <div className="we-upnext-body">
                <img src={thumbUrl(nextEp, 360) || posterUrl(nextEp, 200)} alt="" draggable={false} />
                <div>
                  <div className="we-upnext-t">{nextEp.ParentIndexNumber != null && nextEp.IndexNumber != null ? `S${nextEp.ParentIndexNumber}:E${nextEp.IndexNumber}　` : ''}{nextEp.Name}</div>
                  {nextEp.Overview && <div className="we-upnext-o">{nextEp.Overview}</div>}
                </div>
              </div>
              <div className="we-upnext-b"><button onClick={skipCredits}>播放下一集 ›</button></div>
            </>
          ) : (
            <button className="we-skip" style={{ position: 'static' }} onClick={skipCredits}>跳过片尾 ›</button>
          )}
        </div>
      )}
      {inIntro && intro && (
        <button className={`we-skip${showUi ? ' up' : ''}`} onClick={(e) => { e.stopPropagation(); void sessRef.current?.cmd('seek', [String(intro.en), 'absolute']); }}>
          跳过片头 ›
        </button>
      )}

      <div className="we-bottom" onClick={(e) => e.stopPropagation()} onMouseEnter={() => { hoverUi.current = true; }} onMouseLeave={() => { hoverUi.current = false; poke(); }}>
        <div className="we-seekrow">
          <span className="we-time we-time-l">{fmtDuration(shownCur)}</span>
          <div
            ref={seekRef}
            className="we-seek"
            onPointerDown={(e) => {
              if (total <= 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              hoverUi.current = true;
              scrubDrag.current = true;
              window.clearTimeout(scrubHold.current);
              setScrub(scrubAt(e.clientX));
            }}
            onPointerMove={(e) => { if (scrubDrag.current) setScrub(scrubAt(e.clientX)); }}
            onPointerUp={(e) => {
              if (scrub === null) return;
              scrubDrag.current = false;
              const tt = scrubAt(e.clientX);
              seekTo(tt);
              holdScrub(tt);
              hoverUi.current = false;
              poke();
            }}
            onPointerCancel={() => { scrubDrag.current = false; setScrub(null); hoverUi.current = false; }}
          >
            {scrub !== null && <div className="we-scrubtip" style={{ left: `${pct}%` }}>{fmtDuration(scrub)}</div>}
            <div className="we-seek-buf" style={{ width: `${bufPct}%` }} />
            <div className="we-seek-cur" style={{ width: `${pct}%` }} />
            <div className="we-seek-dot" style={{ left: `${pct}%` }} />
          </div>
          <span className="we-time we-time-r" title={`${fmtDuration(shownCur)} / ${fmtDuration(total)}`}>{total > 0 ? `-${fmtDuration(Math.max(0, total - shownCur))}` : ''}<i className="we-clock">{clock.toTimeString().slice(0, 5)}</i></span>
        </div>
        <div className="we-ctrls">
          {!isMobileApp && (
            <button className="we-btn" title="播放/暂停（空格）" aria-label={paused ? '播放' : '暂停'} onClick={() => { toggle(); poke(); }}>
              {paused ? <svg width="26" height="26" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" /></svg> : <svg width="26" height="26" viewBox="0 0 24 24"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor" /></svg>}
            </button>
          )}
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

          {!isMobileApp && (<>
        <button className="we-btn" title="后退 10 秒（←）" aria-label="后退 10 秒" onClick={() => { seekBy(-10); poke(); }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4" /><text x="8.4" y="15.2" fontSize="6.6" fill="currentColor" stroke="none" fontWeight="700">10</text></svg>
        </button>
        <button className="we-btn" title="快进 10 秒（→）" aria-label="快进 10 秒" onClick={() => { seekBy(10); poke(); }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a8 8 0 1 1-3-6.2M20 4v4h-4" /><text x="8.4" y="15.2" fontSize="6.6" fill="currentColor" stroke="none" fontWeight="700">10</text></svg>
        </button>
          </>)}
          <span style={{ flex: 1 }} />
          {isMobileApp && (
            <div className="we-menu-wrap">
              <button className="we-btn we-lbl" onClick={() => setMenu(menu === 'sleep' ? '' : 'sleep')}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg><span>{sleepEnd ? (item?.Type === 'Episode' ? '播完本集' : '播完退出') : sleepAt ? '定时中' : '定时'}</span></button>
              {menu === 'sleep' && (
                <div className="we-menu" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                  <div className={`we-menu-item${!sleepAt && !sleepEnd ? ' active' : ''}`} onClick={() => { setSleepEnd(false); setSleepAt(0); setMenu(''); }}>不开启</div>
                  <div className={`we-menu-item${sleepEnd ? ' active' : ''}`} onClick={() => { setSleepAt(0); setSleepEnd(true); setMenu(''); }}>{item?.Type === 'Episode' ? '播完本集' : '播完本部电影'}</div>
                  {[15, 30, 45, 60, 90].map((m) => <div key={m} className="we-menu-item" onClick={() => setSleepMin(m)}>{m} 分钟后</div>)}
                  <div className="we-menu-item" style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <input value={sleepCustom} onChange={(e) => setSleepCustom(e.target.value)} placeholder="分钟 或 23:30" inputMode="text" style={{ width: 104, height: 30, fontSize: 13 }} />
                    <button type="button" className="we-btn" style={{ fontSize: 13 }} onClick={() => { const v = sleepCustom.trim(); if (/^\d+$/.test(v) && Number(v) > 0) setSleepMin(Number(v)); else setSleepClock(v); }}>确定</button>
                  </div>
                  {sleepAt > 0 && <div className="we-menu-item" style={{ opacity: .7 }}>将于 {new Date(sleepAt).toTimeString().slice(0, 5)} 关闭</div>}
                </div>
              )}
            </div>
          )}
          {nextEp && (
            <button className="we-btn we-lbl" title="下一集（N）" onClick={goNext}>
              <svg width="22" height="22" viewBox="0 0 24 24"><path d="M6 5v14l9-7-9-7Zm10 0h2.5v14H16z" fill="currentColor" /></svg><span>下一集</span>
            </button>
          )}
          {episodes.length > 1 && (
            <div className="we-menu-wrap">
              <button className="we-btn we-lbl" title="选集" onClick={() => setMenu(menu === 'eps' ? '' : 'eps')}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg><span>选集</span></button>
              {menu === 'eps' && (
                <div className="we-menu we-menu-eps">
                  <div className="we-menu-head">{item?.SeasonName || item?.SeriesName || '选集'}</div>
                  {episodes.map((e) => (
                    <div
                      key={e.Id}
                      ref={e.Id === id ? scrollToActive : undefined}
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

          {item?.Type === 'Episode' && (
            <div className="we-menu-wrap">
              <button className="we-btn we-lbl" onClick={() => setMenu(menu === 'intro' ? '' : 'intro')}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M5 5v14l8-7-8-7Zm10 0v14" /></svg><span>片头</span></button>
              {menu === 'intro' && (
                <div className="we-menu" onClick={(e) => e.stopPropagation()}>
                  <div className="we-menu-head">片头 / 片尾（整部剧通用，自动同步到 Emby）</div>
                  <div className="we-menu-item" style={{ opacity: .75 }}>{intro ? `片头：${fmtDuration(intro.st)} – ${fmtDuration(intro.en)}` : '片头：没有数据'}{creditsAt != null ? `　片尾：${fmtDuration(creditsAt)}` : ''}</div>
                  {introTip && <div className="we-menu-item" style={{ opacity: .85 }}>{introTip}</div>}
                  <div className="we-menu-item" onClick={() => setManualS((m) => ({ ...m, st: posRef.current }))}>此刻 {fmtDuration(cur)} = 片头开始{manual?.st != null ? `（已选 ${fmtDuration(manual.st)}）` : ''}</div>
                  <div className="we-menu-item" onClick={() => setManualS((m) => ({ ...m, en: posRef.current }))}>此刻 {fmtDuration(cur)} = 片头结束{manual?.en != null ? `（已选 ${fmtDuration(manual.en)}）` : ''}</div>
                  <div className="we-menu-item" onClick={() => setManualS((m) => ({ ...m, tail: Math.max(0, Math.round(total - posRef.current)) }))}>此刻 {fmtDuration(cur)} = 片尾开始{manual?.tail != null ? `（距结尾 ${fmtDuration(manual.tail)}）` : ''}</div>
                  <div className="we-menu-item" onClick={() => {
                    const hasIntro = manual?.st != null || manual?.en != null;
                    const st = manual?.st ?? intro?.st ?? 0, en = manual?.en ?? intro?.en;
                    const tail = manual?.tail;
                    if (!item?.SeriesId) return;
                    if (hasIntro && (en == null || en <= st)) { setIntroTip('片头：请先选好开始和结束'); return; }
                    if (!hasIntro && tail == null) { setIntroTip('请先选好片头或片尾'); return; }
                    const old = getManual(item.SeriesId);
                    const next = { st: hasIntro ? st : old?.st ?? 0, en: hasIntro ? (en as number) : old?.en ?? 0, tail: tail ?? old?.tail };
                    setManual(item.SeriesId, next); setManualS(next);
                    setIntroTip('已保存，正在同步到 Emby…');
                    syncSeriesMarkers(item.SeriesId, { st: hasIntro ? st : undefined, en: hasIntro ? en : undefined, tail: tail ?? undefined })
                      .then((n) => setIntroTip(`已同步到 Emby：${n} 集`))
                      .catch((e: unknown) => setIntroTip(`已保存在本机；同步 Emby 失败：${e instanceof Error ? e.message : '未知错误'}`));
                  }}>保存并同步到本剧所有集</div>
                  <div className="we-menu-item" onClick={() => {
                    if (!item?.SeriesId) return;
                    setManual(item.SeriesId, null); setManualS(null); setIntroTip('已清除本机设置，正在清除 Emby 标记…');
                    syncSeriesMarkers(item.SeriesId, { st: null, en: null, tail: null })
                      .then(() => setIntroTip('已清除（本机 + Emby）'))
                      .catch(() => setIntroTip('已清除本机设置（Emby 未同步）'));
                  }}>清除本剧标记（含 Emby）</div>
                </div>
              )}
            </div>
          )}
          <div className="we-menu-wrap">
            <button className="we-btn we-lbl" onClick={() => setMenu(menu === 'danmu' ? '' : 'danmu')}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M7 9h6M10 13h7M8 21l3-4" /></svg><span>弹幕{dmCfg.on && dmList.length ? '' : dmCfg.on ? '' : '·关'}</span></button>
            {menu === 'danmu' && (
              <div className="we-menu we-dm" style={{ minWidth: 220, padding: 10 }} onClick={(e) => e.stopPropagation()}>
                <div className={`we-menu-item${dmCfg.on ? ' active' : ''}`} onClick={() => updDm({ on: !dmCfg.on })}>{dmCfg.on ? '弹幕：开' : '弹幕：关'}{dmMsg ? `（${dmMsg}）` : !dmCfg.url.trim() ? '（还没设置弹幕服务）' : ''}</div>
                <label className="we-dm-row">透明度<input type="range" min={20} max={100} value={Math.round(dmCfg.opacity * 100)} onChange={(e) => updDm({ opacity: Number(e.target.value) / 100 })} /></label>
                <label className="we-dm-row">字号<input type="range" min={16} max={40} value={dmCfg.size} onChange={(e) => updDm({ size: Number(e.target.value) })} /></label>
                <label className="we-dm-row">速度<input type="range" min={80} max={300} step={10} value={dmCfg.speed} onChange={(e) => updDm({ speed: Number(e.target.value) })} /></label>
                <label className="we-dm-row">上下位置<input type="range" min={0} max={40} value={Math.round(dmCfg.offset * 100)} onChange={(e) => updDm({ offset: Number(e.target.value) / 100 })} /></label>
                <div className="we-dm-row">区域{[0.25, 0.5, 0.75, 1].map((a) => <button key={a} type="button" className={`we-dm-chip${dmCfg.area === a ? ' on' : ''}`} onClick={() => updDm({ area: a })}>{a === 1 ? '全屏' : `${a * 100}%`}</button>)}</div>
              </div>
            )}
          </div>
          <div className="we-menu-wrap">
            <button className="we-btn we-lbl" onClick={() => setMenu(menu === 'speed' ? '' : 'speed')}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg><span>{rate === 1 ? '倍速' : `${rate}x`}</span></button>
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
              <button className="we-btn we-lbl" onClick={() => setMenu(menu === 'audio' ? '' : 'audio')}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4Zm13 0a4 4 0 0 1 0 6" /></svg><span>音轨</span></button>
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
            <button className="we-btn we-lbl" onClick={() => setMenu(menu === 'sub' || menu === 'substyle' ? '' : 'sub')}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16v11H9l-5 4V5Z" /><path d="M8 10h8M8 13h5" /></svg><span>字幕{sid ? ' ●' : ''}</span></button>
            {menu === 'sub' && (
              <div className="we-menu">
                <div className="we-menu-item" onClick={() => setMenu('substyle')}>字幕大小 / 位置 / 延迟 ›</div>
                <div className="we-menu-sep" />
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
            {menu === 'substyle' && (
              <div className="we-menu we-substyle" onClick={(e) => e.stopPropagation()}>
                <div className="we-menu-head">字幕样式</div>
                <label className="we-ss"><span>大小 {Math.round(subStyle.scale * 100)}%</span>
                  <input type="range" min={50} max={250} step={5} value={Math.round(subStyle.scale * 100)} onChange={(e) => changeSubStyle({ scale: Number(e.target.value) / 100 })} /></label>
                <label className="we-ss"><span>位置（抬高 {Math.round(subStyle.lift)}%）</span>
                  <input type="range" min={0} max={45} step={1} value={Math.round(subStyle.lift)} onChange={(e) => changeSubStyle({ lift: Number(e.target.value) })} /></label>
                <label className="we-ss"><span>延迟 {subStyle.delay > 0 ? '+' : ''}{subStyle.delay.toFixed(1)} 秒</span>
                  <input type="range" min={-10} max={10} step={0.5} value={subStyle.delay} onChange={(e) => changeSubStyle({ delay: Number(e.target.value) })} /></label>
                <div className="we-ss-btns"><button className="we-btn we-txt" onClick={() => changeSubStyle({ ...SUB_DEFAULT })}>恢复默认</button><button className="we-btn we-txt" onClick={() => setMenu('sub')}>返回</button></div>
              </div>
            )}
          </div>

          {isMobileApp ? (
            <button className="we-btn we-lbl" title="旋转屏幕（横屏 / 竖屏）" onClick={() => void toggleFull()}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="3" width="10" height="18" rx="2" transform={full ? 'rotate(90 12 12)' : undefined} /><path d="M20 8a9 9 0 0 0-3-3.5M4 16a9 9 0 0 0 3 3.5M20 4v4h-4M4 20v-4h4" /></svg>
              <span>{full ? '竖屏' : '横屏'}</span>
            </button>
          ) : (
            <button className="we-btn" title="全屏（F）" onClick={() => void toggleFull()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {full ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
            </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
