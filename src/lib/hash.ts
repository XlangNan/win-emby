// 纯 JS 的 MD5 / SHA-256（飞牛接口签名用；不依赖 crypto.subtle，避免非安全上下文里不可用）
const hex = (b: number[]): string => b.map((x) => (x & 255).toString(16).padStart(2, '0')).join('');
const utf8 = (s: string): number[] => Array.from(new TextEncoder().encode(s));

export function md5(str: string): string {
  const m = utf8(str);
  const len = m.length;
  m.push(0x80);
  while (m.length % 64 !== 56) m.push(0);
  const bits = len * 8;
  for (let i = 0; i < 8; i++) m.push(i < 4 ? (bits >>> (8 * i)) & 255 : Math.floor(bits / 2 ** 32) >>> (8 * (i - 4)) & 255);
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
  const out: number[] = [];
  for (const v of [a0, b0, c0, d0]) for (let i = 0; i < 4; i++) out.push((v >>> (8 * i)) & 255);
  return hex(out);
}

export function sha256(str: string): string {
  const m = utf8(str);
  const len = m.length;
  m.push(0x80);
  while (m.length % 64 !== 56) m.push(0);
  const bits = len * 8;
  for (let i = 7; i >= 0; i--) m.push(i >= 4 ? 0 : (bits >>> (8 * i)) & 255);
  const K: number[] = [];
  const isPrime = (n: number): boolean => { for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
  const frac = (x: number): number => Math.floor((x - Math.floor(x)) * 2 ** 32);
  const H: number[] = [];
  for (let n = 2; K.length < 64; n++) if (isPrime(n)) { if (H.length < 8) H.push(frac(Math.sqrt(n))); K.push(frac(Math.cbrt(n))); }
  const rr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < m.length; o += 64) {
    const w: number[] = [];
    for (let i = 0; i < 16; i++) w.push((m[o + i * 4] << 24) | (m[o + i * 4 + 1] << 16) | (m[o + i * 4 + 2] << 8) | m[o + i * 4 + 3]);
    for (let i = 16; i < 64; i++) {
      const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w.push((w[i - 16] + s0 + w[i - 7] + s1) | 0);
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  const out: number[] = [];
  for (const v of H) for (let i = 3; i >= 0; i--) out.push((v >>> (8 * i)) & 255);
  return hex(out);
}
