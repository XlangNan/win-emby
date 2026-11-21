// 「更多类似内容 · 查看全部」：某部影片的完整相似列表（网格）
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import ListPage from './ListPage';
import { emby } from '../emby/client';

export default function SimilarPage() {
  const { id = '' } = useParams();
  const [name, setName] = useState('');
  useEffect(() => {
    setName('');
    if (!id) return;
    let dead = false;
    emby.item(id).then((r) => !dead && setName(r.Name || '')).catch(() => undefined);
    return () => { dead = true; };
  }, [id]);
  return (
    <ListPage
      title={name ? `与「${name}」相似` : '更多类似内容'}
      empty="没有找到相似的内容"
      deps={[id]}
      load={async (start) => {
        if (start > 0) return { Items: [], TotalRecordCount: 0 };   // 相似接口一次取完
        const items = await emby.similar(id, 60);
        return { Items: items, TotalRecordCount: items.length };
      }}
    />
  );
}
