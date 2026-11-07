// 飞牛图片需要带令牌请求，<img> / CSS 背景图直接请求会被拒绝。
// 做法：图片地址先写成 fnimg:/路径?w=宽度，再由一个全局观察器取回图片、换成 blob 地址。
import { fnImageBlob } from './fnos';

const PREFIX = 'fnimg:';
const blobs = new Map<string, Promise<string>>();

export function fnImg(path: string | undefined, w: number): string {
  return path ? `${PREFIX}${path}?w=${Math.min(Math.max(Math.round(w), 100), 1920)}` : '';
}

function resolve(u: string): Promise<string> {
  let p = blobs.get(u);
  if (!p) {
    const i = u.lastIndexOf('?w=');
    p = fnImageBlob(u.slice(PREFIX.length, i), Number(u.slice(i + 3)) || 400).then((b) => URL.createObjectURL(b));
    p.catch(() => blobs.delete(u));
    blobs.set(u, p);
  }
  return p;
}

const BG = /url\(["']?(fnimg:[^"')]+)["']?\)/;

function fixEl(el: Element): void {
  if (el instanceof HTMLImageElement) {
    const s = el.getAttribute('src') || '';
    if (s.startsWith(PREFIX)) void resolve(s).then((b) => { if (el.getAttribute('src') === s) el.src = b; }).catch(() => undefined);
  }
  if (el instanceof HTMLElement) {
    const m = BG.exec(el.getAttribute('style') || '');
    if (m) {
      const u = m[1];
      void resolve(u).then((b) => { if ((el.getAttribute('style') || '').includes(u)) el.style.backgroundImage = `url("${b}")`; }).catch(() => undefined);
    }
  }
}

let on = false;
export function installFnImg(): void {
  if (on || typeof document === 'undefined') return;
  on = true;
  const scan = (root: ParentNode): void => root.querySelectorAll('img[src^="fnimg:"], [style*="fnimg:"]').forEach(fixEl);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'attributes') fixEl(m.target as Element);
      else m.addedNodes.forEach((n) => { if (n instanceof Element) { fixEl(n); scan(n); } });
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'style'] });
  scan(document);
}
