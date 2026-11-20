"""Independent PDF417 decoder used ONLY for verification (no shared code with the JS encoder besides the ISO symbol table).
Input: module grid text (rows of 0/1) OR a PNG raster (auto-detects module size). Output: decoded bytes + checks.
Checks: start/stop patterns, symbol-character lookup, row indicators, Reed-Solomon syndromes (roots 3^i mod 929), byte decompaction."""
import sys, re, json
MOD = 929
ns = {}
src = open('/home/claude/tuitiondesk/frontend/src/pdf/pdf417_table.js').read()
TABLE = [int(x, 16) for x in re.findall(r'0x[0-9a-fA-F]+', src)]
assert len(TABLE) == 2787, len(TABLE)
INV = {}
for cl in range(3):
    for cw in range(929):
        INV[(cl, TABLE[cl * 929 + cw])] = cw
START = [int(c) for c in bin(0x1fea8)[2:].zfill(17)]
STOP = [int(c) for c in bin(0x3fa29)[2:].zfill(18)]

def bits_to_int(b):
    v = 0
    for x in b: v = v * 2 + x
    return v

def decode_grid(rows):
    """rows: list of lists of 0/1 modules."""
    nrows = len(rows); width = len(rows[0])
    assert (width - 69) % 17 == 0, 'bad width %d' % width
    cols = (width - 69) // 17
    cws = []; ind = []
    for r, row in enumerate(rows):
        assert row[:17] == START, 'bad start row %d' % r
        assert row[-18:] == STOP, 'bad stop row %d' % r
        cl = r % 3
        syms = [row[17 + 17 * i: 34 + 17 * i] for i in range(cols + 2)]
        vals = []
        for s in syms:
            key = (cl, bits_to_int(s))
            assert key in INV, 'unknown symbol row %d' % r
            vals.append(INV[key])
        ind.append((vals[0], vals[-1])); cws.extend(vals[1:-1])
    # row indicator consistency: each cluster must agree on rows/cols/ecc info
    K = lambda r: (r // 3) * 30
    info = {}
    for r, (l, rt) in enumerate(ind):
        cl = r % 3; k = K(r)
        if cl == 0: info['rows3'] = l - k; info['cols'] = rt - k + 1
        elif cl == 1: info['ec_rows'] = l - k; info['rows_div'] = rt - k
        else: info['cols2'] = l - k + 1; info['ec_rows2'] = rt - k
    assert info['cols'] == cols == info['cols2'], 'column indicator mismatch ' + str(info)
    level = info['ec_rows'] // 3
    assert info['rows3'] == (nrows - 1) // 3 and info['rows_div'] == (nrows - 1) // 3, 'row count indicator mismatch'
    assert info['ec_rows'] % 3 == (nrows - 1) % 3 and info['ec_rows2'] == info['ec_rows'], 'ec indicator mismatch'
    k = 2 ** (level + 1)
    # Reed-Solomon syndromes
    for i in range(k):
        x = pow(3, i, MOD); acc = 0
        for c in cws: acc = (acc * x + c) % MOD
        assert acc == 0, 'RS syndrome %d non-zero' % i
    sld = cws[0]; assert sld == len(cws) - k, 'symbol length descriptor %d != %d' % (sld, len(cws) - k)
    data = cws[1:sld]
    while data and data[-1] == 900: data.pop()
    assert data[0] == 901, 'not byte compaction'
    data = data[1:]; out = bytearray(); i = 0
    # decode: groups of 5 -> 6 bytes; remainder bytes 1:1. The group count is ambiguous only if remainder>=5; our encoder emits <6 remainder bytes.
    n = len(data); full = n // 5 if n % 5 == 0 else None
    # Heuristic standard decoder: process 5-codeword groups while at least 5 remain AND remaining count after is < 5 or is a multiple handled per spec
    i = 0
    while n - i >= 5:
        # spec: remaining codewords < 5 are 1:1 bytes; groups consume 5 at a time
        v = 0
        for c in data[i:i + 5]: v = v * 900 + c
        out += v.to_bytes(6, 'big'); i += 5
    for c in data[i:]: assert c < 256; out.append(c)
    return bytes(out), dict(rows=nrows, cols=cols, ecLevel=level)

def decode_png(path):
    from PIL import Image
    import numpy as np
    im = np.array(Image.open(path).convert('L')) < 128
    ys, xs = np.where(im); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    box = im[y0:y1, x0:x1]; W = box.shape[1]; H = box.shape[0]
    for cols in range(1, 31):
        mods = 69 + 17 * cols; mw = W / mods
        for nrows in range(3, 91):
            rh = H / nrows
            if rh < mw * 1.5: continue
            try:
                grid = [[1 if box[int((r + .5) * rh), int((c + .5) * mw)] else 0 for c in range(mods)] for r in range(nrows)]
                return decode_grid(grid)
            except AssertionError:
                continue
    raise AssertionError('could not decode raster')

if __name__ == '__main__':
    p = sys.argv[1]
    if p.endswith('.png'): data, meta = decode_png(p)
    else:
        rows = [[int(c) for c in l.strip()] for l in open(p) if l.strip()]; data, meta = decode_grid(rows)
    print(json.dumps({'payload': data.decode('latin1'), **meta}))
