// 四套皮肤的「结构声明」注册表（沿用原 Win-Box 的皮肤体系，去掉插件皮肤）。
// 令牌（颜色/圆角/阴影）写在 styles/*.css；这里只声明外壳 / 详情 / 发现 / 筛选的排版枚举，
// 组件读 layout，不按皮肤 id 分支。

export interface ThemeLayout {
  /** topbar = 单行顶栏 / dualbar = 双行头 / sidebar = 玻璃侧边栏 / pillbar = 胶囊导航 */
  shell?: 'topbar' | 'dualbar' | 'sidebar' | 'pillbar';
  detailStyle?: 'basic' | 'cinema' | 'glass' | 'poster';
  discoverStyle?: 'basic' | 'shelf' | 'shelfWide' | 'wall';
  filterStyle?: 'plain' | 'card';
  navHeight?: number;
  sideWidth?: number;
  cardWidth?: number;
}

export type Theme = 'netflix' | 'bilibili' | 'apple' | 'douban';

export const DEFAULT_THEME: Theme = 'netflix';

export const THEME_LABELS: Record<Theme, string> = {
  netflix: '🎬 网飝',
  bilibili: '📺 哔哔',
  apple: '🍎 大果',
  douban: '🫘 大豆',
};

interface SkinEntry {
  id: Theme;
  base: 'dark' | 'light';
  layout: ThemeLayout;
}

const SKINS: SkinEntry[] = [
  { id: 'netflix', base: 'dark', layout: { shell: 'topbar', detailStyle: 'cinema', discoverStyle: 'shelf', navHeight: 58, cardWidth: 176 } },
  { id: 'bilibili', base: 'dark', layout: { shell: 'dualbar' } },
  { id: 'apple', base: 'light', layout: { shell: 'sidebar', detailStyle: 'glass', discoverStyle: 'shelfWide', navHeight: 52, sideWidth: 212 } },
  { id: 'douban', base: 'light', layout: { shell: 'pillbar', detailStyle: 'poster', discoverStyle: 'wall', filterStyle: 'card' } },
];

export const ALL_THEMES: Theme[] = SKINS.map((s) => s.id);

export function normalizeTheme(v: unknown): Theme {
  return SKINS.some((s) => s.id === v) ? (v as Theme) : DEFAULT_THEME;
}

const layoutCache = new Map<Theme, ThemeLayout>();

export function skinLayout(id: unknown): ThemeLayout {
  const key = normalizeTheme(id);
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const merged: ThemeLayout = { shell: 'topbar', filterStyle: 'plain', ...(SKINS.find((s) => s.id === key)?.layout || {}) };
  layoutCache.set(key, merged);
  return merged;
}

export function skinBase(id: unknown): 'dark' | 'light' {
  return SKINS.find((s) => s.id === normalizeTheme(id))?.base ?? 'dark';
}
