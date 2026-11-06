// 电子节目单（XMLTV）：下载 → 解析 → 只留近期节目缓存在本机；按 tvg-id 或频道名匹配直播频道。
import { httpFetch } from '../emby/http';
import type { LiveChannel } from './live';

const UKEY = 'wemby-epg-url';
const DKEY = 'wemby-epg-data';
export interface Prog { s: number; e: number; t: string; d?: string }
interface Data { at: number; ch: Record<string, { n: string[]; p: Prog[] }> }

export const getEpgUrl = (): string => { try { return localStorage.getItem(UKEY) || ''; } catch { return ''; } };
export const setEpgUrl = (u: string): void => { try { localStorage.setItem(UKEY, u.trim()); } catch { /* ignore */ } };

let mem: Data | null = null;
let index: Map<string, string> | null = null;
const norm = (s: string): string => s.toLowerCase().replace(/[\s\-_·.()（）\[\]]/g, '').replace(/高清|超清|标清|hd|fhd|uhd|4k/g, '');

function load(): Data | null {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(DKEY) || 'null') as Data | null; } catch { mem = null; }
  return mem;
}
function buildIndex(d: Data): Map<string, string> {
  const m = new Map<string, string>();
  for (const [id, c] of Object.entries(d.ch)) {
    m.set(id.toLowerCase(), id);
    for (const n of c.n) m.set(norm(n), id);
  }
  return m;
}
export const epgAt = (): number => load()?.at || 0;
export const epgChannels = (): number => Object.keys(load()?.ch || {}).length;

/** "20241106180000 +0800" → 毫秒时间戳 */
function ts(v: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(v.trim());
  if (!m) return NaN;
  const off = m[7] ? (m[7][0] === '-' ? -1 : 1) * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(3, 5))) : 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - off * 60000;
}

async function readText(res: Response): Promise<string> {
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    const out = new Response(new Blob([buf]).stream().pipeThrough(ds));
    return out.text();
  }
  return new TextDecoder('utf-8').decode(buf);
}

export async function refreshEpg(url = getEpgUrl()): Promise<number> {
  if (!url) throw new Error('还没填节目单地址');
  const res = await httpFetch(url, { headers: { Accept: '*/*' } });
  if (!res.ok) throw new Error(`节目单下载失败 ${res.status}`);
  const doc = new DOMParser().parseFromString(await readText(res), 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('节目单不是有效的 XMLTV 文件');
  const d: Data = { at: Date.now(), ch: {} };
  doc.querySelectorAll('channel').forEach((c) => {
    const id = c.getAttribute('id');
    if (id) d.ch[id] = { n: [...c.querySelectorAll('display-name')].map((x) => x.textContent || '').filter(Boolean), p: [] };
  });
  const from = Date.now() - 4 * 3600e3, to = Date.now() + 60 * 3600e3;
  doc.querySelectorAll('programme').forEach((p) => {
    const c = d.ch[p.getAttribute('channel') || ''];
    if (!c) return;
    const s = ts(p.getAttribute('start') || ''), e = ts(p.getAttribute('stop') || '');
    if (!(e > from && s < to)) return;
    c.p.push({ s, e, t: p.querySelector('title')?.textContent || '', d: p.querySelector('desc')?.textContent?.slice(0, 200) || undefined });
  });
  for (const c of Object.values(d.ch)) c.p.sort((a, b) => a.s - b.s);
  mem = d; index = null;
  try { localStorage.setItem(DKEY, JSON.stringify(d)); } catch { /* 太大存不下就只放内存 */ }
  return Object.keys(d.ch).length;
}

export function progsOf(ch: LiveChannel): Prog[] {
  const d = load();
  if (!d) return [];
  index ??= buildIndex(d);
  const id = (ch.tvgId && index.get(ch.tvgId.toLowerCase())) || index.get(norm(ch.name));
  return id ? d.ch[id].p : [];
}
export function nowNext(ch: LiveChannel, at = Date.now()): { now?: Prog; next?: Prog } {
  const p = progsOf(ch);
  const i = p.findIndex((x) => x.s <= at && at < x.e);
  return i >= 0 ? { now: p[i], next: p[i + 1] } : { next: p.find((x) => x.s > at) };
}
export const hhmm = (t: number): string => new Date(t).toTimeString().slice(0, 5);
