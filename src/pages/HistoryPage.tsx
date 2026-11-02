// 观看历史 = Emby 账号里「已播放」的内容，按最近观看排序（与其它 Emby 客户端互通）
import { useNavigate } from 'react-router-dom';
import ListPage from './ListPage';
import { emby } from '../emby/client';

export default function HistoryPage() {
  const nav = useNavigate();
  return (
    <ListPage
      title="观看历史"
      empty="暂无观看记录 —— 播放任意影片后会自动出现在这里"
      deps={[]}
      load={(start, limit) =>
        emby.items({ types: 'Movie,Episode', filters: 'IsPlayed', sortBy: 'DatePlayed', sortOrder: 'Descending', start, limit })
      }
      onOpen={(it) => nav(`/detail/${it.Type === 'Episode' && it.SeriesId ? it.SeriesId : it.Id}`)}
    />
  );
}
