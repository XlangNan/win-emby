// 歌词：本机覆盖 > 服务器歌词。播放页和底部播放条共用一份缓存。
import { useEffect, useState } from 'react';
import { nd, parseLrc, type Song } from './navidrome';
import { getLrcOverride, setLrcOverride, useOverrideVer } from './overrides';
import { fetchLyric, onlineConfigured, searchOnline } from './online';
import { loadOpts } from './prefs';

export type Lyr = { synced: boolean; lines: { t: number; text: string }[] };
const cache = new Map<string, Lyr>();
const pending = new Map<string, Promise<Lyr>>();

export function invalidateLyrics(id: string): void { cache.delete(id); pending.delete(id); }

const tried = new Set<string>();
const norm = (t: string): string => t.toLowerCase().replace(/[\s·.\-_()（）\[\]【】'"]/g, '');
/** 自动匹配：取搜索结果里歌名对得上的第一条，成功后存为本机歌词；每首歌每次运行只试一次 */
async function autoOnline(s: Song): Promise<Lyr | null> {
  if (!loadOpts().autoLyric || !onlineConfigured() || tried.has(s.id)) return null;
  tried.add(s.id);
  try {
    const hits = await searchOnline(`${s.title} ${s.artist}`.trim());
    const t = norm(s.title);
    const h = hits.find((x) => norm(x.title) === t) || hits.find((x) => norm(x.title).includes(t) || t.includes(norm(x.title)));
    if (!h) return null;
    const text = await fetchLyric(h);
    const r = parseLrc(text);
    if (!r.lines.length) return null;
    setLrcOverride(s.id, text);
    return r;
  } catch { return null; }
}

function load(s: Song): Promise<Lyr> {
  const hit = cache.get(s.id);
  if (hit) return Promise.resolve(hit);
  const ov = getLrcOverride(s.id);
  if (ov) { const r = parseLrc(ov); cache.set(s.id, r); return Promise.resolve(r); }
  let p = pending.get(s.id);
  if (!p) {
    p = nd.lyrics(s).then(async (r) => {
      if (!r.lines.length) r = (await autoOnline(s)) || r;   // 服务器没有歌词：自动去在线来源找
      cache.set(s.id, r);
      return r;
    }).finally(() => pending.delete(s.id));
    pending.set(s.id, p);
  }
  return p;
}

export function useLyrics(s: Song | null): Lyr | null {
  const [l, setL] = useState<Lyr | null>(null);
  const ver = useOverrideVer();
  useEffect(() => { if (s) invalidateLyrics(s.id); }, [ver]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!s) { setL(null); return; }
    const hit = cache.get(s.id);
    if (hit) { setL(hit); return; }
    setL(null);
    let dead = false;
    load(s).then((r) => { if (!dead) setL(r); }).catch(() => { if (!dead) setL({ synced: false, lines: [] }); });
    return () => { dead = true; };
  }, [s?.id, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  return l;
}

/** 当前播放到第几行（-1 = 还没到第一句 / 不是逐行歌词） */
export function activeLine(l: Lyr | null, pos: number): number {
  if (!l?.synced) return -1;
  let a = -1;
  for (let i = 0; i < l.lines.length; i++) { if (l.lines[i].t <= pos + 0.25) a = i; else break; }
  return a;
}

/** 把当前歌词还原成 LRC 文本（给编辑框用） */
export function toLrc(l: Lyr | null): string {
  if (!l) return '';
  return l.lines.map((x) => {
    if (!l.synced) return x.text;
    const m = Math.floor(x.t / 60), s = (x.t % 60).toFixed(2).padStart(5, '0');
    return `[${String(m).padStart(2, '0')}:${s}]${x.text}`;
  }).join('\n');
}
