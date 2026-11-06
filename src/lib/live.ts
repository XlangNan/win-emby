// 电视直播：M3U / M3U8 订阅源管理 + 解析。源和收藏都只存本机 localStorage。
import { httpFetch } from '../emby/http';

export interface LiveSource {
  id: string;
  name: string;
  /** 订阅链接；本地导入的文件为空 */
  url: string;
}

export interface LiveLine {
  url: string;
  source: string;
}

export interface LiveChannel {
  /** 频道名（同名的多条线路合并成一个频道） */
  name: string;
  group: string;
  logo: string;
  /** M3U 里的 tvg-id，用来匹配节目单 */
  tvgId?: string;
  lines: LiveLine[];
}

const SKEY = 'wemby-live-sources';
const CKEY = 'wemby-live-cache:';
const FKEY = 'wemby-live-fav';

function readJson<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
}
function writeJson(key: string, v: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export const listSources = (): LiveSource[] => readJson<LiveSource[]>(SKEY, []);
export const saveSources = (l: LiveSource[]): void => {
  writeJson(SKEY, l);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('wemby-live-changed'));
};

export const loadFavs = (): string[] => readJson<string[]>(FKEY, []);
export function toggleFav(name: string): string[] {
  const f = loadFavs();
  const next = f.includes(name) ? f.filter((x) => x !== name) : [...f, name];
  writeJson(FKEY, next);
  return next;
}

interface RawCh { name: string; group: string; logo: string; url: string; tvgId?: string }

/** 解析 M3U（#EXTINF 格式）；也兼容「频道名,URL」的 txt 格式 */
export function parseM3U(text: string): RawCh[] {
  const out: RawCh[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let meta: { name: string; group: string; logo: string; tvgId?: string } | null = null;
  let txtGroup = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#EXTM3U')) continue;
    if (line.startsWith('#EXTINF')) {
      const attr = (k: string): string => new RegExp(`${k}="([^"]*)"`, 'i').exec(line)?.[1] || '';
      const name = line.includes(',') ? line.slice(line.lastIndexOf(',') + 1).trim() : '';
      meta = { name: name || attr('tvg-name'), group: attr('group-title'), logo: attr('tvg-logo'), tvgId: attr('tvg-id') || undefined };
    } else if (line.startsWith('#EXTGRP:')) {
      if (meta && !meta.group) meta.group = line.slice(8).trim();
    } else if (line.startsWith('#')) {
      continue;
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line) && meta) {
      out.push({ ...meta, url: line });
      meta = null;
    } else if (!meta) {
      // txt：「分组,#genre#」「频道名,URL」
      const i = line.indexOf(',');
      if (i > 0) {
        const left = line.slice(0, i).trim();
        const right = line.slice(i + 1).trim();
        if (right === '#genre#') txtGroup = left;
        else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(right)) out.push({ name: left, group: txtGroup, logo: '', url: right });
      }
    }
  }
  return out;
}

/** 多个源的原始频道 → 按频道名合并线路 */
function merge(all: { src: string; ch: RawCh[] }[]): LiveChannel[] {
  const map = new Map<string, LiveChannel>();
  for (const { src, ch } of all) {
    for (const c of ch) {
      if (!c.name) continue;
      let e = map.get(c.name);
      if (!e) {
        e = { name: c.name, group: c.group || '未分组', logo: c.logo, tvgId: c.tvgId, lines: [] };
        map.set(c.name, e);
      }
      if (!e.logo && c.logo) e.logo = c.logo;
      if (!e.lines.some((l) => l.url === c.url)) e.lines.push({ url: c.url, source: src });
    }
  }
  return [...map.values()];
}

export async function fetchSource(s: LiveSource): Promise<string> {
  const res = await httpFetch(s.url, { headers: { Accept: '*/*' } });
  if (!res.ok) throw new Error(`${s.name}：下载失败 ${res.status}`);
  return res.text();
}

/** 缓存解析后的原始频道，避免每次进页面都重新下载 */
export function cacheSource(id: string, text: string): number {
  const ch = parseM3U(text);
  writeJson(CKEY + id, ch);
  // 订阅头里带了节目单地址（x-tvg-url）且还没设置过 → 自动填上
  const g = /(?:x-tvg-url|url-tvg)="([^"]+)"/i.exec(text.slice(0, 2000))?.[1]?.split(',')[0];
  try { if (g && !localStorage.getItem('wemby-epg-url')) localStorage.setItem('wemby-epg-url', g.trim()); } catch { /* ignore */ }
  return ch.length;
}

export function removeCache(id: string): void {
  try {
    localStorage.removeItem(CKEY + id);
  } catch {
    /* ignore */
  }
}

export function loadChannels(): LiveChannel[] {
  const srcs = listSources();
  return merge(srcs.map((s) => ({ src: s.name, ch: readJson<RawCh[]>(CKEY + s.id, []) })));
}

export async function refreshSource(s: LiveSource): Promise<number> {
  if (!s.url) return readJson<RawCh[]>(CKEY + s.id, []).length;
  return cacheSource(s.id, await fetchSource(s));
}

export const newId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
