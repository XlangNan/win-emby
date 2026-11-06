// 追更服务的图片（需要登录才能取）：带认证头取回后显示
import { useEffect, useState } from 'react';
import { kgImage } from '../lib/kg';

export default function KgImg({ path, className, style }: { path?: string; className?: string; style?: React.CSSProperties }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let dead = false;
    setSrc('');
    if (path) kgImage(path).then((u) => !dead && setSrc(u)).catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [path]);
  return src ? <img src={src} className={className} style={style} alt="" decoding="async" /> : <div className={`no-cover ${className || ''}`} style={style}>{path ? '' : '暂无封面'}</div>;
}
