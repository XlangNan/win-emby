// 纯 JS 的 PBKDF2-SHA256 和 AES-256-GCM。只在浏览器没有 WebCrypto（用 http://局域网IP 打开时就没有）时才用，
// 结果和织影 App 里 WebCrypto 算出来的完全一致。
(function (root) {
  'use strict';
  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  var IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var W = new Uint32Array(64);

  // h: Uint32Array(8) 状态（原地更新）；w: Uint32Array(16) 一个 64 字节块
  function compress(h, w) {
    var i, a, b, c, d, e, f, g, hh, t1, t2, x, y;
    for (i = 0; i < 16; i++) W[i] = w[i];
    for (i = 16; i < 64; i++) {
      x = W[i - 15]; y = W[i - 2];
      W[i] = (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) + W[i - 7] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + W[i - 16] | 0;
    }
    a = h[0]; b = h[1]; c = h[2]; d = h[3]; e = h[4]; f = h[5]; g = h[6]; hh = h[7];
    for (i = 0; i < 64; i++) {
      t1 = hh + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + W[i] | 0;
      t2 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c)) | 0;
      hh = g; g = f; f = e; e = d + t1 | 0; d = c; c = b; b = a; a = t1 + t2 | 0;
    }
    h[0] = h[0] + a | 0; h[1] = h[1] + b | 0; h[2] = h[2] + c | 0; h[3] = h[3] + d | 0;
    h[4] = h[4] + e | 0; h[5] = h[5] + f | 0; h[6] = h[6] + g | 0; h[7] = h[7] + hh | 0;
  }

  // 从给定状态继续哈希 msg（prefixLen = 之前已经处理过的字节数），返回 Uint32Array(8)
  function sha256From(state, msg, prefixLen) {
    var h = new Uint32Array(state), w = new Uint32Array(16), n = msg.length, i, j;
    var total = prefixLen + n, full = n - (n % 64);
    for (i = 0; i < full; i += 64) { for (j = 0; j < 16; j++) w[j] = (msg[i + 4 * j] << 24) | (msg[i + 4 * j + 1] << 16) | (msg[i + 4 * j + 2] << 8) | msg[i + 4 * j + 3]; compress(h, w); }
    var rest = new Uint8Array(128), r = n - full;
    rest.set(msg.subarray(full));
    rest[r] = 0x80;
    var len = (r + 9 <= 64) ? 64 : 128;
    var bits = total * 8;
    rest[len - 4] = (bits >>> 24) & 255; rest[len - 3] = (bits >>> 16) & 255; rest[len - 2] = (bits >>> 8) & 255; rest[len - 1] = bits & 255;
    rest[len - 8] = Math.floor(bits / 4294967296) & 255; // 高位（这里的数据都很小，基本为 0）
    for (i = 0; i < len; i += 64) { for (j = 0; j < 16; j++) w[j] = (rest[i + 4 * j] << 24) | (rest[i + 4 * j + 1] << 16) | (rest[i + 4 * j + 2] << 8) | rest[i + 4 * j + 3]; compress(h, w); }
    return h;
  }

  function utf8(s) { return new TextEncoder().encode(s); }

  function pbkdf2(pw, salt, iterations) {
    var key = utf8(pw), s = utf8(salt), i, j;
    if (key.length > 64) { var hk = sha256From(IV, key, 0), kb = new Uint8Array(32); for (i = 0; i < 8; i++) { kb[4 * i] = hk[i] >>> 24; kb[4 * i + 1] = hk[i] >>> 16 & 255; kb[4 * i + 2] = hk[i] >>> 8 & 255; kb[4 * i + 3] = hk[i] & 255; } key = kb; }
    var ip = new Uint32Array(16), op = new Uint32Array(16);
    for (i = 0; i < 64; i++) { var kbyte = i < key.length ? key[i] : 0; if (i % 4 === 0) { ip[i / 4] = 0; op[i / 4] = 0; } ip[i >> 2] |= (kbyte ^ 0x36) << (24 - 8 * (i & 3)); op[i >> 2] |= (kbyte ^ 0x5c) << (24 - 8 * (i & 3)); }
    var inner = new Uint32Array(IV), outer = new Uint32Array(IV);
    compress(inner, ip); compress(outer, op);
    // U1 = HMAC(P, salt || 00000001)
    var m = new Uint8Array(s.length + 4); m.set(s); m[s.length + 3] = 1;
    var ih = sha256From(inner, m, 64);
    var ob = new Uint32Array(16); for (i = 0; i < 8; i++) ob[i] = ih[i]; ob[8] = 0x80000000; ob[15] = (64 + 32) * 8;
    var u = new Uint32Array(outer); compress(u, ob);
    var t = new Uint32Array(u), blk = new Uint32Array(16), hs = new Uint32Array(8);
    blk[8] = 0x80000000; blk[15] = (64 + 32) * 8;
    for (i = 1; i < iterations; i++) {
      for (j = 0; j < 8; j++) blk[j] = u[j];
      hs.set(inner); compress(hs, blk);
      for (j = 0; j < 8; j++) blk[j] = hs[j];
      u.set(outer); compress(u, blk);
      for (j = 0; j < 8; j++) t[j] ^= u[j];
    }
    var out = new Uint8Array(32);
    for (i = 0; i < 8; i++) { out[4 * i] = t[i] >>> 24; out[4 * i + 1] = t[i] >>> 16 & 255; out[4 * i + 2] = t[i] >>> 8 & 255; out[4 * i + 3] = t[i] & 255; }
    return out;
  }

  // ───────── AES-256（只做加密方向，GCM 解密也只需要它） ─────────
  var SBOX = new Uint8Array(256);
  (function () {
    var p = 1, q = 1, x;
    do {
      p = p ^ ((p << 1) & 255) ^ (p & 128 ? 0x1b : 0);
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 255; if (q & 128) q ^= 0x09;
      x = q ^ ((q << 1 | q >> 7) & 255) ^ ((q << 2 | q >> 6) & 255) ^ ((q << 3 | q >> 5) & 255) ^ ((q << 4 | q >> 4) & 255);
      SBOX[p] = (x ^ 0x63) & 255;
    } while (p !== 1);
    SBOX[0] = 0x63;
  })();
  function xt(a) { return ((a << 1) ^ (a & 128 ? 0x1b : 0)) & 255; }
  function expandKey(key) {
    var nk = 8, nr = 14, w = new Uint8Array(16 * (nr + 1)), i, t = new Uint8Array(4), rc = 1, k;
    w.set(key);
    for (i = nk; i < 4 * (nr + 1); i++) {
      for (k = 0; k < 4; k++) t[k] = w[4 * (i - 1) + k];
      if (i % nk === 0) { var tmp = t[0]; t[0] = SBOX[t[1]] ^ rc; t[1] = SBOX[t[2]]; t[2] = SBOX[t[3]]; t[3] = SBOX[tmp]; rc = xt(rc); }
      else if (i % nk === 4) { for (k = 0; k < 4; k++) t[k] = SBOX[t[k]]; }
      for (k = 0; k < 4; k++) w[4 * i + k] = w[4 * (i - nk) + k] ^ t[k];
    }
    return w;
  }
  function encBlock(rk, inp, out) {
    var s = new Uint8Array(16), i, r, a0, a1, a2, a3, t = new Uint8Array(16);
    for (i = 0; i < 16; i++) s[i] = inp[i] ^ rk[i];
    for (r = 1; r <= 14; r++) {
      // SubBytes + ShiftRows
      t[0] = SBOX[s[0]]; t[1] = SBOX[s[5]]; t[2] = SBOX[s[10]]; t[3] = SBOX[s[15]];
      t[4] = SBOX[s[4]]; t[5] = SBOX[s[9]]; t[6] = SBOX[s[14]]; t[7] = SBOX[s[3]];
      t[8] = SBOX[s[8]]; t[9] = SBOX[s[13]]; t[10] = SBOX[s[2]]; t[11] = SBOX[s[7]];
      t[12] = SBOX[s[12]]; t[13] = SBOX[s[1]]; t[14] = SBOX[s[6]]; t[15] = SBOX[s[11]];
      if (r < 14) {
        for (i = 0; i < 16; i += 4) {
          a0 = t[i]; a1 = t[i + 1]; a2 = t[i + 2]; a3 = t[i + 3];
          s[i] = xt(a0) ^ (xt(a1) ^ a1) ^ a2 ^ a3;
          s[i + 1] = a0 ^ xt(a1) ^ (xt(a2) ^ a2) ^ a3;
          s[i + 2] = a0 ^ a1 ^ xt(a2) ^ (xt(a3) ^ a3);
          s[i + 3] = (xt(a0) ^ a0) ^ a1 ^ a2 ^ xt(a3);
        }
      } else { for (i = 0; i < 16; i++) s[i] = t[i]; }
      for (i = 0; i < 16; i++) s[i] ^= rk[16 * r + i];
    }
    out.set(s);
  }

  // GHASH 乘法：x = x · h（GF(2^128)，按位算法，数据量小够用）
  function gmul(x, h) {
    var z0 = 0, z1 = 0, z2 = 0, z3 = 0, v0 = h[0], v1 = h[1], v2 = h[2], v3 = h[3], i, w, bit, lsb;
    for (i = 0; i < 128; i++) {
      w = x[i >> 5]; bit = (w >>> (31 - (i & 31))) & 1;
      if (bit) { z0 ^= v0; z1 ^= v1; z2 ^= v2; z3 ^= v3; }
      lsb = v3 & 1;
      v3 = (v3 >>> 1) | (v2 << 31); v2 = (v2 >>> 1) | (v1 << 31); v1 = (v1 >>> 1) | (v0 << 31); v0 = v0 >>> 1;
      if (lsb) v0 ^= 0xe1000000;
    }
    x[0] = z0 | 0; x[1] = z1 | 0; x[2] = z2 | 0; x[3] = z3 | 0;
  }
  function words(b, o) { return [(b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3], (b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7], (b[o + 8] << 24) | (b[o + 9] << 16) | (b[o + 10] << 8) | b[o + 11], (b[o + 12] << 24) | (b[o + 13] << 16) | (b[o + 14] << 8) | b[o + 15]]; }
  function ghash(h, data) {
    var x = new Int32Array(4), i, n = data.length, blk = new Uint8Array(16), w, j;
    for (i = 0; i < n; i += 16) {
      blk.fill(0); blk.set(data.subarray(i, Math.min(i + 16, n)));
      w = words(blk, 0); for (j = 0; j < 4; j++) x[j] ^= w[j];
      gmul(x, h);
    }
    return x;
  }
  function gcmCore(key, iv, data, decrypt, tagIn) {
    var rk = expandKey(key), zero = new Uint8Array(16), hb = new Uint8Array(16);
    encBlock(rk, zero, hb);
    var h = words(hb, 0);
    var ctr = new Uint8Array(16); ctr.set(iv); ctr[15] = 1;
    var j0 = new Uint8Array(ctr);
    var ct = decrypt ? data : null, pt = decrypt ? new Uint8Array(data.length) : data;
    var out = decrypt ? pt : new Uint8Array(data.length), ks = new Uint8Array(16), i, k, c;
    for (i = 0; i < data.length; i += 16) {
      for (k = 15; k >= 12; k--) { ctr[k] = (ctr[k] + 1) & 255; if (ctr[k]) break; }
      encBlock(rk, ctr, ks);
      for (k = 0; k < 16 && i + k < data.length; k++) out[i + k] = data[i + k] ^ ks[k];
    }
    var cdata = decrypt ? data : out;
    var padded = new Uint8Array(Math.ceil(cdata.length / 16) * 16 + 16); padded.set(cdata);
    var bits = cdata.length * 8;
    padded[padded.length - 4] = (bits >>> 24) & 255; padded[padded.length - 3] = (bits >>> 16) & 255; padded[padded.length - 2] = (bits >>> 8) & 255; padded[padded.length - 1] = bits & 255;
    padded[padded.length - 8] = Math.floor(bits / 4294967296) & 255;
    var g = ghash(h, padded), eb = new Uint8Array(16), tag = new Uint8Array(16);
    encBlock(rk, j0, eb);
    for (i = 0; i < 4; i++) { c = g[i]; tag[4 * i] = (c >>> 24 & 255) ^ eb[4 * i]; tag[4 * i + 1] = (c >>> 16 & 255) ^ eb[4 * i + 1]; tag[4 * i + 2] = (c >>> 8 & 255) ^ eb[4 * i + 2]; tag[4 * i + 3] = (c & 255) ^ eb[4 * i + 3]; }
    if (decrypt) { var bad = 0; for (i = 0; i < 16; i++) bad |= tag[i] ^ tagIn[i]; if (bad) throw new Error('解密失败'); return out; }
    var res = new Uint8Array(out.length + 16); res.set(out); res.set(tag, out.length); return res;
  }
  function gcmEncrypt(key, iv, data) { return gcmCore(key, iv, data, false); }
  function gcmDecrypt(key, iv, data) { // data = 密文 + 16 字节标签
    if (data.length < 16) throw new Error('解密失败');
    return gcmCore(key, iv, data.subarray(0, data.length - 16), true, data.subarray(data.length - 16));
  }
  root.CryptoFB = { pbkdf2: pbkdf2, gcmEncrypt: gcmEncrypt, gcmDecrypt: gcmDecrypt };
})(typeof window !== 'undefined' ? window : globalThis);
