# -*- coding: utf-8 -*-
"""
خواندن گزارش «پیشنهاد ارسال» (خروجی کوئری «پیشنهاد ارسال ساعتی») و ساخت نسخه فشرده برای صفحه «شبکه ارسال».
فایل ~۹۰ هزار ردیف دارد (هر فروشگاه × هر کالا)؛ مرورگر فقط ستون‌های لازم را به شکل آرایه می‌گیرد.
اطلاعات ثابت هر کالا (نام، گروه، موجودی انبارهای مرکزی…) یک بار در goods می‌آید و ردیف‌ها فقط عددهای هر فروشگاه را دارند.
"""
import json
import os
import re
import zipfile
from xml.etree.ElementTree import iterparse

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
VERSION = 1

# نام ستون‌های گزارش → کلید کوتاه
COLS = {
    'code': 'کد کالا', 'name': 'نام کالا', 'act': 'وضعیت کالا در فروشگاه', 'carton': 'تعداد بچ مادر',
    'up': 'پیشنهاد ارسال گرد شده به بالا/پایین', 'def': 'پیشنهاد ارسال تعدادی(سقف منهی موجودی)',
    'eff': 'موجودی ذخیره و قفسه با فرض رسید شدن سند های 65 در راه', 'barcode': 'بارکد', 'store': 'نام فروشگاه',
    'group': 'گروه کالایی', 'brand': 'نام برند', 'owner': 'تولید کننده', 'max7': 'سقف سفارش(فروش 7 روزه)',
    'shelf': 'موجودی انبار قفسه', 'smax': 'سقف فعلی قفسه', 'smin': 'کف فعلی قفسه',
    'central': 'موجودی انبار مرکزی', 'payebar': 'موجودی انبار پای بار', 'hc': 'موجودی انبار هشدار مرکزی',
    'hp': 'موجودی انبار هشدار پای بار', 'paloud': 'موجودی انبار پالود پخش', 'loc': 'مکان در انبار مرکزی',
    'reserve': 'موجودی انبار ذخیره', 'w1': 'تعداد سند 65 در راه ذخیره', 'w2': 'تعداد سند 65 در راه ذخیره به قفسه',
    'sale30': 'تعداد فروش در 30 روز گذشته', 'closeh': 'مجموع ساعات بسته بودن صندوق برای کالا',
    'openg': 'مجموع ساعات باز بودن صندوق برای کالا', 'hr': 'میانگین فروش ساعتی کالا',
    's3': 'فروش 3 روزه کالا', 'raw': 'پیشنهاد ارسال', 'sendway': 'روش ارسال', 'hold': 'روش نگهداری',
    'doc': 'مشخصات سند در راه 65 ذخیره', 'new': 'کالای جدید', 'basic': 'وضعیت کالا', 'supplier': 'تأمین کننده',
}
# ستون‌هایی که بودنشان یعنی این فایل گزارش پیشنهاد ارسال است
SIGNATURE = ('پیشنهاد ارسال گرد شده به بالا/پایین', 'موجودی انبار قفسه', 'نام فروشگاه')

GOODS_KEYS = ['name', 'group', 'brand', 'owner', 'carton', 'central', 'payebar', 'hc', 'hp', 'paloud', 'loc',
              'sendway', 'hold', 'basic', 'barcode', 'supplier']
ROW_KEYS = ['act', 'up', 'def', 'eff', 'max7', 'shelf', 'smax', 'smin', 'reserve', 'w1', 'w2', 'sale30', 'hr',
            's3', 'raw', 'new', 'openg', 'closeh', 'doc']


def is_send(headers):
    h = set(str(x or '').strip() for x in headers)
    return all(s in h for s in SIGNATURE)


def _col(ref):
    n = 0
    for ch in ref:
        o = ord(ch)
        if 65 <= o <= 90:
            n = n * 26 + o - 64
        else:
            break
    return n - 1


def _sheet_path(z):
    names = z.namelist()
    if 'xl/worksheets/sheet1.xml' in names:
        return 'xl/worksheets/sheet1.xml'
    return next(n for n in sorted(names) if n.startswith('xl/worksheets/sheet'))


def _strings(z):
    out = []
    if 'xl/sharedStrings.xml' not in z.namelist():
        return out
    with z.open('xl/sharedStrings.xml') as f:
        for _, el in iterparse(f, events=('end',)):
            if el.tag == NS + 'si':
                out.append(''.join(x.text or '' for x in el.iter(NS + 't')))
                el.clear()
    return out


