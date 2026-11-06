// 播放偏好（localStorage）
export interface PlayPrefs {
  /** 画质上限，单位 Mbps；0 = 不限（原画优先） */
  maxMbps: number;
  /** 允许 HEVC(H.265) 直接播放（需要系统带 HEVC 解码；不勾选则由服务器转码为 H.264） */
  hevc: boolean;
  /** 播完自动播下一集 */
  autoNext: boolean;
  volume: number;
  /** 播放内核：mpv = 内嵌 MPV（HDR / 杜比视界）；html5 = 内置网页播放器 */
  engine: 'mpv' | 'html5';
  /** MPV：把 HDR 信号直通给显示器（需 Windows 开启「使用 HDR」）；关闭则映射成 SDR */
  hdr: boolean;
  /** 首页隐藏的媒体库 id */
  hiddenLibs: string[];
  /** 首页媒体库顺序（媒体库 id） */
  libOrder: string[];
  /** 默认音轨语言（Emby 的三字母码，如 chi / eng / jpn；空 = 跟随文件默认） */
  audioLang: string;
  /** 默认字幕语言；'off' = 不显示；空 = 跟随文件默认 */
  subLang: string;
  /** 记住每部片上次选的音轨 / 字幕 */
  rememberTracks: boolean;
  /** 自动跳过片头 */
  autoSkipIntro: boolean;
  /** 媒体库海报宽度（px，最小列宽） */
  posterSize: number;
  /** 首页轮播：开关 / 来源媒体库（空=全部）/ 内容 / 数量 */
  heroOn: boolean;
  heroLibs: string[];
  heroMode: 'latest' | 'random' | 'resume';
  heroCount: number;
}

const KEY = 'wemby-play-prefs';
const DEFAULTS: PlayPrefs = { maxMbps: 0, hevc: false, autoNext: true, volume: 1, engine: 'mpv', hdr: true,
  hiddenLibs: [], libOrder: [], audioLang: '', subLang: '', rememberTracks: true, autoSkipIntro: false, posterSize: 138,
  heroOn: true, heroLibs: [], heroMode: 'latest', heroCount: 10,
};

export function loadPlayPrefs(): PlayPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PlayPrefs>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePlayPrefs(p: Partial<PlayPrefs>): PlayPrefs {
  const next = { ...loadPlayPrefs(), ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

// 搜索历史
const HKEY = 'wemby-search-history';
export function loadSearchHistory(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HKEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 10) : [];
  } catch {
    return [];
  }
}
export function pushSearchHistory(q: string): string[] {
  const t = q.trim();
  if (!t) return loadSearchHistory();
  const next = [t, ...loadSearchHistory().filter((x) => x !== t)].slice(0, 10);
  try {
    localStorage.setItem(HKEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
export function clearSearchHistory(): void {
  try {
    localStorage.removeItem(HKEY);
  } catch {
    /* ignore */
  }
}

// 每部片上次选的音轨 / 字幕（Emby 的 MediaStream.Index；字幕 -1 = 关闭）
const TKEY = 'wemby-track-memory';
export interface TrackMemory { audio?: number; sub?: number }
type TrackMap = Record<string, TrackMemory>;
function readTracks(): TrackMap {
  try {
    return JSON.parse(localStorage.getItem(TKEY) || '{}') as TrackMap;
  } catch {
    return {};
  }
}
export function getTrackMemory(itemId: string): TrackMemory | undefined {
  return readTracks()[itemId];
}
export function setTrackMemory(itemId: string, p: TrackMemory): void {
  const m = readTracks();
  m[itemId] = { ...m[itemId], ...p };
  const keys = Object.keys(m);
  if (keys.length > 800) for (const k of keys.slice(0, keys.length - 800)) delete m[k];
  try {
    localStorage.setItem(TKEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}
