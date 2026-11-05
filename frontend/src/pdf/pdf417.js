// PDF417 encoder (byte compaction). Produces a boolean module matrix [rows][modules].
// Structure per ISO/IEC 15438: start(17) + left indicator(17) + data columns(17 each) + right indicator(17) + stop(18).
import { CODEWORD_TABLE } from './pdf417_table.js';

const START = 0x1fea8, STOP = 0x3fa29;
const MOD = 929;

function toBytes(s) { return Array.from(new TextEncoder().encode(s)); }

/** Byte compaction (mode latch 901): 6 bytes -> 5 codewords (base 900); leftover bytes 1:1. */
export function byteCompaction(bytes) {
  const out = [901];
  let i = 0;
  for (; i + 6 <= bytes.length; i += 6) {
    let v = 0n; for (let k = 0; k < 6; k++) v = v * 256n + BigInt(bytes[i + k]);
    const cw = []; for (let k = 0; k < 5; k++) { cw.unshift(Number(v % 900n)); v /= 900n; }
    out.push(...cw);
  }
  for (; i < bytes.length; i++) out.push(bytes[i]);
  return out;
}

export function eccLevelFor(dataCount) { return dataCount <= 40 ? 2 : dataCount <= 160 ? 3 : dataCount <= 320 ? 4 : 5; }

function generator(k) {
  let g = [1]; // highest degree first
  let root = 1;
  for (let i = 0; i < k; i++) {
    const n = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { n[j] = (n[j] + g[j]) % MOD; n[j + 1] = (n[j + 1] - g[j] * root % MOD + MOD) % MOD; }
    g = n; root = root * 3 % MOD;
  }
  return g;
}
export function eccCodewords(data, k) {
  const g = generator(k), r = new Array(k).fill(0);
  for (const d of data) {
    const t = (d + r[0]) % MOD;
    for (let j = 0; j < k - 1; j++) r[j] = ((r[j + 1] - t * g[j + 1]) % MOD + MOD) % MOD;
    r[k - 1] = ((0 - t * g[k]) % MOD + MOD) % MOD;
  }
  return r.map((x) => (MOD - x) % MOD);
}

const bits = (v, n) => { const a = []; for (let i = n - 1; i >= 0; i--) a.push(((v >> i) & 1) === 1); return a; };

/** Returns { matrix, rows, cols, ecLevel, codewords } */
export function encodePDF417(text, { minCols = 2, maxCols = 8 } = {}) {
  const payload = byteCompaction(toBytes(text));
  const level = eccLevelFor(payload.length + 1), k = 1 << (level + 1);
  let best = null;
  for (let c = minCols; c <= maxCols; c++) {
    let rows = Math.ceil((payload.length + 1 + k) / c); if (rows < 3) rows = 3; if (rows > 90) continue;
    const W = 69 + 17 * c, H = rows * 3, score = Math.abs(W / H - 3.2);
    if (!best || score < best.score) best = { c, rows, score };
  }
  if (!best) throw new Error('Text too long for PDF417');
  const { c: cols, rows } = best, total = rows * cols, dataLen = total - k;
  const cws = [dataLen, ...payload]; while (cws.length < dataLen) cws.push(900);
  const all = cws.concat(eccCodewords(cws, k));
  const matrix = [];
  for (let r = 0; r < rows; r++) {
    const cluster = r % 3, K = Math.floor(r / 3) * 30;
    let left, right;
    if (cluster === 0) { left = K + Math.floor((rows - 1) / 3); right = K + (cols - 1); }
    else if (cluster === 1) { left = K + level * 3 + ((rows - 1) % 3); right = K + Math.floor((rows - 1) / 3); }
    else { left = K + (cols - 1); right = K + level * 3 + ((rows - 1) % 3); }
    const row = [...bits(START, 17), ...bits(CODEWORD_TABLE[cluster * 929 + left], 17)];
    for (let j = 0; j < cols; j++) row.push(...bits(CODEWORD_TABLE[cluster * 929 + all[r * cols + j]], 17));
    row.push(...bits(CODEWORD_TABLE[cluster * 929 + right], 17), ...bits(STOP, 18));
    matrix.push(row);
  }
  return { matrix, rows, cols, ecLevel: level, codewords: all };
}
