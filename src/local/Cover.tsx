// 封面：先显示渐变色，进入视野后再去群晖取缩略图。取不到就一直是渐变色 + 标题。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { coverStyle, dsmCover } from './dsm';

export default function Cover({ path, title, className, children, plain }: { path: string; title: string; className: string; children?: ReactNode; plain?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState('');
  useEffect(() => {
    setUrl('');
    const el = ref.current;
    if (!el || !path) return;
    let dead = false;
    const go = (): void => { void dsmCover(path).then((u) => { if (!dead && u) setUrl(u); }); };
    if (typeof IntersectionObserver === 'undefined') { go(); return () => { dead = true; }; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => { dead = true; io.disconnect(); };
  }, [path]);
  const st = url ? { background: `center / cover no-repeat url("${url}"), #111` } : coverStyle(title);
  return (
    <div ref={ref} className={className} style={st}>
      {!url && (plain ? <span>{title}</span> : <span className="lc-th-t">{title}</span>)}
      {children}
    </div>
  );
}