def rows_of(path):
    """ردیف‌های اولین شیت (مقدار متنی/عددی، به ترتیب ستون)"""
    with zipfile.ZipFile(path) as z:
        sst = _strings(z)
        C, V, T, IS = NS + 'c', NS + 'v', NS + 't', NS + 'is'
        with z.open(_sheet_path(z)) as f:
            for _, el in iterparse(f, events=('end',)):
                if el.tag != NS + 'row':
                    continue
                row = []
                for c in el.iter(C):
                    ref = c.get('r')
                    i = _col(ref) if ref else len(row)
                    while len(row) < i:
                        row.append(None)
                    t = c.get('t')
                    v = c.find(V)
                    if t == 's':
                        val = sst[int(v.text)] if v is not None and v.text else ''
                    elif t == 'inlineStr':
                        isel = c.find(IS)
                        val = ''.join(x.text or '' for x in isel.iter(T)) if isel is not None else ''
                    elif v is None or v.text is None:
                        val = None
                    elif t in ('str', 'e'):
                        val = v.text
                    else:
                        try:
                            n = float(v.text)
                            val = int(n) if n.is_integer() else n
                        except ValueError:
                            val = v.text
                    row.append(val)
                el.clear()
                yield row


def _num(v):
    if v is None or v == '':
        return None
    if isinstance(v, (int, float)):
        return v
    try:
        n = float(str(v).replace(',', ''))
        return int(n) if n.is_integer() else n
    except ValueError:
        return None


def _txt(v):
    s = '' if v is None else str(v).strip()
    return s or None


def build(path):
    """گزارش → {stores, goods, rows}؛ ردیف‌های غیرفعالِ بی‌موجودی و بی‌فروش حذف می‌شوند"""
    it = rows_of(path)
    idx = None
    for r in it:  # سرستون در ۱۰ ردیف اول
        if is_send(r):
            idx = {str(h or '').strip(): i for i, h in enumerate(r)}
            break
    if idx is None:
        raise ValueError('سرستون گزارش پیشنهاد ارسال پیدا نشد')
    pos = {k: idx.get(h) for k, h in COLS.items()}
    get = lambda r, k: r[pos[k]] if pos[k] is not None and pos[k] < len(r) else None
    stores, sidx, goods, rows = [], {}, {}, []
    dropped = 0
    for r in it:
        code = _txt(get(r, 'code'))
        store = _txt(get(r, 'store'))
        if not code or not store:
            continue  # ردیف ساختگی UNION (-1000) و ردیف‌های خالی
        if code not in goods:
            g = []
            for k in GOODS_KEYS:
                v = get(r, k)
                if k == 'owner':
                    g.append(1 if _txt(v) == 'محصول گروه صنعتی' else 0)
                elif k == 'basic':
                    g.append(1 if _txt(v) else 0)
                elif k in ('carton', 'central', 'payebar', 'hc', 'hp', 'paloud'):
                    g.append(_num(v))
                else:
                    g.append(_txt(v))
            goods[code] = g
        act = 1 if _txt(get(r, 'act')) == 'فعال' else 0
        vals = {k: _num(get(r, k)) for k in ROW_KEYS if k not in ('act', 'new', 'doc')}
        if not act and not any(vals.get(k) for k in ('shelf', 'reserve', 'w1', 'w2', 'sale30')):
            dropped += 1
            continue
        if store not in sidx:
            sidx[store] = len(stores)
            stores.append(store)
        row = [sidx[store], code]
        for k in ROW_KEYS:
            if k == 'act':
                row.append(act)
            elif k == 'new':
                row.append(1 if _txt(get(r, 'new')) else 0)
            elif k == 'doc':
                row.append(_txt(get(r, 'doc')))
            elif k == 'hr':
                h = vals[k]
                row.append(round(h, 5) if isinstance(h, float) else h)
            else:
                row.append(vals[k])
        while row and row[-1] is None:  # ستون‌های خالی انتهایی
            row.pop()
        rows.append(row)
    return {'v': VERSION, 'stores': stores, 'goodsKeys': GOODS_KEYS, 'rowKeys': ['si', 'code'] + ROW_KEYS,
            'goods': goods, 'rows': rows, 'dropped': dropped}


# ---------- گزارش «نیاز به خرید» (یک ردیف برای هر کالا؛ پیشنهاد هر فروشگاه در ستون جدا) ----------
NEED_COLS = {
    'code': 'کد کالا', 'name': 'نام کالا', 'basic': 'نوع کالا', 'need': 'نیاز به خرید', 'sendway': 'نحوه ارسال',
    'needUp': 'نیاز به خرید با توجه به بچ مادر(گرد شده به بالا)', 'brand': 'نام برند',
    'stock': 'مجموع موجودی انبار مرکزی و پای بار', 'orders': 'مجموع پیشنهاد ارسال فروشگاه ها',
    'agent': 'مجموع فروش عامل بنکدار و مغازه دار', 'group': 'گروه کالایی', 'owner': 'تولید کننده',
    'central': 'موجودی انبار مرکزی', 'payebar': 'موجودی انبار پای بار', 'barcode': 'بارکد', 'carton': 'تعداد در بچ مادر',
    'op': 'نقطه سفارش خرید کالا', 'lt': 'Lead Time',
}
NEED_SIGNATURE = ('نیاز به خرید', 'مجموع پیشنهاد ارسال فروشگاه ها', 'نقطه سفارش خرید کالا')
NUM_NEED = ('need', 'needUp', 'stock', 'orders', 'agent', 'central', 'payebar', 'carton', 'op', 'lt')


