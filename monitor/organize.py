# -*- coding: utf-8 -*-
"""
مرتب‌سازی گزارش‌ها: گزارش‌های سیستم را از پوشه ورودی (Downloads) به پوشه «گزارش‌ها» می‌برد،
هر نوع در زیرپوشه خودش و با نام یکدست «نام گزارش + تاریخ شمسی + (ساعت)».
- نوع گزارش از روی سرستون‌ها تشخیص داده می‌شود (همان امضاهای موتور پنل)، نه از روی اسم فایل.
- فایل‌هایی که گزارش سیستم نیستند (لیست قیمت، فرم‌ها و…) دست نمی‌خورند.
- هیچ فایلی پاک نمی‌شود: فایل کاملاً تکراری به زیرپوشه «_تکراری» می‌رود و همه جابه‌جایی‌ها در sort_log.json ثبت می‌شوند.
- زمان آخرین تغییر فایل (mtime) حفظ می‌شود، چون پنل تاریخ و ترتیب گزارش‌ها را از آن هم می‌گیرد.
"""
import datetime
import hashlib
import json
import os
import re
import shutil
import sys
import threading
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, 'sort_cache.json')
LOG = os.path.join(ROOT, 'sort_log.json')
DUP_DIR = '_تکراری'
LOCK = threading.RLock()

# نوع → (زیرپوشه، نام پایه). None = نام پایه از خود اسم فایل (سود و زیان و سری ساخت که نام فروشگاه/کالا دارند)
KINDS = {
    'store': ('تخفیف گروهی', 'پیشنهاد درصد تخفیف گروهی'),
    'agent': ('قیمت عامل', 'قیمت عامل بنکدار مغازه دار'),
    'central': ('انبار مرکزی', 'قیمت سری ساخت انبار مرکزی'),
    'reserve': ('انبار ذخیره', 'قیمت نهایی انبار ذخیره'),
    'pl': ('سود و زیان', None),
    'batch': ('سری ساخت', None),
    'send': ('پیشنهاد ارسال', 'گزارش کامل پیشنهاد ارسال'),
    'need': ('نیاز به خرید', 'نیاز به خرید'),
}
# امضای سرستون‌ها (برابر PricingCalculator/src/engine.js و pl.js و sendreport.py)؛ «~» یعنی «شامل»
SIGS = [
    ('agent', [['قیمت عامل نقدی']]),
    ('central', [['قیمت پیشنهادی سری ساخت انبار مرکزی']]),
    ('reserve', [['قیمت نهایی پیشنهادی انبار ذخیره']]),
    ('pl', [['~درصد سود', '~هزینه تأمین یک کالا']]),
    ('batch', [['~قیمت درج شده در سری ساخت']]),
    ('need', [['نیاز به خرید', 'مجموع پیشنهاد ارسال فروشگاه ها', 'نقطه سفارش خرید کالا']]),
    ('send', [['پیشنهاد ارسال گرد شده به بالا/پایین']]),
    ('store', [['~قبل از تأثیر ماندگاری'], ['~بعد از تأثیر ماندگاری'], ['کانورت درصد تخفیف گروهی'],
               ['درصد تخفیف گروهی فعلی', 'قیمت فروش پیشنهادی بدون مالیات']]),
]
FA_DIGITS = str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')


def norm(s):
    s = str(s or '').translate(FA_DIGITS).replace('ي', 'ی').replace('ك', 'ک').replace('ة', 'ه')
    s = re.sub(r'[\s‌‍‎‏ ]', '', s)
    return re.sub(r'[ً-ْ]', '', s)


def detect(rows):
    for r in rows or []:
        nh = [norm(v) for v in r]

        def has(sig):
            return all(any((h.find(norm(c[1:])) >= 0) if c[0] == '~' else h == norm(c) for h in nh) for c in sig)
        for kind, alts in SIGS:
            if any(has(s) for s in alts):
                return kind
    return None


# ---------- تاریخ ----------
def g2j(gy, gm, gd):
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    gy2 = gy + 1 if gm > 2 else gy
    days = 355666 + 365 * gy + (gy2 + 3) // 4 - (gy2 + 99) // 100 + (gy2 + 399) // 400 + gd + g_d_m[gm - 1]
    jy = -1595 + 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    if days < 186:
        return jy, 1 + days // 31, 1 + days % 31
    return jy, 7 + (days - 186) // 30, 1 + (days - 186) % 30


