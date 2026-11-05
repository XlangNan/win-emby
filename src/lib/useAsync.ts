import { useCallback, useEffect, useRef, useState } from 'react';

/** 简单的异步加载 hook：依赖变化重新加载，卸载后丢弃结果 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): {
  data: T | null;
  loading: boolean;
  error: string;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let dead = false;
    setLoading(true);
    setError('');
    fnRef
      .current()
      .then((d) => {
        if (!dead) setData(d);
      })
      .catch((e: unknown) => {
        if (!dead) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!dead) setLoading(false);
      });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, loading, error, reload };
}

const store = new Map<string, { data: unknown; at: number }>();

/** 带缓存的异步加载：数据缓存在内存里，再次进入页面时先显示缓存，没过期（ttl）就不重新请求 */
export function useCachedAsync<T>(key: string, fn: () => Promise<T>, ttlMs = 10 * 60 * 1000): {
  data: T | null;
  loading: boolean;
  error: string;
  reload: () => void;
} {
  const hit = store.get(key) as { data: T; at: number } | undefined;
  const [data, setData] = useState<T | null>(hit ? hit.data : null);
  const [loading, setLoading] = useState(!hit);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const c = store.get(key) as { data: T; at: number } | undefined;
    if (c) setData(c.data);
    if (c && tick === 0 && Date.now() - c.at < ttlMs) {
      setLoading(false);
      return;
    }
    let dead = false;
    if (!c) setLoading(true);
    setError('');
    fnRef
      .current()
      .then((d) => {
        store.set(key, { data: d, at: Date.now() });
        if (!dead) setData(d);
      })
      .catch((e: unknown) => {
        if (!dead) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!dead) setLoading(false);
      });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, loading, error, reload };
}
