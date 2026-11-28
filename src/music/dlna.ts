// DLNA / UPnP 投屏（音乐）：协议层。只依赖 httpFetch 与原生的 SSDP 搜索，不碰播放器状态。
//  · 搜索：原生发 SSDP 组播（桌面 = Rust ssdp_search；安卓 = Kotlin AndroidDlna），这里解析回应
//  · 设备描述：取 LOCATION 的 XML，找出 AVTransport / RenderingControl 的控制地址
//  · 控制：SOAP（SetAVTransportURI / Play / Pause / Seek / GetPositionInfo / GetTransportInfo / 音量）
// XML 只用正则取标签，不依赖 DOMParser，方便在 node 里直接测。
import { httpFetch, isTauri } from '../emby/http';
import { isAndroid, isIOS } from '../lib/platform';

export interface DlnaDevice {
  /** 设备唯一标识（UDN，取不到就用描述地址） */
  id: string;
  name: string;
  model: string;
  location: string;
  avt: string;      // AVTransport 控制地址（绝对）
  avtType: string;  // 完整的 serviceType，比如 urn:schemas-upnp-org:service:AVTransport:1
  rc: string;       // RenderingControl 控制地址（可能为空：设备不支持远程调音量）
  rcType: string;
}

export class DlnaError extends Error {
  /** UPnP 错误码（701 转换不可用、714 格式不支持、716 找不到资源……），网络错误为 0 */
  code: number;
  constructor(msg: string, code = 0) { super(msg); this.code = code; }
}

// ───────── 小工具（导出给测试用）─────────
export const xmlEsc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export const xmlUnesc = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
/** 取第一个 <tag>…</tag> 的内容（忽略命名空间前缀与属性），没有返回空串 */
export function tagText(xml: string, tag: string): string {
  const m = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?${tag}>`, 'i').exec(xml);
  if (!m) return '';
  return xmlUnesc(m[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim());
}
/** "H:MM:SS(.fff)" → 秒；NOT_IMPLEMENTED / 空 / 乱写 → 0 */
export function parseHms(s: string): number {
  const m = /^\s*(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s*$/.exec(s || '');
  if (!m) return 0;
  const v = Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(v) ? v : 0;
}
export function fmtHms(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${Math.floor(t / 3600)}:${p(Math.floor(t / 60) % 60)}:${p(t % 60)}`;
}

// ───────── 搜索 ─────────
type AndroidDlnaNative = { search(id: string, ms: number): void };
type DlnaWin = Window & { AndroidDlna?: AndroidDlnaNative; __dlnaDone?: (id: string, json: string) => void };
const waiters = new Map<string, (v: string) => void>();
let seq = 0;

/** 这个环境能不能搜索 / 投屏（浏览器调试、iOS 不行） */
export function dlnaAvailable(): boolean {
  if (!isTauri() || isIOS) return false;
  if (isAndroid) return !!(window as DlnaWin).AndroidDlna;
  return true;
}

async function ssdpRaw(ms: number): Promise<string[]> {
  if (isAndroid) {
    const w = window as DlnaWin;
    if (!w.AndroidDlna) throw new DlnaError('这个版本的 App 还不支持投屏（需要更新安装包）');
    w.__dlnaDone ??= (id, json) => { const f = waiters.get(id); waiters.delete(id); f?.(json); };
    const id = `d${++seq}`;
    const done = new Promise<string>((res) => waiters.set(id, res));
    w.AndroidDlna.search(id, ms);
    const r = JSON.parse(await done) as { error?: string; list?: string[] };
    if (r.error) throw new DlnaError(r.error);
    return r.list || [];
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke<string[]>('ssdp_search', { timeoutMs: ms })) || [];
}

/** 解析一条 SSDP 回应，取 LOCATION（没有就返回空） */
export function parseSsdp(raw: string): { location: string; st: string; usn: string } {
  const h = (k: string): string => new RegExp(`^${k}:[ \\t]*(.*)$`, 'im').exec(raw)?.[1]?.trim() || '';
  return { location: h('location'), st: h('st'), usn: h('usn') };
}

const decl = (type: string, name: string): boolean => new RegExp(`:service:${name}:`, 'i').test(type);

/** 从设备描述 XML 里取出渲染设备信息；不是「能播放」的设备（没有 AVTransport）返回 null */
export function parseDesc(xml: string, location: string): DlnaDevice | null {
  const base = tagText(xml, 'URLBase') || location;
  const abs = (u: string): string => { try { return new URL(u, base).toString(); } catch { return ''; } };
  let avt = '', avtType = '', rc = '', rcType = '';
  for (const m of xml.matchAll(/<service>([\s\S]*?)<\/service>/gi)) {
    const type = tagText(m[1], 'serviceType');
    const url = abs(tagText(m[1], 'controlURL'));
    if (!type || !url) continue;
    if (decl(type, 'AVTransport') && !avt) { avt = url; avtType = type; }
    else if (decl(type, 'RenderingControl') && !rc) { rc = url; rcType = type; }
  }
  if (!avt) return null;
  const udn = tagText(xml, 'UDN');
  return { id: udn || location, name: tagText(xml, 'friendlyName') || '未命名设备', model: tagText(xml, 'modelName'), location, avt, avtType, rc, rcType };
}

async function getText(url: string, ms: number): Promise<string> {
  const ctl = new AbortController();
  const tm = window.setTimeout(() => ctl.abort(), ms);
  try {
    const r = await httpFetch(url, { signal: ctl.signal });
    if (!r.ok) throw new DlnaError(`设备描述返回 ${r.status}`);
    return await r.text();
  } finally { window.clearTimeout(tm); }
}