def is_need(headers):
    h = set(str(x or '').strip() for x in headers)
    return all(s in h for s in NEED_SIGNATURE)


def build_need(path):
    it = rows_of(path)
    idx = None
    for r in it:
        if is_need(r):
            idx = {str(h or '').strip(): i for i, h in enumerate(r)}
            break
    if idx is None:
        raise ValueError('سرستون گزارش نیاز به خرید پیدا نشد')
    keys = list(NEED_COLS)
    pos = [idx.get(NEED_COLS[k]) for k in keys]
    stores = [(h[len('پیشنهاد ارسال '):].strip(), i) for h, i in idx.items() if h.startswith('پیشنهاد ارسال ') and h != 'پیشنهاد ارسال']
    rows = []
    for r in it:
        g = lambda i: r[i] if i is not None and i < len(r) else None
        if not _txt(g(pos[0])):
            continue
        row = [(_num(g(p)) if k in NUM_NEED else _txt(g(p))) for k, p in zip(keys, pos)]
        row.append([_num(g(i)) for _, i in stores])
        rows.append(row)
    return {'v': VERSION, 'keys': keys + ['st'], 'stores': [n for n, _ in stores], 'rows': rows}


# جدول ساده گزارش‌های «سود و زیان» و «سری ساخت» (برای صفحه سه‌بعدی سود و زیان)
# سرستون با امضا پیدا می‌شود (~ یعنی «شامل»)؛ ستون‌های حجیم بی‌کاربرد حذف می‌شوند
TABLES = {
    'pl': {'sig': ('~درصد سود', '~هزینه تأمین یک کالا'), 'drop': ()},
    'batch': {'sig': ('قیمت درج شده در سری ساخت', 'سری ساخت'), 'drop': ('نام کالا', 'متن قیمت تشخیص داده شده در سری ساخت')},
}


def _has(headers, s):
    return any(s[1:] in h for h in headers) if s.startswith('~') else s in headers


def build_table(path, kind):
    spec = TABLES[kind]
    it = rows_of(path)
    head = None
    for n, r in enumerate(it):
        h = [str(x or '').strip() for x in r]
        if all(_has(h, s) for s in spec['sig']):
            head = h
            break
        if n > 10:
            break
    if head is None:
        raise ValueError('سرستون گزارش پیدا نشد')
    keep = [i for i, h in enumerate(head) if h and h not in spec['drop']]
    code = head.index('کد کالا') if 'کد کالا' in head else None
    rows = []
    for r in it:
        if code is not None and not _txt(r[code] if code < len(r) else None):
            continue
        rows.append([r[i] if i < len(r) else None for i in keep])
    return {'v': VERSION, 'kind': kind, 'headers': [head[i] for i in keep], 'rows': rows}


def cached(path, cache_dir, key, builder=None, prefix='send', keep=4):
    """نسخه فشرده با کش روی دیسک (کلید = نام|اندازه|زمان فایل)"""
    builder = builder or build
    os.makedirs(cache_dir, exist_ok=True)
    safe = re.sub(r'[^\w.\-]+', '_', key)[-150:]
    cp = os.path.join(cache_dir, '%s_v%d_%s.json' % (prefix, VERSION, safe))
    if os.path.isfile(cp):
        with open(cp, 'rb') as f:
            return f.read()
    data = json.dumps(builder(path), ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    tmp = cp + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, cp)
    # فقط چند نسخه آخر بماند
    old = sorted((os.path.join(cache_dir, n) for n in os.listdir(cache_dir) if n.startswith(prefix + '_') and n.endswith('.json')),
                 key=os.path.getmtime, reverse=True)[keep:]
    for p in old:
        try:
            os.remove(p)
        except OSError:
            pass
    return data


if __name__ == '__main__':
    import sys
    import time
    t = time.time()
    d = build(sys.argv[1])
    raw = json.dumps(d, ensure_ascii=False, separators=(',', ':'))
    print('stores', len(d['stores']), 'goods', len(d['goods']), 'rows', len(d['rows']), 'dropped', d['dropped'],
          'json MB %.1f' % (len(raw.encode('utf-8')) / 1e6), 'sec %.1f' % (time.time() - t))
    if len(sys.argv) > 2:
        with open(sys.argv[2], 'w', encoding='utf-8') as f:
            f.write(raw)
