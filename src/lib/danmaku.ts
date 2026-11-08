// 弹幕：从「弹幕聚合服务」（兼容弹弹play v2 接口，如自建 danmu_api）按片名匹配并拉取弹幕。
import { httpFetch } from '../emby/http';

export interface DanmakuCfg {
  /** 服务地址，如 http://192.168.1.10:9321 或带 token 路径 http://host:9321/87654321 */
  url: string;
  appId: string;
  appSecret: string;
  on: boolean;
  opacity: number; // 0.2–1
  size: number; // 字号 px，16–40
  speed: number; // 滚动速度 px/s
  area: number; // 显示区域占屏幕高度比例 0.25 / 0.5 / 0.75 / 1
  offset: number; // 距顶部的留白比例（避开剧名），0–0.4
}

const KEY = 'wemby-danmaku';
const DEF: DanmakuCfg = { url: '', appId: '', appSecret: '', on: true, opacity: 0.85, size: 24, speed: 150, area: 0.5, offset: 0.12 };

export function loadDanmaku(): DanmakuCfg {
  try {
    return { ...DEF, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<DanmakuCfg>) };
  } catch {
    return { ...DEF };
  }
}
export function saveDanmaku(p: Partial<DanmakuCfg>): DanmakuCfg {
  const n = { ...loadDanmaku(), ...p };
  try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* ignore */ }
  return n;
}

export interface Dm {
  t: number; // 出现时间（秒）
  mode: 'scroll' | 'top' | 'bottom';
  color: string;
  text: string;
}

function base(cfg: DanmakuCfg): string {
  let u = cfg.url.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

async function sign(cfg: DanmakuCfg, path: string): Promise<Record<string, string>> {
  if (!cfg.appId || !cfg.appSecret) return {};
  const ts = String(Math.floor(Date.now() / 1000));
  const data = new TextEncoder().encode(cfg.appId + ts + path + cfg.appSecret);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  let b = '';
  h.forEach((x) => { b += String.fromCharCode(x); });
  return { 'X-AppId': cfg.appId, 'X-Timestamp': ts, 'X-Signature': btoa(b) };
}

async function api<T>(cfg: DanmakuCfg, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const url = base(cfg) + path;
  let p = path.split('?')[0];
  try { p = new URL(url).pathname.replace(/^.*?(\/api\/v2\/)/, '/api/v2/').split('?')[0]; } catch { /* ignore */ }
  const headers: Record<string, string> = { Accept: 'application/json', ...(await sign(cfg, p)) };
  if (init?.body) headers['Content-Type'] = 'application/json';
  const r = await httpFetch(url, { method: init?.method || 'GET', headers, body: init?.body ? JSON.stringify(init.body) : undefined });
  if (!r.ok) throw new Error(`弹幕服务返回 ${r.status}`);
  return (await r.json()) as T;
}

export async function testDanmaku(cfg: DanmakuCfg): Promise<string> {
  const r = await api<{ animes?: unknown[] }>(cfg, '/api/v2/search/anime?keyword=' + encodeURIComponent('你好'));
  return Array.isArray(r.animes) ? '连接成功' : '连接成功（返回格式不太一样，播放时试试）';
}

const cache = new Map<string, Dm[]>();

function hex(n: number): string {
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}

/** anime：片名 / 剧名；episode：第几集（电影不传） */
const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
/** 第 N 季的常见写法：第二季 / 第2季 / Season 2 / S2 / 2nd Season */
const seasonRe = (n: number): RegExp => new RegExp(`第\\s*(${CN[n] || n}|${n})\\s*[季期部]|season\\s*${n}\\b|\\bs0?${n}\\b|${n}(st|nd|rd|th)\\s*season`, 'i');

export async function fetchDanmaku(cfg: DanmakuCfg, anime: string, episode?: number, season?: number): Promise<Dm[]> {
  const sn = season && season > 1 ? season : 1;
  const key = `${base(cfg)}|${anime}|${sn}|${episode ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let epId = 0;
  try {
    const q = `/api/v2/search/episodes?anime=${encodeURIComponent(anime)}${episode ? `&episode=${episode}` : ''}`;
    const r = await api<{ animes?: { animeTitle?: string; episodes?: { episodeId: number }[] }[] }>(cfg, q);
    const withEp = (r.animes || []).filter((a) => a.episodes?.length);
    // 第 2 季以后：只认标题里写着季数的条目，找不到就走下面按 S02E.. 匹配，不能拿第 1 季的弹幕顶替
    const pick = sn > 1 ? withEp.find((a) => seasonRe(sn).test(a.animeTitle || '')) : withEp[0];
    epId = pick?.episodes?.[0]?.episodeId || 0;
  } catch { /* 走 match */ }
  if (!epId) {
    const name = episode ? `${anime} S${String(sn).padStart(2, '0')}E${String(episode).padStart(2, '0')}` : anime;
    const r = await api<{ matches?: { episodeId: number }[] }>(cfg, '/api/v2/match', { method: 'POST', body: { fileName: name, matchMode: 'fileNameOnly' } });
    epId = r.matches?.[0]?.episodeId || 0;
  }
  if (!epId) throw new Error('没有匹配到这部片的弹幕');
  const c = await api<{ comments?: { p: string; m: string }[] }>(cfg, `/api/v2/comment/${epId}?withRelated=true&chConvert=0`);
  const list: Dm[] = (c.comments || []).map((x) => {
    const [t, m, col] = x.p.split(',');
    const mode: Dm['mode'] = m === '4' ? 'bottom' : m === '5' ? 'top' : 'scroll';
    return { t: Number(t) || 0, mode, color: hex(Number(col) || 0xffffff), text: x.m };
  }).filter((d) => d.text).sort((a, b) => a.t - b.t);
  cache.set(key, list);
  return list;
}
