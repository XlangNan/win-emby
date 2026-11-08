// 应用内对话框 / 提示：不依赖浏览器自带的 prompt / confirm / alert（安卓 WebView 里不一定会弹）
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useBackClose } from './useBackClose';

interface Opts { title: string; text?: boolean; placeholder?: string; ok?: string; danger?: boolean }

function Box({ o, done }: { o: Opts; done: (v: string | null) => void }) {
  const [v, setV] = useState('');
  const inp = useRef<HTMLInputElement>(null);
  useBackClose(true, () => done(null));
  useEffect(() => { inp.current?.focus(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') done(null); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [done]);
  const submit = (): void => { if (o.text) { if (v.trim()) done(v.trim()); } else done('1'); };
  return (
    <div className="mu-dlg-mask mu-scope" onClick={() => done(null)}>
      <div className="mu-dlg" role="dialog" aria-label={o.title} onClick={(e) => e.stopPropagation()}>
        <div className="mu-dlg-t">{o.title}</div>
        {o.text && <input ref={inp} className="mu-dlg-in" value={v} placeholder={o.placeholder} maxLength={60} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />}
        <div className="mu-dlg-b">
          <button type="button" className="mu-dlg-btn" onClick={() => done(null)}>取消</button>
          <button type="button" className={`mu-dlg-btn ${o.danger ? 'danger' : 'ok'}`} onClick={submit}>{o.ok || '确定'}</button>
        </div>
      </div>
    </div>
  );
}

function open(o: Opts): Promise<string | null> {
  return new Promise((res) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: string | null): void => { root.unmount(); host.remove(); res(v); };
    root.render(<Box o={o} done={done} />);
  });
}

export const askText = (title: string, placeholder = ''): Promise<string | null> => open({ title, text: true, placeholder, ok: '创建' });
export const askConfirm = async (title: string, ok = '删除'): Promise<boolean> => (await open({ title, ok, danger: true })) !== null;

let tt = 0;
export function toast(msg: string): void {
  let el = document.getElementById('mu-toast');
  if (!el) { el = document.createElement('div'); el.id = 'mu-toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'show';
  window.clearTimeout(tt);
  tt = window.setTimeout(() => { el?.classList.remove('show'); }, 2200);
}
