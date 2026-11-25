// 液态玻璃的氛围背景层（固定在最底层，页面内容和悬浮导航都在它上面）。非玻璃风格时这层不显示。
import { useAmbientUrl } from '../lib/ambient';

export default function GlassAmbient() {
  const url = useAmbientUrl();
  return (
    <div className="gl-amb" aria-hidden="true">
      {url && <div key={url} className="gl-amb-img" style={{ backgroundImage: `url("${url}")` }} />}
      <div className="gl-amb-shade" />
    </div>
  );
}
