// 投屏（DLNA）：按钮 + 选设备的弹层。播放条（手机 / 电脑）和播放页共用。
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ic } from './MusicUi';
import { dlnaAvailable, discover, type DlnaDevice } from './dlna';
import { getCastMp3, setCastMp3, startCast, stopCast, useMusic, castDevice } from './player';
import { loadNd } from './navidrome';
import { useBackClose } from './useBackClose';

let lastList: DlnaDevice[] = [];   // 上次搜到的设备：再次打开时先显示，同时后台重新搜

/** 服务器地址是本机地址时，设备访问不到 */
function serverIsLocal(): boolean {
  try { return /^(localhost|127\.|\[?::1\]?$)/i.test(new URL(loadNd().server).hostname); } catch { return false; }
}

function CastDialog({ onClose }: { onClose: () => void }) {
  const m = useMusic();
  const [list, setList] = useState<DlnaDevice[]>(lastList);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mp3, setMp3] = useState(getCastMp3());
  const alive = useRef(true);
  const run = useRef(0);
  useBackClose(true, onClose);
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const scan = useCallback(() => {
    const id = ++run.current;
    setBusy(true); setErr('');
    discover(3000).then((l) => {
      if (!alive.current || id !== run.current) return;
      // 正在投屏的设备即使这次没搜到（个别设备应答慢），也留在列表里
      const cur = castDevice();
      const merged = cur && !l.some((d) => d.id === cur.id) ? [cur, ...l] : l;
      lastList = merged; setList(merged);
    }).catch((e: unknown) => {
      if (alive.current && id === run.current) setErr(e instanceof Error ? e.message : '搜索失败');
    }).finally(() => { if (alive.current && id === run.current) setBusy(false); });
  }, []);
  useEffect(() => { alive.current = true; scan(); return () => { alive.current = false; }; }, [scan]);

  const cur = castDevice();
  return createPortal(
    <>
      <div className="mu-cast-mask" onClick={onClose} />
      <div className="mu-cast mu-scope" role="dialog" aria-label="投屏到设备">
        <div className="mu-cast-h"><b>投屏到设备</b>
          <button type="button" className="mu-ib" aria-label="重新搜索" title="重新搜索" disabled={busy} onClick={scan}><span className={busy ? 'spinner' : ''}>{busy ? null : <Ic n="radio" size={18} />}</span></button>
          <button type="button" className="mu-ib" aria-label="关闭" onClick={onClose}><Ic n="close" size={18} /></button>
        </div>
        {serverIsLocal() && <div className="mu-cast-warn">音乐服务器地址是本机地址（localhost / 127.0.0.1），设备访问不到，投不出去。请在设置里改成局域网 IP。</div>}
        <div className="mu-cast-l">
          <button type="button" className={`mu-cast-i${!cur ? ' on' : ''}`} onClick={() => { if (cur) stopCast(true); onClose(); }}>
            <span className="mu-cast-ic"><Ic n="note" size={20} /></span><b>本机播放</b>{!cur && <em>当前</em>}
          </button>
          {list.map((d) => {
            const on = cur?.id === d.id;
            return (
              <button type="button" key={d.id} className={`mu-cast-i${on ? ' on' : ''}`} onClick={() => { startCast(d); onClose(); }}>
                <span className="mu-cast-ic"><Ic n="cast" size={20} /></span>
                <b>{d.name}</b>{d.model && d.model !== d.name && <small>{d.model}</small>}{on && <em>投屏中</em>}
              </button>
            );
          })}
          {!list.length && (busy ? <div className="mu-cast-empty">正在搜索设备…</div>
            : <div className="mu-cast-empty">{err || '没有找到设备。请确认本机和电视 / 音箱连在同一个 Wi-Fi，并且设备已开机、支持 DLNA 投屏。'}</div>)}
          {!!list.length && err && <div className="mu-cast-empty">{err}</div>}
        </div>
        <label className="mu-cast-opt">
          <input type="checkbox" checked={mp3} onChange={(e) => { setMp3(e.target.checked); setCastMp3(e.target.checked); }} />
          <span>兼容模式：让服务器转成 MP3 再投（设备不认 FLAC / 无损格式、投了没声音时打开）</span>
        </label>
      </div>
    </>,
    document.body,
  );
}

/** 投屏按钮：设备搜不了的环境（浏览器调试 / iOS / 旧版安装包）不显示 */
export default function CastButton({ className = 'mu-ib' }: { className?: string }) {
  const m = useMusic();
  const [open, setOpen] = useState(false);
  if (!dlnaAvailable()) return null;
  const on = !!m.castName;
  return (
    <>
      <button type="button" className={`${className}${on ? ' on' : ''}`} aria-label={on ? `投屏中：${m.castName}` : '投屏'} title={on ? `投屏中：${m.castName}（点击切换 / 断开）` : '投屏到电视 / 音箱'} onClick={() => setOpen(true)}><Ic n="cast" size={20} /></button>
      {open && <CastDialog onClose={() => setOpen(false)} />}
    </>
  );
}
