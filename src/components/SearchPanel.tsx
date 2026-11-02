// 搜索入口：沿用原 .srcpick / .sp-* 样式；输入即搜（防抖），结果直接点进详情
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { emby } from '../emby/client';
import { cardTitle } from '../emby/format';
import type { EmbyItem } from '../emby/types';
import { clearSearchHistory, loadSearchHistory, pushSearchHistory } from '../lib/prefs';

export default function SearchPanel({ bar = false }: { bar?: boolean }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<EmbyItem[]>([]);
  const [hist, setHist] = useState<string[]>(() => loadSearchHistory());
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setHist(loadSearchHistory());
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setRes([]);
      return;
    }
    let dead = false;
    setBusy(true);
    const t = setTimeout(() => {
      emby
        .items({ search: term, types: 'Movie,Series,BoxSet', limit: 12, sortBy: 'SortName' })
        .then((r) => !dead && setRes(r.Items))
        .catch(() => !dead && setRes([]))
        .finally(() => !dead && setBusy(false));
    }, 250);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [q]);

  const goDetail = (it: EmbyItem): void => {
    setHist(pushSearchHistory(q));
    setOpen(false);
    nav(`/detail/${it.Id}`);
  };
  const goAll = (term: string): void => {
    setHist(pushSearchHistory(term));
    setOpen(false);
    nav(`/search?q=${encodeURIComponent(term)}`);
  };
  const act = (e: React.KeyboardEvent, fn: () => void): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };

  return (
    <div className={`srcpick${bar ? ' sp-bar-wrap' : ''}`} ref={wrapRef}>
      <div
        className={`srcpick-name sp-btn${bar ? ' sp-bar' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        title="搜索媒体库"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => act(e, () => setOpen((v) => !v))}
      >
        🔍 {bar ? <span className="sp-bar-hint">搜索影片、剧集…</span> : '搜索'}
      </div>
      {open && (
        <div className="sp-panel" role="dialog">
          <div className="sp-row">
            <input
              ref={inputRef}
              className="sp-input"
              placeholder="搜索媒体库（回车查看全部结果）…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && q.trim()) goAll(q.trim());
              }}
            />
          </div>
          {q.trim() ? (
            <div className="sp-list">
              {busy && res.length === 0 && <div className="sp-item muted">搜索中…</div>}
              {!busy && res.length === 0 && <div className="sp-item muted">没有匹配「{q.trim()}」的内容</div>}
              {res.map((it) => (
                <div key={it.Id} className="sp-item" role="button" tabIndex={0} onClick={() => goDetail(it)} onKeyDown={(e) => act(e, () => goDetail(it))}>
                  <span>{cardTitle(it)}</span>
                  <span className="muted sp-meta">
                    {it.Type === 'Series' ? '剧集' : it.Type === 'BoxSet' ? '合集' : '电影'}
                    {it.ProductionYear ? ` · ${it.ProductionYear}` : ''}
                  </span>
                </div>
              ))}
              {res.length > 0 && (
                <div className="sp-item" role="button" tabIndex={0} onClick={() => goAll(q.trim())} onKeyDown={(e) => act(e, () => goAll(q.trim()))}>
                  <span className="muted">查看全部结果 →</span>
                </div>
              )}
            </div>
          ) : (
            <div className="sp-hist">
              <div className="sp-hot-tip muted">搜索历史</div>
              {hist.length === 0 ? (
                <div className="sp-item muted">暂无搜索记录</div>
              ) : (
                <>
                  <div className="sp-hist-list">
                    {hist.map((t) => (
                      <div key={t} className="sp-item sp-hist-item" role="button" tabIndex={0} onClick={() => goAll(t)} onKeyDown={(e) => act(e, () => goAll(t))}>
                        <span className="sp-hist-txt" title={t}>{t}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="sp-clear"
                    onClick={() => {
                      clearSearchHistory();
                      setHist([]);
                    }}
                  >
                    清空搜索记录
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
