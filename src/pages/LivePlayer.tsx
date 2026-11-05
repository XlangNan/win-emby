// 直播播放：全窗口 mpv + 渐隐控制条 + 左侧频道列表。↑/↓ 或 PgUp/PgDn 换台，L 开关频道列表，Tab 换线路。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { openMpv, type MpvSession } from '../lib/mpv';
import { loadChannels, loadFavs, type LiveChannel } from '../lib/live';
import { loadPlayPrefs, savePlayPrefs } from '../lib/prefs';
import { isAndroid } from '../lib/platform';
import { winClose, winIsFullscreen, winMinimize, winSetFullscreen, winToggleMax } from '../lib/win';

export default function LivePlayer() {
  const nav = useNavigate();
  const [qs] = useSearchParams();
  const all = useMemo(loadChannels, []);
  const g = qs.get('g') || '';
  const pool: LiveChannel[] = useMemo(() => {
    const favs = loadFavs();
    return all.filter((c) => (g === '__fav' ? favs.includes(c.name) : !g || c.group === g));
  }, [all, g]);
  const [name, setName] = useState(qs.get('ch') || '');
  const [line, setLine] = useState(0);
  const ch = all.find((c) => c.name === name);

  const sessRef = useRef<MpvSession | null>(null);
  const readyRef = useRef<Promise<MpvSession | null> | null>(null);
  const pausedRef = useRef(false);
  const failTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const lineRef = useRef(0);
  lineRef.current = line;
  const chRef = useRef<LiveChannel | undefined>(ch);
  chRef.current = ch;

  const [paused, setPaused] = useState(false);
  const [vol, setVol] = useState(Math.round(loadPlayPrefs().volume * 100));
  const [muted, setMuted] = useState(false);
  const [fps, setFps] = useState(0);
  const [dim, setDim] = useState({ w: 0, h: 0 });
  const [vbr, setVbr] = useState(0);
  const [hw, setHw] = useState('');
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [uiShown, setUiShown] = useState(true);
  const [list, setList] = useState(true);
  const [full, setFull] = useState(false);

  const nextLine = useCallback((reason: string) => {
    const c = chRef.current;
    if (!c) return;
    if (lineRef.current + 1 < c.lines.length) {
      setLine(lineRef.current + 1);
    } else {
      setBusy(false);
      setErr(`${reason}（已试完 ${c.lines.length} 条线路，可以换个频道或稍后再试）`);
    }
  }, []);

  // 起 mpv（只一次）
  useEffect(() => {
    let dead = false;
    document.documentElement.classList.add('mpv-on');
    readyRef.current = openMpv({
      hdr: loadPlayPrefs().hdr,
      onProp: (n, d) => {
        switch (n) {
          case 'pause': pausedRef.current = !!d; setPaused(!!d); break;
          case 'time-pos':
            if (typeof d === 'number') {
              setBusy(false);
              setErr('');
              if (failTimer.current) window.clearTimeout(failTimer.current);
            }
            break;
          case 'container-fps': setFps(typeof d === 'number' ? d : 0); break;
          case 'video-bitrate': setVbr(typeof d === 'number' ? d : 0); break;
          case 'width': setDim((x) => ({ ...x, w: typeof d === 'number' ? d : 0 })); break;
          case 'height': setDim((x) => ({ ...x, h: typeof d === 'number' ? d : 0 })); break;
          case 'volume': if (typeof d === 'number') setVol(d); break;
          case 'mute': setMuted(!!d); break;
          case 'hwdec-current': setHw(typeof d === 'string' ? d : ''); break;
          default: break;
        }
      },
    })
      .then(async (s) => {
        if (dead) {
          await s.close();
          return null;
        }
        sessRef.current = s;
        await s.set('volume', Math.round(loadPlayPrefs().volume * 100));
        return s;
      })
      .catch((e: unknown) => {
        setBusy(false);
        setErr(`MPV 启动失败：${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
    return () => {
      dead = true;
      if (failTimer.current) window.clearTimeout(failTimer.current);
      const s = sessRef.current;
      sessRef.current = null;
      void s?.close();
      document.documentElement.classList.remove('mpv-on');
    };
  }, []);

  // 换台 / 换线路
  useEffect(() => {
    const url = ch?.lines[line]?.url;
    if (!url) return;
    let dead = false;
    setBusy(true);
    setErr('');
    setFps(0);
    setVbr(0);
    setDim({ w: 0, h: 0 });
    void readyRef.current?.then(async (s) => {
      if (!s || dead) return;
      await s.loadfile(url);
      failTimer.current = window.setTimeout(() => nextLine('这条线路 15 秒内没有出画面'), 15000);
    });
    return () => {
      dead = true;
      if (failTimer.current) window.clearTimeout(failTimer.current);
    };
  }, [ch, line, nextLine]);

  const pick = useCallback((c: LiveChannel) => {
    setName(c.name);
    setLine(0);
  }, []);
  const step = useCallback((d: number) => {
    if (!pool.length) return;
    const i = pool.findIndex((c) => c.name === name);
    pick(pool[(i + d + pool.length) % pool.length]);
  }, [pool, name, pick]);

  const toggle = useCallback(() => void sessRef.current?.cmd('cycle', ['pause']), []);
  const setVolume = useCallback((v: number) => {
    const c = Math.max(0, Math.min(100, v));
    void sessRef.current?.set('volume', Math.round(c));
    void sessRef.current?.set('mute', 'no');
    savePlayPrefs({ volume: c / 100 });
  }, []);
  const toggleFull = useCallback(async () => {
    const next = !(await winIsFullscreen());
    await winSetFullscreen(next);
    setFull(next);
  }, []);
  const exit = useCallback(async () => {
    if (await winIsFullscreen()) await winSetFullscreen(false);
    nav('/live', { replace: true });
  }, [nav]);

  const poke = useCallback(() => {
    setUiShown(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setUiShown(false), 3000);
  }, []);
  useEffect(() => {
    poke();
  }, [poke]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      switch (e.key) {
        case ' ': e.preventDefault(); toggle(); break;
        case 'ArrowUp': case 'PageUp': e.preventDefault(); step(-1); break;
        case 'ArrowDown': case 'PageDown': e.preventDefault(); step(1); break;
        case 'ArrowLeft': setVolume(vol - 5); break;
        case 'ArrowRight': setVolume(vol + 5); break;
        case 'Tab': e.preventDefault(); if (ch && ch.lines.length > 1) setLine((l) => (l + 1) % ch.lines.length); break;
        case 'l': case 'L': setList((v) => !v); break;
        case 'm': case 'M': void sessRef.current?.cmd('cycle', ['mute']); break;
        case 'f': case 'F': void toggleFull(); break;
        case 'Escape': void exit(); break;
        default: return;
      }
      poke();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, step, setVolume, vol, ch, toggleFull, exit, poke]);

  useEffect(() => {
    if (!isAndroid) return;
    void winSetFullscreen(true);
    setFull(true);
    return () => {
      void winSetFullscreen(false);
    };
  }, []);

  const showUi = uiShown || paused;

  return (
    <div className={`we-player mpv${showUi ? '' : ' hide-ui'}`} onMouseMove={poke}>
      <div className="we-surface" onClick={() => { if (isAndroid) { if (showUi && !paused) setUiShown(false); else poke(); } else toggle(); }} onDoubleClick={() => { if (!isAndroid) void toggleFull(); }} />
      {busy && !err && <div className="we-loading"><span className="spinner" aria-hidden="true" />正在连接…</div>}
      {err && <div className="we-error">{err}</div>}

      <div className="we-top">
        <button className="we-btn we-back" title="返回（Esc）" aria-label="返回" onClick={() => void exit()}>
          <svg width="26" height="26" viewBox="0 0 24 24"><path d="M15.5 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="we-titlebox">
          <div className="we-title">{ch?.name || '未找到频道'} <span className="we-livedot">● 直播</span></div>
          <div className="we-subline">
            {[dim.w > 0 ? `${dim.w}×${dim.h}` : '', fps > 0 ? `${Number(fps.toFixed(3))} fps` : '', vbr > 0 ? `${(vbr / 1e6).toFixed(1)} Mbps` : '', ch && ch.lines.length > 1 ? `线路 ${line + 1}/${ch.lines.length}` : '', `MPV${hw && hw !== 'no' ? ` · ${hw}` : ''}`].filter(Boolean).join('  ·  ')}
          </div>
        </div>
        {!full && !isAndroid && (
          <div className="we-winbtns">
            <button className="we-btn" title="最小化" onClick={() => void winMinimize()}><svg width="12" height="12" viewBox="0 0 16 16"><line x1="3.5" y1="8" x2="12.5" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>
            <button className="we-btn" title="最大化" onClick={() => void winToggleMax()}><svg width="12" height="12" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>
            <button className="we-btn" title="关闭" onClick={() => void winClose()}><svg width="12" height="12" viewBox="0 0 16 16"><line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>
          </div>
        )}
      </div>

      <div className="we-center" onClick={(e) => e.stopPropagation()}>
        <button className="we-cbtn" title="上一个频道（↑）" aria-label="上一台" onClick={() => { step(-1); poke(); }}>
          <svg width="44" height="44" viewBox="0 0 24 24"><path d="M18 5v14l-9-7 9-7ZM6 5h2.5v14H6z" fill="currentColor" /></svg>
        </button>
        <button className="we-cbtn we-cplay" title="播放/暂停（空格）" aria-label={paused ? '播放' : '暂停'} onClick={toggle}>
          {paused ? <svg width="64" height="64" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" /></svg> : <svg width="64" height="64" viewBox="0 0 24 24"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor" /></svg>}
        </button>
        <button className="we-cbtn" title="下一个频道（↓）" aria-label="下一台" onClick={() => { step(1); poke(); }}>
          <svg width="44" height="44" viewBox="0 0 24 24"><path d="M6 5v14l9-7-9-7Zm9.5 0H18v14h-2.5z" fill="currentColor" /></svg>
        </button>
      </div>

      {list && (
        <div className="we-chlist">
          <div className="we-chlist-head">{g === '__fav' ? '收藏频道' : g || '全部频道'}（↑↓ 换台）</div>
          <div className="we-chlist-body">
            {pool.map((c) => (
              <div key={c.name} className={`we-menu-item${c.name === name ? ' active' : ''}`} onClick={() => pick(c)}>{c.name}</div>
            ))}
          </div>
        </div>
      )}

      <div className="we-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="we-ctrls">
          <div className="we-volgrp" title="鼠标滚轮调节音量" onWheel={(e) => { setVolume(vol + (e.deltaY < 0 ? 5 : -5)); poke(); }}>
            <button className="we-btn we-txt" title="静音（M）" onClick={() => void sessRef.current?.cmd('cycle', ['mute'])}>{muted || vol === 0 ? '静音' : '音量'}</button>
            <input className="we-vol" type="range" min={0} max={100} value={muted ? 0 : vol} aria-label="音量" onChange={(e) => setVolume(Number(e.target.value))} />
            <span className="we-volnum">{muted ? '静音' : Math.round(vol)}</span>
          </div>
          <span style={{ flex: 1 }} />
          {ch && ch.lines.length > 1 && (
            <button className="we-btn we-lbl" title="换线路（Tab）" onClick={() => setLine((l) => (l + 1) % ch.lines.length)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h12l-3-3M20 17H8l3 3" /></svg><span>换线路</span>
            </button>
          )}
          <button className="we-btn we-lbl" title="频道列表（L）" onClick={() => setList((v) => !v)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg><span>频道</span>
          </button>
          {!isAndroid && (
            <button className="we-btn" title="全屏（F）" onClick={() => void toggleFull()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{full ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}</svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
