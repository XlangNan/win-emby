// 界面字体：全部用 Windows 自带字体名（不依赖联网，也不用打包字体文件）。
// 选中的字体写成内联 --font-ui，优先级高于各皮肤自带的字体设置。
const KEY = 'wemby-font';

export interface FontPreset { id: string; label: string; stack: string }

const CJK = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';

export const FONT_PRESETS: FontPreset[] = [
  { id: 'skin', label: '跟随皮肤', stack: '' },
  { id: 'yahei', label: '微软雅黑', stack: `"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif` },
  { id: 'segoe', label: 'Segoe UI Variable', stack: `"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", ${CJK}` },
  { id: 'dengxian', label: '等线（细）', stack: `"DengXian", "Segoe UI", ${CJK}` },
  { id: 'noto', label: '思源黑体（需已安装）', stack: `"Source Han Sans SC", "Noto Sans SC", "Noto Sans CJK SC", ${CJK}` },
  { id: 'harmony', label: 'HarmonyOS Sans（需已安装）', stack: `"HarmonyOS Sans SC", "HarmonyOS Sans", ${CJK}` },
  { id: 'bahn', label: 'Bahnschrift（硬朗）', stack: `"Bahnschrift", "Segoe UI", ${CJK}` },
  { id: 'serif', label: '宋体系（衬线）', stack: `"Source Han Serif SC", "Noto Serif SC", "SimSun", "NSimSun", serif` },
  { id: 'kai', label: '楷体', stack: `"KaiTi", "STKaiti", serif` },
  { id: 'mono', label: '等宽（Consolas）', stack: `"Cascadia Mono", "Consolas", "Microsoft YaHei", monospace` },
];

export interface FontPref { id: string; custom: string }

export function loadFont(): FontPref {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { id: 'skin', custom: '', ...(JSON.parse(raw) as Partial<FontPref>) };
  } catch {
    /* ignore */
  }
  return { id: 'skin', custom: '' };
}

export function applyFont(p: FontPref): void {
  const root = document.documentElement;
  const custom = p.custom.trim().replace(/["';{}]/g, '');
  const stack = custom ? `"${custom}", ${CJK}` : FONT_PRESETS.find((f) => f.id === p.id)?.stack || '';
  if (stack) root.style.setProperty('--font-ui', stack);
  else root.style.removeProperty('--font-ui');
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function initFont(): void {
  applyFont(loadFont());
}
