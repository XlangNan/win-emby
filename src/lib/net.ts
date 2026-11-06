// 网络设置（安卓）：自定义 hosts（域名 → IP，IPv4 / IPv6 都行）。代理仍在各服务自己的设置里填。
const KEY = 'wemby-hosts';

export const loadHostsText = (): string => {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
};

export function saveHostsText(t: string): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
}

/** 解析成 { 域名: [ip, ...] }。每行：IP 空格 域名（可多个域名），# 开头为注释；同一域名可写多行（v4 + v6 都行，按顺序依次尝试） */
export function parseHosts(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [ip, ...names] = line.split(/\s+/);
    if (!/^[0-9a-f:.]+$/i.test(ip) || !(ip.includes('.') || ip.includes(':'))) continue;
    for (const n of names) (out[n.toLowerCase()] ||= []).push(ip);
  }
  return out;
}

export const hostsMap = (): Record<string, string[]> => parseHosts(loadHostsText());

export const HOSTS_TEMPLATE = `# 每行：IP 域名      （IPv4、IPv6 都可以；# 开头是注释）
# 同一个域名可以写多行，按顺序依次尝试，例如先 IPv6 再 IPv4：
# 2600:9000:xxxx::1  api.themoviedb.org
# 18.xxx.xxx.xxx     api.themoviedb.org
# xxx.xxx.xxx.xxx    image.tmdb.org
# xxx.xxx.xxx.xxx    www.themoviedb.org
`;