DATE_RE = re.compile(r'(1[34]\d\d)\s*[/.\-_,]\s*(\d{1,2})\s*[/.\-_,]\s*(\d{1,2})(?!\d)')


def name_date(stem):
    m = DATE_RE.search(stem.translate(FA_DIGITS))
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= mo <= 12 and 1 <= d <= (31 if mo <= 6 else 30)):
        return None
    return y, mo, d


def _ord(j):  # شماره تقریبی روز برای مقایسه فاصله (خطای ≤۱ روز کافی است)
    y, m, d = j
    return y * 365 + ((m - 1) * 31 if m <= 6 else 186 + (m - 7) * 30) + d


def report_date(stem, mtime):
    """مثل پنل: تاریخ داخل اسم اگر تا ۳ روز با زمان فایل فاصله دارد، وگرنه تاریخ خود فایل"""
    md = datetime.datetime.fromtimestamp(mtime)
    mj = g2j(md.year, md.month, md.day)
    nj = name_date(stem)
    return nj if nj and abs(_ord(nj) - _ord(mj)) <= 3 else mj


def clean_stem(stem):
    s = DATE_RE.sub(' ', stem.translate(FA_DIGITS))
    s = re.sub(r'1[34]\d\d[\d.,/\-_]*', ' ', s)  # تاریخ‌های ناقص مثل 1405.07..14
    s = re.sub(r'\(\d+\)|_backup\w*|\.xlsx', ' ', s)
    s = s.replace('سود وزیان', 'سود و زیان')
    s = re.sub(r'[\s_]+', ' ', s).strip(' -_.')
    return s


# واژه‌هایی که در اسم‌های معمول هر نوع می‌آیند؛ بقیه واژه‌های اسم اصلی (مثل «ماکارونی رحمت») حفظ می‌شوند
KEYWORDS = {
    'store': 'پیشنهاد درصد تخفیف گروهی پیشنهادی استخراج اقلام درخواستی',
    'agent': 'قیمت عامل بنکدار بنک مغازه دار مغازه‌دار گذاری قیمت‌گذاری',
    'central': 'قیمت پیشنهادی سری ساخت انبار مرکزی گذاری قیمت‌گذاری',
    'reserve': 'قیمت نهایی پیشنهادی انبار ذخیره',
    'send': 'گزارش کامل پیشنهاد ارسال',
    'need': 'نیاز به خرید',
}
NOISE = 'دوم سوم چهارم پنجم ششم گزارش صبح عصر جدید نسخه n,l nl copy - _'


def _extras(kind, stem):
    skip = {norm(w) for w in (KEYWORDS.get(kind, '') + ' ' + NOISE).split()}
    words = [w for w in clean_stem(stem).split() if norm(w) not in skip and re.search(r'\w', w)]
    return ' '.join(words)


def target_name(kind, stem, mtime, hint=None):
    folder, base = KINDS[kind]
    if base is None:
        base = clean_stem(stem) or folder
    else:
        if 'استخراج' in stem:  # گزارش جزئی (چند قلم) از گزارش کامل همان روز جدا بماند
            base = 'استخراج ' + base
        ex = _extras(kind, stem)
        if ex:
            base += ' - ' + ex
    j = report_date(hint or stem, mtime)
    t = datetime.datetime.fromtimestamp(mtime)
    return folder, '%s %04d.%02d.%02d (%02d-%02d).xlsx' % (base, j[0], j[1], j[2], t.hour, t.minute)


