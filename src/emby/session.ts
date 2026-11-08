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

const ACC_KEY = 'wemby-accounts';

/** 已登录过的全部账号（多服务器、同服务器多用户），只存 token */
export function listAccounts(): Session[] {
  try {
    const a = JSON.parse(localStorage.getItem(ACC_KEY) || '[]') as Session[];
    return Array.isArray(a) ? a.filter((x) => x && x.server && x.token && x.userId) : [];
  } catch {
    return [];
  }
}

function writeAccounts(list: Session[]): void {
  try {
    localStorage.setItem(ACC_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export const sameAccount = (a: Session, b: Session): boolean => a.server === b.server && a.userId === b.userId;

export function saveSession(s: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  const list = listAccounts().filter((x) => !sameAccount(x, s));
  list.push(s);
  writeAccounts(list);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

/** 只退出当前账号并从列表删掉；还有别的账号就自动切过去 */
export function removeAccount(s: Session): void {
  const rest = listAccounts().filter((x) => !sameAccount(x, s));
  writeAccounts(rest);
  const cur = getSession();
  if (cur && sameAccount(cur, s)) {
    if (rest.length) saveSession(rest[rest.length - 1]);
    else clearSession();
  } else {
    window.dispatchEvent(new Event(SESSION_EVENT));
  }
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
    // 用原始输入判断是否写了端口：new URL('http://h:80').port 是空串（默认端口会被吞掉），不能据此补 8096
    const hasPort = /^https?:\/\/[^/?#]*:\d+(?:[/?#]|$)/i.test(s);
    if (!hasPort && !u.port && u.protocol === 'http:') u.port = '8096';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return s;
  }
}
