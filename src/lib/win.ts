// 窗口控制（Tauri）。浏览器里调试时退化为无操作 / 浏览器全屏。
import { isTauri } from '../emby/http';
import { androidBridge, isMobileApp } from './platform';

async function cur() {
  const m = await import('@tauri-apps/api/window');
  return m.getCurrentWindow();
}

export async function winMinimize(): Promise<void> {
  if (isMobileApp) return;
  if (isTauri()) await (await cur()).minimize();
}

export async function winToggleMax(): Promise<boolean> {
  if (!isTauri() || isMobileApp) return false;
  const w = await cur();
  await w.toggleMaximize();
  return w.isMaximized();
}

export async function winIsMaximized(): Promise<boolean> {
  return isTauri() && !isMobileApp ? (await cur()).isMaximized() : false;
}

export async function winClose(): Promise<void> {
  if (isMobileApp) {
    androidBridge()?.exit();
    return;
  }
  if (isTauri()) await (await cur()).close();
  else window.close();
}

export async function winStartDrag(): Promise<void> {
  if (isMobileApp) return;
  if (isTauri()) await (await cur()).startDragging();
}

// 进全屏前记下窗口的位置 / 大小 / 是否最大化，退出全屏时原样还原
// （Windows 贴边半屏等状态，直接 setFullscreen(false) 会回到默认尺寸）
let androidFull = false;
let saved: { x: number; y: number; w: number; h: number; max: boolean } | null = null;

export async function winSetFullscreen(on: boolean): Promise<void> {
  if (isMobileApp) {
    androidFull = on;
    androidBridge()?.setFullscreen(on);
    return;
  }
  if (isTauri()) {
    const w = await cur();
    if (on) {
      if (!(await w.isFullscreen())) {
        try {
          const p = await w.outerPosition();
          const z = await w.outerSize();
          saved = { x: p.x, y: p.y, w: z.width, h: z.height, max: await w.isMaximized() };
        } catch {
          saved = null;
        }
      }
      await w.setFullscreen(true);
      return;
    }
    await w.setFullscreen(false);
    const s = saved;
    saved = null;
    if (s) {
      try {
        const m = await import('@tauri-apps/api/dpi');
        // 退出全屏是异步的：等系统先把窗口调回去，再还原，否则会被系统的尺寸盖掉（缩回小窗后下半截掉进任务栏）
        await new Promise((r) => setTimeout(r, 180));
        const apply = async (): Promise<void> => {
          if (s.max) {
            if (!(await w.isMaximized())) await w.maximize();
            return;
          }
          if (await w.isMaximized()) await w.unmaximize();
          let { x, y, w: ww, h: hh } = s;
          // 夹在当前屏幕的可用区域（不含任务栏）之内
          try {
            const mon = (await import('@tauri-apps/api/window')).currentMonitor ? await (await import('@tauri-apps/api/window')).currentMonitor() : null;
            const wa = (mon as unknown as { workArea?: { position: { x: number; y: number }; size: { width: number; height: number } } } | null)?.workArea;
            if (wa) {
              // Windows 窗口左/右/下各有约 8px 不可见边框（贴边半屏时 x 会是 -7、宽度多 14），留 24px 容差，别把它「纠正」掉，否则左边会多出一条
              const T = 24;
              if (ww > wa.size.width + T) ww = wa.size.width;
              if (hh > wa.size.height + T) hh = wa.size.height;
              if (x < wa.position.x - T) x = wa.position.x;
              if (x + ww > wa.position.x + wa.size.width + T) x = wa.position.x + wa.size.width - ww;
              if (y < wa.position.y - T) y = wa.position.y;
              if (y + hh > wa.position.y + wa.size.height + T) y = wa.position.y + wa.size.height - hh;
            }
          } catch { /* 没有工作区信息就按原值 */ }
          await w.setSize(new m.PhysicalSize(ww, hh));
          await w.setPosition(new m.PhysicalPosition(x, y));
        };
        await apply();
        // 轻推一像素再还原，逼内嵌的 mpv 画面窗口按真实大小重新铺满（否则它可能还停留在全屏时的尺寸，画面会偏下）
        const nudge = async (): Promise<void> => {
          if (s.max || (await w.isFullscreen())) return;
          const z = await w.innerSize();
          await w.setSize(new m.PhysicalSize(z.width + 1, z.height));
          await w.setSize(new m.PhysicalSize(z.width, z.height));
        };
        setTimeout(() => { void nudge().catch(() => undefined); }, 500);
        setTimeout(() => { void winFitToScreen(); }, 900);
        setTimeout(() => { void w.isFullscreen().then((f) => (f ? undefined : apply())).catch(() => undefined); }, 350);
      } catch {
        /* 还原失败就保持系统默认 */
      }
    }
    return;
  }
  if (on) await document.documentElement.requestFullscreen?.().catch(() => undefined);
  else if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
}

export async function winIsFullscreen(): Promise<boolean> {
  if (isMobileApp) return androidFull;
  return isTauri() ? (await cur()).isFullscreen() : !!document.fullscreenElement;
}

/** 拦截窗口关闭（点 ✕ / Alt+F4 / 任务栏关闭）：先跑 before，再真正销毁窗口。返回取消函数。 */
export async function winOnClose(before: () => Promise<void>): Promise<() => void> {
  if (!isTauri() || isMobileApp) return () => undefined;
  const w = await cur();
  const un = await w.onCloseRequested(async (e) => {
    e.preventDefault();
    try {
      await before();
    } finally {
      await w.destroy();
    }
  });
  return un;
}

/** 窗口比屏幕可用区域（不含任务栏）还大时，缩回来：全屏切换后窗口偶尔会比屏幕高，下半截掉进任务栏 */
export async function winFitToScreen(): Promise<void> {
  if (isMobileApp || !isTauri()) return;
  try {
    const w = await cur();
    if ((await w.isFullscreen()) || (await w.isMaximized())) return;
    const dpr = window.devicePixelRatio || 1;
    const s = window.screen as Screen & { availLeft?: number; availTop?: number };
    const aw = Math.round(s.availWidth * dpr), ah = Math.round(s.availHeight * dpr);
    const al = Math.round((s.availLeft ?? 0) * dpr), at = Math.round((s.availTop ?? 0) * dpr);
    const z = await w.outerSize();
    const p = await w.outerPosition();
    const T = 24 * dpr; // 不可见边框容差（贴边半屏时窗口外框比可用区略大）
    if (z.width <= aw + T && z.height <= ah + T && p.y + z.height <= at + ah + T && p.x >= al - T) return;
    const nw = Math.min(z.width, aw), nh = Math.min(z.height, ah);
    const m = await import('@tauri-apps/api/dpi');
    await w.setSize(new m.PhysicalSize(nw, nh));
    const nx = Math.min(Math.max(p.x, al), al + aw - nw), ny = Math.min(Math.max(p.y, at), at + ah - nh);
    await w.setPosition(new m.PhysicalPosition(nx, ny));
  } catch { /* ignore */ }
}

// 只在退出全屏后调用一次 winFitToScreen；不再监听 resize / 启动时自动跑，避免和系统反复拉扯窗口大小
export function installWinFit(): void { /* 保留空函数，main.tsx 仍会调用 */ }
