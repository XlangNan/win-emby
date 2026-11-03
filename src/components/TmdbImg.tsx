// TMDB 图片：进入可视区才加载（走设置里的代理），加载前显示占位
import { useEffect, useRef, useState } from 'react';
import { tmdbImage } from '../lib/tmdb';

export default function TmdbImg({ path, size, className, style }: { path?: string; size?: string; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [src, setSrc] = useState('');

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setSeen(true), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  useEffect(() => {
    let dead = false;
    setSrc('');
    if (seen && path) tmdbImage(path, size).then((u) => !dead && setSrc(u)).catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [seen, path, size]);

  if (src) return <img src={src} className={className} style={style} alt="" decoding="async" />;
  return <div ref={ref} className={`mp-ph ${className || ''}`} style={style}>{path ? '' : '暂无'}</div>;
}
