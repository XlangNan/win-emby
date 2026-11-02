import { useSearchParams } from 'react-router-dom';
import ListPage from './ListPage';
import { emby } from '../emby/client';

export default function SearchPage() {
  const [sp] = useSearchParams();
  const q = (sp.get('q') || '').trim();
  return (
    <ListPage
      title={`搜索：${q}`}
      empty={`没有匹配「${q}」的内容`}
      deps={[q]}
      load={(start, limit) =>
        q
          ? emby.items({ search: q, types: 'Movie,Series,BoxSet', sortBy: 'SortName', start, limit })
          : Promise.resolve({ Items: [], TotalRecordCount: 0 })
      }
    />
  );
}
