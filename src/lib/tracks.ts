// 起播前决定用哪条音轨 / 字幕：上次用过的 > 设置里的默认语言 > 文件自带默认
import type { MediaStream } from '../emby/types';
import { getTrackMemory, type PlayPrefs } from './prefs';

const LANG_ALIASES: Record<string, string[]> = {
  chi: ['chi', 'zho', 'chs', 'cht', 'cmn', 'zh'],
  yue: ['yue', 'can'],
  eng: ['eng', 'en'],
  jpn: ['jpn', 'ja'],
  kor: ['kor', 'ko'],
};

const matchLang = (s: MediaStream, want: string): boolean => {
  const l = (s.Language || '').toLowerCase();
  if (!l) return false;
  return (LANG_ALIASES[want] || [want]).includes(l);
};

export interface InitialTracks {
  /** 选中的音轨（Emby MediaStream.Index），undefined = 让播放器用默认 */
  audio?: number;
  /** 选中的字幕：Emby Index；-1 = 关闭；undefined = 让播放器用默认 */
  sub?: number;
}

export function pickInitialTracks(itemId: string, streams: MediaStream[], prefs: PlayPrefs, override?: InitialTracks): InitialTracks {
  const audios = streams.filter((s) => s.Type === 'Audio');
  const subs = streams.filter((s) => s.Type === 'Subtitle');
  const out: InitialTracks = {};
  const mem = prefs.rememberTracks ? getTrackMemory(itemId) : undefined;

  if (mem?.audio != null && audios.some((a) => a.Index === mem.audio)) out.audio = mem.audio;
  else if (prefs.audioLang) out.audio = audios.find((a) => matchLang(a, prefs.audioLang))?.Index;

  if (mem?.sub != null && (mem.sub === -1 || subs.some((s) => s.Index === mem.sub))) out.sub = mem.sub;
  else if (prefs.subLang === 'off') out.sub = -1;
  else if (prefs.subLang) {
    // 同语言里优先非「强制」字幕
    const hit = subs.filter((s) => matchLang(s, prefs.subLang));
    out.sub = (hit.find((s) => !s.IsForced) || hit[0])?.Index;
  }
  if (override?.audio != null && audios.some((a) => a.Index === override.audio)) out.audio = override.audio;
  if (override?.sub != null && (override.sub === -1 || subs.some((x) => x.Index === override.sub))) out.sub = override.sub;
  return out;
}
