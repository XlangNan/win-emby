// 软键盘：输入框获得焦点时 ① 给 <html> 加 kb-open（手机端据此收起底部导航 / 迷你播放器，免得悬在键盘上面挡内容）
// ② 稍等键盘升起后，把输入框滚到可视区域中间，不会被键盘盖住
const TEXTY = new Set(['text', 'password', 'email', 'search', 'url', 'tel', 'number', '']);
function isField(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXTY.has(el.type);
  return el.isContentEditable;
}
export function installKeyboardAware(): void {
  let off: number | undefined;
  document.addEventListener('focusin', (e) => {
    if (!isField(e.target)) return;
    if (off) window.clearTimeout(off);
    document.documentElement.classList.add('kb-open');
    const el = e.target;
    // 键盘升起、可视区域缩小需要一点时间，分两次滚，慢机型也能到位
    [280, 650].forEach((ms) => window.setTimeout(() => {
      if (document.activeElement === el) { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ } }
    }, ms));
  });
  document.addEventListener('focusout', () => {
    if (off) window.clearTimeout(off);
    off = window.setTimeout(() => document.documentElement.classList.remove('kb-open'), 150);
  });
}