# ---------- کش تشخیص ----------
def _load(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _save(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=0)
    os.replace(tmp, path)


_cache = None


def kind_of(path, sniff):
    """نوع گزارش با کش (مسیر|حجم|زمان)"""
    global _cache
    st = os.stat(path)
    key = '%s|%d|%d' % (path, st.st_size, int(st.st_mtime))
    with LOCK:
        if _cache is None:
            _cache = _load(CACHE, {})
        if key in _cache:
            return _cache[key] or None
    try:
        k = detect(sniff(path)) if st.st_size <= 60 * 1024 * 1024 else None
    except Exception as e:  # noqa: BLE001 — فایل خراب/قفل: فعلاً رد می‌شود
        sys.stderr.write('organize sniff %s: %s\n' % (os.path.basename(path), e))
        return None
    with LOCK:
        _cache[key] = k or ''
        if len(_cache) > 5000:
            _cache = dict(list(_cache.items())[-3000:])
        _save(CACHE, _cache)
    return k


def _hash(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def _unique(folder, name):
    stem, ext = os.path.splitext(name)
    p, k = os.path.join(folder, name), 2
    while os.path.exists(p):
        p, k = os.path.join(folder, '%s [%d]%s' % (stem, k, ext)), k + 1
    return p


def _log(entries):
    if not entries:
        return
    with LOCK:
        log = _load(LOG, [])
        log.extend(entries)
        _save(LOG, log[-3000:])


def place(src, root, kind, hint=None, mtime=None):
    """یک فایل گزارش → زیرپوشه نوع خودش با نام یکدست؛ مسیر نسبی جدید را برمی‌گرداند"""
    st = os.stat(src)
    mt = mtime or st.st_mtime
    stem = os.path.splitext(os.path.basename(src))[0]
    if kind in KINDS:
        sub, name = target_name(kind, stem, mt, hint)
    else:  # نوع ناشناخته (مثلاً گزارش تازه Gateway) → زیرپوشه «سایر»
        j = report_date(hint or stem, mt)
        sub, name = 'سایر', '%s %04d.%02d.%02d.xlsx' % (clean_stem(hint or stem) or 'گزارش', j[0], j[1], j[2])
    dest_dir = os.path.join(root, sub)
    os.makedirs(dest_dir, exist_ok=True)
    # همان فایل قبلاً منتقل شده؟ (حجم و محتوای یکسان در همان زیرپوشه)
    dup = None
    for n in os.listdir(dest_dir):
        p = os.path.join(dest_dir, n)
        if n.lower().endswith('.xlsx') and os.path.getsize(p) == st.st_size and _hash(p) == _hash(src):
            dup = p
            break
    if dup:
        dd = os.path.join(root, DUP_DIR)
        os.makedirs(dd, exist_ok=True)
        dest = _unique(dd, os.path.basename(src))
    else:
        dest = _unique(dest_dir, name)
    shutil.move(src, dest)
    if mtime:
        os.utime(dest, (mtime, mtime))
    rel = os.path.relpath(dest, root).replace('\\', '/')
    _log([{'at': datetime.datetime.now().isoformat(timespec='seconds'), 'from': src, 'to': dest, 'kind': kind, 'dup': bool(dup)}])
    return rel, bool(dup)


def sweep(inbox, root, sniff, min_age=10, dry=False):
    """همه گزارش‌های سیستم در پوشه ورودی (فقط سطح اول) → پوشه گزارش‌ها (dry: فقط فهرست، بدون جابه‌جایی)"""
    moved, dups, skipped = [], 0, 0
    if not inbox or not os.path.isdir(inbox) or os.path.normcase(os.path.abspath(inbox)) == os.path.normcase(os.path.abspath(root)):
        return {'moved': moved, 'dups': 0, 'skipped': 0}
    now = time.time()
    for n in sorted(os.listdir(inbox)):
        p = os.path.join(inbox, n)
        if not n.lower().endswith('.xlsx') or n.startswith('~$') or not os.path.isfile(p):
            continue
        try:
            if now - os.path.getmtime(p) < min_age:  # هنوز در حال دانلود/ذخیره
                continue
            k = kind_of(p, sniff)
            if not k:
                skipped += 1
                continue
            if dry:
                sub, name = target_name(k, os.path.splitext(n)[0], os.path.getmtime(p))
                moved.append({'from': n, 'to': sub + '/' + name, 'kind': k, 'dup': False})
                continue
            rel, dup = place(p, root, k)
            moved.append({'from': n, 'to': rel, 'kind': k, 'dup': dup})
            dups += dup
        except OSError as e:  # فایل باز در اکسل و…: دفعه بعد
            sys.stderr.write('organize %s: %s\n' % (n, e))
    return {'moved': moved, 'dups': dups, 'skipped': skipped}


def last_moves(n=30):
    return _load(LOG, [])[-n:][::-1]
