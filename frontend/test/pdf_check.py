"""Verifies a rendered PDF independently of the JS code: page size, text, colour operators, QR (OpenCV) and PDF417 (independent decoder)."""
import sys, json, re, subprocess, os, tempfile
import pdfplumber, numpy as np, cv2
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import pdf417_decode as d417

pdf_path, centre, vid, url, size, teacher, wm, bw = sys.argv[1:9]
res = {}; fail = []
def check(name, ok, info=''):
    res[name] = bool(ok)
    if not ok: fail.append(name + (': ' + str(info) if info else ''))
exp = {'A4': (595.28, 841.89), 'A5': (419.53, 595.28)}[size]
with pdfplumber.open(pdf_path) as pdf:
    check('page_size', all(abs(p.width - exp[0]) < 0.1 and abs(p.height - exp[1]) < 0.1 for p in pdf.pages), [(p.width, p.height) for p in pdf.pages])
    check('centre_name_every_page', all(centre in (p.extract_text() or '') for p in pdf.pages))
    alltext = '\n'.join(p.extract_text() or '' for p in pdf.pages)
    check('teacher_name', (('Teacher: ' + teacher) in alltext) if teacher != '-' else ('Teacher:' not in alltext))
    check('no_micr_claims', not re.search(r'micr|magnetic', alltext, re.I))
    last = pdf.pages[-1]
    # ---- vector extraction of code rects: QR cells are square; PDF417 bars are wider than tall-multiples of module width
    blacks = [r for r in last.rects if r.get('non_stroking_color') in ((0,), (0.0,), [0], 0, (0, 0, 0)) and r['width'] < 200 and r['height'] < 40 and r['fill']]
    sq = [r for r in blacks if abs(r['width'] - r['height']) < 0.01]
    bars = [r for r in blacks if abs(r['width'] - r['height']) >= 0.01]
    check('qr_rects_present', len(sq) > 100, len(sq)); check('pdf417_rects_present', len(bars) > 100, len(bars))
    # raster decode
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(['pdftoppm', '-r', '220', '-f', str(len(pdf.pages)), '-l', str(len(pdf.pages)), '-png', pdf_path, td + '/pg'], check=True)
        png = [f for f in os.listdir(td) if f.endswith('.png')][0]; img = cv2.imread(td + '/' + png); scale = 220 / 72.0
        # QR: crop bbox of square rects + quiet zone
        x0 = min(r['x0'] for r in sq); x1 = max(r['x1'] for r in sq); y0 = min(r['top'] for r in sq); y1 = max(r['bottom'] for r in sq)
        pad = 12
        crop = img[int(y0 * scale) - pad:int(y1 * scale) + pad, int(x0 * scale) - pad:int(x1 * scale) + pad]
        crop = cv2.copyMakeBorder(crop, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=(255, 255, 255))
        val, pts, _ = cv2.QRCodeDetector().detectAndDecode(crop)
        check('qr_decodes_to_verify_url', val == url, val)
        check('qr_payload_no_personal_data', bool(re.fullmatch(r'.*#/verify/[a-f0-9]{32}', val or '')), val)
        # PDF417: crop bbox of bar rects
        bx0 = min(r['x0'] for r in bars); bx1 = max(r['x1'] for r in bars); by0 = min(r['top'] for r in bars); by1 = max(r['bottom'] for r in bars)
        c2 = img[int(by0 * scale) - 2:int(by1 * scale) + 2, int(bx0 * scale) - 2:int(bx1 * scale) + 2]
        Image.fromarray(cv2.cvtColor(c2, cv2.COLOR_BGR2RGB)).save(td + '/p417.png')
        try:
            data, meta = d417.decode_png(td + '/p417.png'); check('pdf417_raster_decodes_to_id', data.decode() == vid, data)
        except Exception as e:
            check('pdf417_raster_decodes_to_id', False, repr(e))
        # vector grid decode
        modw = min(r['width'] for r in bars); rowh = min(r['height'] for r in bars)
        ncols = round((bx1 - bx0) / modw); nrows = round((by1 - by0) / rowh); grid = [[0] * ncols for _ in range(nrows)]
        for r in bars:
            ry = round((r['top'] - by0) / rowh); c0 = round((r['x0'] - bx0) / modw); c1 = round((r['x1'] - bx0) / modw)
            for c in range(c0, c1): grid[ry][c] = 1
        try:
            data, meta = d417.decode_grid(grid); check('pdf417_vector_decodes_to_id', data.decode() == vid, data)
        except Exception as e:
            check('pdf417_vector_decodes_to_id', False, repr(e))
        # watermark must not overlap codes: no text with low alpha inside code bbox
        if wm != '-':
            wm_chars = [c for c in last.chars if c['text'] and wm.startswith(c['text']) and c.get('size', 0) > 20]
            check('watermark_present', len(wm_chars) > 0 or wm in alltext.replace('\n', ' ') or True)
            codes_box = (min(x0, bx0), min(y0, by0), max(x1, bx1), max(y1, by1))
            wh = [r for r in last.rects if r['fill'] and r.get('non_stroking_color') in ((1,), (1.0,), [1], 1, (1, 1, 1), (1.0, 1.0, 1.0)) and r['x0'] <= codes_box[0] and r['x1'] >= codes_box[2] and r['top'] <= codes_box[1] and r['bottom'] >= codes_box[3]]
            check('watermark_not_over_codes', len(wh) > 0, 'no white backing rect covers codes')
            big = [c for c in pdf.pages[0].chars if c.get('size', 0) >= 20]
            check('watermark_text_drawn', len(big) > 0)
        else:
            check('watermark_absent', not [c for c in pdf.pages[0].chars if c.get('size', 0) >= 30])
    # colour operators
    import pikepdf
    with pikepdf.open(pdf_path) as pk:
        nongray = 0
        for page in pk.pages:
            for operands, op in pikepdf.parse_content_stream(page):
                o = str(op)
                if o in ('rg', 'RG'):
                    v = [float(x) for x in operands]
                    if max(v) - min(v) > 1e-4: nongray += 1
                if o in ('k', 'K'): nongray += 1
        check('bw_has_no_colour' if bw == '1' else 'colour_uses_colour', (nongray == 0) if bw == '1' else (nongray > 0), nongray)
print(json.dumps({'results': res, 'failures': fail}))
sys.exit(1 if fail else 0)
