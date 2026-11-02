// 登录会话：只保存在本机 localStorage（服务器地址 + 用户 + token）
import type { Session } from './types';

const KEY = 'wemby-session';
export const SESSION_EVENT = 'wemby:session';

function newDeviceId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `wemby-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

/** 设备 ID 单独存，退出登录后保持不变（服务端按它归并设备） */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('wemby-device');
    if (!id) {
      id = newDeviceId();
      localStorage.setItem('wemby-device', id);
    }
    return id;
  } catch {
    return 'wemby-device';
  }
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return s && s.server && s.token && s.userId ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(SESSION_EVENT));
}

/**
 * 规范化用户输入的服务器地址：
 *   192.168.1.5        → http://192.168.1.5:8096
 *   192.168.1.5:8096   → http://192.168.1.5:8096
 *   https://emby.lan   → https://emby.lan
 *   去掉末尾斜杠与 /emby
 */
export function normalizeServer(input: string): string {
  let s = input.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/+$/, '').replace(/\/emby$/i, '');
  try {
    const u = new URL(s);
    if (!u.port && u.protocol === 'http:') u.port = '8096';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return s;
  }
}
