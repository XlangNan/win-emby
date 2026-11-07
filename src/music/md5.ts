// 纯 JS 的 MD5（Subsonic 接口的令牌 = md5(密码 + 随机盐)）
export function md5(str: string): string {
  const m = Array.from(new TextEncoder().encode(str));
  const len = m.length;
  m.push(0x80);
  while (m.length % 64 !== 56) m.push(0);
  const bits = len * 8;
  for (let i = 0; i < 8; i++) m.push(i < 4 ? (bits >>> (8 * i)) & 255 : (Math.floor(bits / 2 ** 32) >>> (8 * (i - 4))) & 255);
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (let o = 0; o < m.length; o += 64) {
    const w: number[] = [];
    for (let i = 0; i < 16; i++) w.push(m[o + i * 4] | (m[o + i * 4 + 1] << 8) | (m[o + i * 4 + 2] << 16) | (m[o + i * 4 + 3] << 24));
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const t = d; d = c; c = b;
      const x = (a + f + K[i] + w[g]) | 0;
      const s = S[(i >> 4) * 4 + (i % 4)];
      b = (b + ((x << s) | (x >>> (32 - s)))) | 0;
      a = t;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  let out = '';
  for (const v of [a0, b0, c0, d0]) for (let i = 0; i < 4; i++) out += ((v >>> (8 * i)) & 255).toString(16).padStart(2, '0');
  return out;
}
