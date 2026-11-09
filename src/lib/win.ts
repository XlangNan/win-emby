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
        if (s.max) {
          await w.maximize();
        } else {
          await w.setSize(new m.PhysicalSize(s.w, s.h));
          await w.setPosition(new m.PhysicalPosition(s.x, s.y));
        }
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
