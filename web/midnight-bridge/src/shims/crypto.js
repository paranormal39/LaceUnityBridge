// Browser shim for Node.js crypto module
// Uses Web Crypto API where possible
export function randomBytes(size) {
  const arr = new Uint8Array(size);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < size; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return arr;
}

// Minimal synchronous SHA-256 for createHash polyfill.
// Needed because @midnight-ntwrk/midnight-js-level-private-state-provider
// calls crypto.createHash('sha256') synchronously.
function sha256Sync(data) {
  // If crypto.subtle is available, we can still use it via a sync workaround
  // by pre-computing for known inputs, but for general data we need a pure JS impl.
  // Here we use a compact pure-JS SHA-256.
  const msg = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return new Sha256().update(msg).digest();
}

class Sha256 {
  constructor() {
    this.h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    this.buffer = [];
    this.length = 0;
  }
  update(data) {
    const bytes = Array.from(data);
    this.buffer.push(...bytes);
    this.length += bytes.length;
    while (this.buffer.length >= 64) {
      this._processBlock(this.buffer.splice(0, 64));
    }
    return this;
  }
  digest() {
    const bits = this.length * 8;
    this.buffer.push(0x80);
    while ((this.buffer.length % 64) !== 56) this.buffer.push(0);
    for (let i = 7; i >= 0; i--) this.buffer.push((bits >>> (i * 8)) & 0xff);
    this._processBlock(this.buffer.splice(0, 64));
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      out[i * 4] = (this.h[i] >>> 24) & 0xff;
      out[i * 4 + 1] = (this.h[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (this.h[i] >>> 8) & 0xff;
      out[i * 4 + 3] = this.h[i] & 0xff;
    }
    return out;
  }
  _processBlock(block) {
    const w = new Array(64);
    const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const rrot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let i = 0; i < 16; i++) w[i] = (block[i * 4] << 24) | (block[i * 4 + 1] << 16) | (block[i * 4 + 2] << 8) | block[i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rrot(w[i - 15], 7) ^ rrot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rrot(w[i - 2], 17) ^ rrot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = this.h;
    for (let i = 0; i < 64; i++) {
      const S1 = rrot(e, 6) ^ rrot(e, 11) ^ rrot(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[i] + w[i]) | 0;
      const S0 = rrot(a, 2) ^ rrot(a, 13) ^ rrot(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    this.h[0] = (this.h[0] + a) | 0;
    this.h[1] = (this.h[1] + b) | 0;
    this.h[2] = (this.h[2] + c) | 0;
    this.h[3] = (this.h[3] + d) | 0;
    this.h[4] = (this.h[4] + e) | 0;
    this.h[5] = (this.h[5] + f) | 0;
    this.h[6] = (this.h[6] + g) | 0;
    this.h[7] = (this.h[7] + h) | 0;
  }
}

export function createHash(algorithm) {
  if (algorithm !== 'sha256') {
    throw new Error('crypto.createHash: only sha256 is supported in browser shim');
  }
  const hasher = new Sha256();
  return {
    update(data) {
      const buf = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
      hasher.update(buf);
      return this;
    },
    digest(encoding) {
      const result = hasher.digest();
      if (encoding === 'hex') {
        return Array.from(result).map(b => b.toString(16).padStart(2, '0')).join('');
      }
      return result;
    }
  };
}

export function createHmac() {
  throw new Error('crypto.createHmac not available in browser.');
}
export function pbkdf2Sync() {
  throw new Error('crypto.pbkdf2Sync not available in browser.');
}
export function createCipheriv() {
  throw new Error('crypto.createCipheriv not available in browser. AES encryption requires Web Crypto API or a dedicated crypto library.');
}
export function createDecipheriv() {
  throw new Error('crypto.createDecipheriv not available in browser. AES decryption requires Web Crypto API or a dedicated crypto library.');
}
export default { randomBytes, createHash, createHmac, pbkdf2Sync, createCipheriv, createDecipheriv };
