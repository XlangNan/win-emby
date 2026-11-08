// 观看历史 = Emby 账号里「已播放」的内容，按最近观看排序；剧集合并为一张剧集海报
import { useNavigate } from 'react-router-dom';
import ListPage from './ListPage';
import { emby } from '../emby/client';
import type { ItemsResult } from '../emby/types';

async function loadHistory(start: number): Promise<ItemsResult> {
  if (start > 0) return { Items: [], TotalRecordCount: 0 };
  // 看完的 + 看到一半的（可续播）合在一起，按最近观看时间排
  const [done, half] = await Promise.all([
    emby.items({ types: 'Movie,Episode', filters: 'IsPlayed', sortBy: 'DatePlayed', sortOrder: 'Descending', start: 0, limit: 500 }),
    emby.items({ types: 'Movie,Episode', filters: 'IsResumable', sortBy: 'DatePlayed', sortOrder: 'Descending', start: 0, limit: 100 }).catch(() => ({ Items: [], TotalRecordCount: 0 } as ItemsResult)),
  ]);
  const have = new Set(done.Items.map((i) => i.Id));
  const all = [...done.Items, ...half.Items.filter((i) => !have.has(i.Id))];
  all.sort((a, b) => String(b.UserData?.LastPlayedDate || '').localeCompare(String(a.UserData?.LastPlayedDate || '')));
  const r: ItemsResult = { Items: all, TotalRecordCount: all.length };
  const order: string[] = [];
  const seen = new Set<string>();
  for (const it of r.Items) {
    const id = it.Type === 'Episode' && it.SeriesId ? it.SeriesId : it.Id;
    if (!seen.has(id)) { seen.add(id); order.push(id); }
  }
  const movies = new Map(r.Items.filter((i) => i.Type !== 'Episode' || !i.SeriesId).map((i) => [i.Id, i]));
  const sids = order.filter((id) => !movies.has(id));
  const series = new Map<string, (typeof r.Items)[number]>();
  for (let i = 0; i < sids.length; i += 50) {
    const sr = await emby.items({ ids: sids.slice(i, i + 50).join(','), types: 'Series', start: 0, limit: 50 });
    sr.Items.forEach((x) => series.set(x.Id, x));
  }
  const Items = order.map((id) => movies.get(id) || series.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
  return { Items, TotalRecordCount: Items.length };
}

export default function HistoryPage() {
  const nav = useNavigate();
  return (
    <ListPage
      title="观看历史"
      empty="暂无观看记录 —— 播放任意影片后会自动出现在这里"
      deps={[]}
      load={(start) => loadHistory(start)}
      onOpen={(it) => nav(`/detail/${it.Id}`)}
    />
  );
}
