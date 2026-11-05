// Minimal self-contained QR Code encoder: byte mode, ECC level M, versions 1-10, automatic mask selection.
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// GF(256) arithmetic (poly 0x11D)
const EXP = new Array(512), LOG = new Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsGenerator(deg) {
  let g = [1];
  for (let i = 0; i < deg; i++) { const n = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { n[j] ^= g[j]; n[j + 1] ^= gmul(g[j], EXP[i]); } g = n; }
  return g; // highest degree first, leading 1
}
function rsRemainder(data, deg) {
  const g = rsGenerator(deg), r = new Array(deg).fill(0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); for (let i = 0; i < deg; i++) r[i] ^= gmul(g[i + 1], f); }
  return r;
}
const rawModules = (v) => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
const dataCodewords = (v) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * NUM_BLOCKS[v];

function utf8(str) { return Array.from(new TextEncoder().encode(str)); }

export function encodeQR(text) {
  const bytes = typeof text === 'string' ? utf8(text) : Array.from(text);
  let ver = 1;
  for (; ver <= 10; ver++) { const cap = dataCodewords(ver) * 8; if (4 + 8 + bytes.length * 8 <= cap) break; }
  if (ver > 10) throw new Error('QR payload too long');
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4); put(bytes.length, 8); bytes.forEach((b) => put(b, 8));
  const cap = dataCodewords(ver) * 8;
  put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
  // split into blocks, add ECC, interleave
  const nb = NUM_BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8), shortCount = nb - (raw % nb), shortLen = Math.floor(raw / nb) - eccLen;
  const blocks = []; let k = 0;
  for (let i = 0; i < nb; i++) { const len = shortLen + (i < shortCount ? 0 : 1); const d = data.slice(k, k + len); k += len; blocks.push({ d, e: rsRemainder(d, eccLen) }); }
  const out = [];
  for (let i = 0; i <= shortLen; i++) blocks.forEach((b) => { if (i < b.d.length) out.push(b.d[i]); });
  for (let i = 0; i < eccLen; i++) blocks.forEach((b) => out.push(b.e[i]));

  const size = ver * 4 + 17;
  const best = (() => {
    let bestM = null, bestP = Infinity;
    for (let mask = 0; mask < 8; mask++) { const m = build(ver, size, out, mask); const p = penalty(m, size); if (p < bestP) { bestP = p; bestM = m; } }
    return bestM;
  })();
  return best;
}

function build(ver, size, codewords, mask) {
  const mod = Array.from({ length: size }, () => new Array(size).fill(false)), fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, d) => { mod[y][x] = d; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= size || y >= size) continue; const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4); } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = ALIGN[ver];
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = (m) => {
    const data = (0 << 3) | m; // ECC level M = 00
    let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412, bit = (i) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i)); set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const b = ((bits >>> i) & 1) !== 0, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, b); set(c, a, b); }
  }
  // zigzag place data
  let bi = 0; const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
      if (!fn[y][x] && bi < total) { mod[y][x] = ((codewords[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
    }
  }
  const masks = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && masks[mask](x, y)) mod[y][x] = !mod[y][x];
  drawFormat(mask);
  return mod;
}

function penalty(m, n) {
  let p = 0;
  const run = (line) => {
    let s = 0, c = 1;
    for (let i = 1; i <= line.length; i++) { if (i < line.length && line[i] === line[i - 1]) c++; else { if (c >= 5) s += c - 2; c = 1; } }
    const str = line.map((b) => (b ? '1' : '0')).join('');
    for (const pat of ['10111010000', '00001011101']) { let idx = -1; while ((idx = str.indexOf(pat, idx + 1)) >= 0) s += 40; }
    return s;
  };
  for (let y = 0; y < n; y++) { p += run(m[y]); p += run(m.map((r) => r[y])); }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  let dark = 0; m.forEach((r) => r.forEach((b) => { if (b) dark++; }));
  p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}
