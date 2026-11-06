// 二级分类：规则沿用 MoviePilot v2 默认的 category.yaml（自上而下，命中第一条即止）。
// 数据来自 TMDB；结果缓存在本机，之后即使连不上 TMDB 也能识别；没识别到的归「未识别」。
import { tmdbBrief, tmdbReady, type TmdbBrief } from './tmdb';

export const UNKNOWN = '未识别';
const KEY = 'wemby-category';

type Rule = { name: string; genres?: number[]; countries?: string[]; langs?: string[] };
const TV_RULES: Rule[] = [
  { name: '国漫', genres: [16], countries: ['CN', 'TW', 'HK'] },
  { name: '日番', genres: [16], countries: ['JP'] },
  { name: '纪录片', genres: [99] },
  { name: '儿童', genres: [10762] },
  { name: '综艺', genres: [10764, 10767] },
  { name: '国产剧', countries: ['CN', 'TW', 'HK'] },
  { name: '欧美剧', countries: ['US', 'FR', 'GB', 'DE', 'ES', 'IT', 'NL', 'PT', 'RU', 'UK'] },
  { name: '日韩剧', countries: ['JP', 'KP', 'KR', 'TH', 'IN', 'SG'] },
];
const MOVIE_RULES: Rule[] = [
  { name: '动画电影', genres: [16] },
  { name: '华语电影', langs: ['zh', 'bo', 'za'] },
];

export function classify(media: 'movie' | 'tv', b: TmdbBrief): string {
  for (const r of media === 'tv' ? TV_RULES : MOVIE_RULES) {
    if (r.genres && !r.genres.some((g) => b.genres.includes(g))) continue;
    if (r.countries && !r.countries.some((c) => b.countries.includes(c))) continue;
    if (r.langs && !r.langs.includes(b.lang)) continue;
    return r.name;
  }
  return media === 'tv' ? '未分类' : '外语电影';
}

let mem: Record<string, string> | null = null;
function store(): Record<string, string> {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, string>; } catch { mem = {}; }
  return mem;
}
let saveT = 0;
function persist(): void {
  window.clearTimeout(saveT);
  saveT = window.setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(store())); } catch { /* ignore */ } }, 500);
}

export interface CatItem { Type: string; ProviderIds?: Record<string, string> }
function keyOf(it: CatItem): string {
  const id = it.ProviderIds?.Tmdb || it.ProviderIds?.tmdb;
  return id ? `${it.Type === 'Movie' ? 'movie' : 'tv'}:${id}` : '';
}
/** 只读缓存：没缓存 / 没有 TMDB 编号 → 未识别 */
export function categoryOf(it: CatItem): string {
  const k = keyOf(it);
  return (k && store()[k]) || UNKNOWN;
}

let running = false;
/** 后台补全：只查缓存里没有的；连不上 TMDB 就停（下次进来再试） */
export async function classifyMissing(items: CatItem[], onProgress: () => void): Promise<void> {
  if (running || !tmdbReady()) return;
  const todo = items.filter((it) => { const k = keyOf(it); return k && !store()[k]; });
  if (!todo.length) return;
  running = true;
  let fails = 0;
  let i = 0;
  const worker = async (): Promise<void> => {
    while (i < todo.length && fails < 3) {
      const it = todo[i++];
      const k = keyOf(it);
      const [m, id] = k.split(':') as ['movie' | 'tv', string];
      try {
        store()[k] = classify(m, await tmdbBrief(m, Number(id)));
        fails = 0;
        persist();
        if (i % 6 === 0) onProgress();
      } catch (e) {
        if (/404/.test(String((e as Error)?.message))) store()[k] = m === 'tv' ? '未分类' : '外语电影';
        else fails++;
      }
    }
  };
  try { await Promise.all([worker(), worker(), worker(), worker()]); } finally { running = false; persist(); onProgress(); }
}