/** 搜索局域网里的 DLNA 渲染设备（电视 / 音箱 / 功放等）。同一台设备多条回应只留一条 */
export async function discover(ms = 3000): Promise<DlnaDevice[]> {
  const raw = await ssdpRaw(ms);
  const locs = new Set<string>();
  for (const r of raw) { const l = parseSsdp(r).location; if (/^https?:\/\//i.test(l)) locs.add(l); }
  const found = await Promise.all([...locs].map(async (l) => { try { return parseDesc(await getText(l, 4000), l); } catch { return null; } }));
  const byId = new Map<string, DlnaDevice>();
  for (const d of found) if (d && !byId.has(d.id)) byId.set(d.id, d);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

// ───────── SOAP ─────────
async function soap(url: string, type: string, action: string, args: [string, string][], ms = 6000): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${type}">${args.map(([k, v]) => `<${k}>${xmlEsc(v)}</${k}>`).join('')}</u:${action}></s:Body></s:Envelope>`;
  const ctl = new AbortController();
  const tm = window.setTimeout(() => ctl.abort(), ms);
  let res: Response;
  try {
    res = await httpFetch(url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${type}#${action}"` }, body, signal: ctl.signal });
  } catch (e) {
    throw new DlnaError(ctl.signal.aborted ? `设备没有响应（${action}）` : `连不上设备（${e instanceof Error ? e.message : String(e)}）`);
  } finally { window.clearTimeout(tm); }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    const code = Number(tagText(text, 'errorCode')) || 0;
    throw new DlnaError(tagText(text, 'errorDescription') || `设备返回 ${res.status}（${action}）`, code);
  }
  return text;
}

/** 常见格式的 MIME；转码模式固定 audio/mpeg */
export function mimeOf(suffix: string, transcoded: boolean): string {
  if (transcoded) return 'audio/mpeg';
  switch ((suffix || '').toLowerCase()) {
    case 'flac': return 'audio/flac';
    case 'mp3': return 'audio/mpeg';
    case 'm4a': case 'mp4': case 'alac': return 'audio/mp4';
    case 'aac': return 'audio/aac';
    case 'ogg': case 'oga': case 'opus': return 'audio/ogg';
    case 'wav': return 'audio/wav';
    case 'wma': return 'audio/x-ms-wma';
    case 'ape': return 'audio/x-ape';
    default: return 'audio/mpeg';
  }
}

export interface CastMeta { title: string; artist: string; album: string; cover?: string; duration?: number; mime: string }
/** DIDL-Lite 元数据（设备据此显示歌名 / 歌手 / 封面，也要靠 protocolInfo 判断能不能播） */
export function buildDidl(url: string, m: CastMeta): string {
  const d = m.duration && m.duration > 0 ? ` duration="${fmtHms(m.duration)}"` : '';
  return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1"><dc:title>${xmlEsc(m.title)}</dc:title><dc:creator>${xmlEsc(m.artist)}</dc:creator><upnp:artist>${xmlEsc(m.artist)}</upnp:artist><upnp:album>${xmlEsc(m.album)}</upnp:album>${m.cover ? `<upnp:albumArtURI>${xmlEsc(m.cover)}</upnp:albumArtURI>` : ''}<upnp:class>object.item.audioItem.musicTrack</upnp:class><res protocolInfo="http-get:*:${m.mime}:DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000"${d}>${xmlEsc(url)}</res></item></DIDL-Lite>`;
}

export type TransportState = 'PLAYING' | 'PAUSED_PLAYBACK' | 'STOPPED' | 'TRANSITIONING' | 'NO_MEDIA_PRESENT' | 'ERROR_OCCURRED' | string;

/** 一台设备的控制接口（InstanceID 固定 0，音乐投屏够用） */
export class DlnaRenderer {
  constructor(readonly dev: DlnaDevice) {}
  private av(action: string, args: [string, string][] = [], ms?: number): Promise<string> {
    return soap(this.dev.avt, this.dev.avtType, action, [['InstanceID', '0'], ...args], ms);
  }
  setUri(url: string, didl: string): Promise<string> { return this.av('SetAVTransportURI', [['CurrentURI', url], ['CurrentURIMetaData', didl]], 8000); }
  play(): Promise<string> { return this.av('Play', [['Speed', '1']]); }
  pause(): Promise<string> { return this.av('Pause'); }
  stop(): Promise<string> { return this.av('Stop'); }
  seek(sec: number): Promise<string> { return this.av('Seek', [['Unit', 'REL_TIME'], ['Target', fmtHms(sec)]]); }
  async state(): Promise<TransportState> { return tagText(await this.av('GetTransportInfo', [], 4000), 'CurrentTransportState') || 'STOPPED'; }
  async position(): Promise<{ pos: number; dur: number }> {
    const x = await this.av('GetPositionInfo', [], 4000);
    return { pos: parseHms(tagText(x, 'RelTime')), dur: parseHms(tagText(x, 'TrackDuration')) };
  }
  async getVolume(): Promise<number | null> {
    if (!this.dev.rc) return null;
    try {
      const x = await soap(this.dev.rc, this.dev.rcType, 'GetVolume', [['InstanceID', '0'], ['Channel', 'Master']], 4000);
      const v = Number(tagText(x, 'CurrentVolume'));
      return Number.isFinite(v) ? v : null;
    } catch { return null; }
  }
  async setVolume(v: number): Promise<void> {
    if (!this.dev.rc) throw new DlnaError('这台设备不支持远程调节音量');
    await soap(this.dev.rc, this.dev.rcType, 'SetVolume', [['InstanceID', '0'], ['Channel', 'Master'], ['DesiredVolume', String(Math.round(Math.min(100, Math.max(0, v))))]], 4000);
  }
}
