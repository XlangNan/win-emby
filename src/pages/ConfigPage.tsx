// 设置：账号 / 皮肤 / 播放偏好
import { useState } from 'react';
import { clearSession, getSession } from '../emby/session';
import { applyTheme, useTheme } from '../lib/theme';
import { loadPlayPrefs, savePlayPrefs } from '../lib/prefs';
import { ALL_THEMES, THEME_LABELS } from '../lib/themeTokens';

export default function ConfigPage() {
  const s = getSession();
  const theme = useTheme();
  const [prefs, setPrefs] = useState(loadPlayPrefs);
  const set = (p: Partial<typeof prefs>): void => setPrefs(savePlayPrefs(p));

  return (
    <>
      <div className="topbar"><h3 style={{ margin: 0 }}>设置</h3></div>
      <div className="content">
        <div className="card we-set" style={{ marginBottom: 14 }}>
          <h3>账号</h3>
          <div className="we-set-row">
            <span className="muted">服务器</span><span>{s?.server}</span>
          </div>
          <div className="we-set-row">
            <span className="muted">用户</span><span>{s?.userName}</span>
          </div>
          <div style={{ marginTop: 10 }}>
            <button onClick={() => clearSession()}>退出登录 / 切换服务器</button>
          </div>
        </div>

        <div className="card we-set" style={{ marginBottom: 14 }}>
          <h3>界面皮肤</h3>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {ALL_THEMES.map((t) => (
              <button key={t} className={`tag ${theme === t ? 'active' : ''}`} aria-pressed={theme === t} onClick={() => applyTheme(t)}>
                {THEME_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="card we-set">
          <h3>播放</h3>
          <div className="we-set-row">
            <span>
              播放内核
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>MPV 直接解码原文件，支持 HDR10 / 杜比视界、MKV、DTS / TrueHD；内置播放器依赖服务器转码</span>
            </span>
            <select value={prefs.engine} onChange={(e) => set({ engine: e.target.value as 'mpv' | 'html5' })}>
              <option value="mpv">MPV（推荐）</option>
              <option value="html5">内置网页播放器</option>
            </select>
          </div>
          <label className="we-set-row" style={{ cursor: 'pointer' }}>
            <span>
              MPV：HDR 直通显示器
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>需要在 Windows「显示设置」里打开「使用 HDR」；关闭则自动映射成 SDR 画面</span>
            </span>
            <input type="checkbox" checked={prefs.hdr} onChange={(e) => set({ hdr: e.target.checked })} />
          </label>
          <div className="we-set-row">
            <span>画质上限（仅内置播放器）</span>
            <select value={prefs.maxMbps} onChange={(e) => set({ maxMbps: Number(e.target.value) })}>
              <option value={0}>原画（不限）</option>
              {[40, 20, 10, 8, 4, 2].map((m) => <option key={m} value={m}>{m} Mbps</option>)}
            </select>
          </div>
          <label className="we-set-row" style={{ cursor: 'pointer' }}>
            <span>
              内置播放器：允许 HEVC (H.265) 直接播放
              <span className="muted" style={{ display: 'block', fontSize: 12 }}>电脑装了 HEVC 解码（硬解 / 微软 HEVC 扩展）再打开；关闭时由服务器转成 H.264</span>
            </span>
            <input type="checkbox" checked={prefs.hevc} onChange={(e) => set({ hevc: e.target.checked })} />
          </label>
          <label className="we-set-row" style={{ cursor: 'pointer' }}>
            <span>播完自动播放下一集</span>
            <input type="checkbox" checked={prefs.autoNext} onChange={(e) => set({ autoNext: e.target.checked })} />
          </label>
        </div>
      </div>
    </>
  );
}
