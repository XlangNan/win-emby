// 定时停止（随便看看用）：到点前 60 秒音量渐小，然后暂停；也可以选「播完当前这个」。
// 到点时同时停掉音乐和听书，避免一个停了另一个还在响。
import { useEffect, useState } from 'react';
import { absStop } from '../abs/absPlayer';
import { stopMusic } from '../music/player';

export type TimerState = { kind: 'time'; endAt: number; min: number } | { kind: 'eof' } | null;
let st: TimerState = null;
const subs = new Set<() => void>();
const emit = (): void => subs.forEach((f) => f());

export const getTimer = (): TimerState => st;
export function setTimerMin(min: number): void { st = { kind: 'time', endAt: Date.now() + min * 60000, min }; emit(); }
export function setTimerEof(): void { st = { kind: 'eof' }; emit(); }
export function clearTimer(): void { st = null; emit(); }
/** 定时触发后调用：把音乐、听书也一起停掉 */
export function stopOthers(): void { try { stopMusic(); } catch { /* ignore */ } try { absStop(); } catch { /* ignore */ } }

export function useTimer(): TimerState {
  const [, set] = useState(0);
  useEffect(() => {
    const f = (): void => set((n) => n + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return st;
}

/** 剩余秒数（time 模式）；其它返回 null */
export function timerLeft(t: TimerState): number | null {
  return t && t.kind === 'time' ? Math.max(0, Math.round((t.endAt - Date.now()) / 1000)) : null;
}
