# -*- coding: utf-8 -*-
"""
پنل پایش قیمت و تخفیف — سرور محلی
فقط روی همین کامپیوتر (127.0.0.1) در دسترس است و فقط کتابخانه‌های استاندارد پایتون را لازم دارد.
- پوشه گزارش‌ها (پیش‌فرض: Downloads) را می‌خواند؛ فایل‌های موجود فقط خوانده می‌شوند و تغییر نمی‌کنند
  (تنها نوشتن: گزارش‌هایی که از Data Gateway گرفته می‌شوند به صورت فایل xlsx تازه در همین پوشه ذخیره می‌شوند).
- برای تشخیص نوع گزارش، فقط ۱۰ ردیف اول هر فایل خوانده و نتیجه ذخیره می‌شود.
- موتور محاسبه همان موتور «میز قیمت‌گذاری» است (PricingCalculator/src).
"""
import http.server
import json
import os
import socket
import sys
import threading
import time
import re
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import zipfile
from xml.etree.ElementTree import iterparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sendreport  # noqa: E402  (کنار همین فایل)
import gateway  # noqa: E402  اتصال به Data Gateway (gateway.json)
import organize  # noqa: E402  جمع‌آوری و نام‌گذاری گزارش‌ها در پوشه «گزارش‌ها»
import fcbridge  # noqa: E402  تب «کف و سقف» روی موتور پنل جامع کف و سقف
import erpbridge  # noqa: E402  تب «کانورت ERP» روی موتور ERPConverter

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, 'web')
LIB = os.path.join(os.path.dirname(ROOT), 'PricingCalculator', 'src')
CONF = os.path.join(ROOT, 'config.json')
CACHE = os.path.join(ROOT, 'header_cache.json')
SEND_CACHE = os.path.join(ROOT, 'send_cache')  # نسخه فشرده گزارش‌های پیشنهاد ارسال
HOST, PORT = '127.0.0.1', 8800
if '--port' in sys.argv:
    PORT = int(sys.argv[sys.argv.index('--port') + 1])
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
RNS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
MAX_SIZE = 40 * 1024 * 1024  # فایل‌های بزرگ‌تر خوانده نمی‌شوند
FC_POST = ('/api/fc/export', '/api/fc/copy', '/api/fc/fix', '/api/fc/preset', '/api/fc/excel', '/api/fc/ai', '/api/fc/open')
ERP_POST = ('/api/erp/load', '/api/erp/recalc', '/api/erp/export', '/api/erp/open')
GEMINI = 'https://generativelanguage.googleapis.com/v1beta/'
GEMINI_DEFAULT_MODEL = 'gemini-flash-latest'
MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
        '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'}
LOCK = threading.Lock()


def load_conf():
    dl = os.path.join(os.path.expanduser('~'), 'Downloads')
    # folder = پوشه گزارش‌ها، inbox = جایی که فایل‌ها دانلود می‌شوند، autoSort = جمع‌آوری خودکار گزارش‌ها از inbox
    conf = {'folder': dl, 'refresh': 60, 'inbox': dl, 'autoSort': False}
    try:
        with open(CONF, encoding='utf-8') as f:
            conf.update(json.load(f))
    except (OSError, ValueError):
        pass
    return conf


def save_conf(conf):
    with open(CONF, 'w', encoding='utf-8') as f:
        json.dump(conf, f, ensure_ascii=False, indent=2)


def load_cache():
    try:
        with open(CACHE, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


HEAD_CACHE = load_cache()


def list_files(folder):
    """فایل‌های xlsx پوشه و زیرپوشه‌هایش (تا دو سطح)؛ نام = مسیر نسبی با «/». پوشه‌های «_…» (مثل _تکراری) خوانده نمی‌شوند"""
    out = []
    if not os.path.isdir(folder):
        return None
    base = os.path.normpath(folder)
    for d, dirs, names in os.walk(base):
        rel = os.path.relpath(d, base)
        depth = 0 if rel == '.' else rel.count(os.sep) + 1
        dirs[:] = [x for x in dirs if not x.startswith(('_', '.')) and depth < 2]
        for n in names:
            if not n.lower().endswith('.xlsx') or n.startswith('~$'):
                continue
            p = os.path.join(d, n)
            try:
                st = os.stat(p)
            except OSError:
                continue
            name = n if depth == 0 else (rel.replace(os.sep, '/') + '/' + n)
            out.append({'name': name, 'size': st.st_size, 'mtime': int(st.st_mtime * 1000)})
    out.sort(key=lambda x: x['mtime'])
    return out


def first_sheet(z):
    """مسیر اولین شیت از روی workbook.xml"""
    try:
        with z.open('xl/workbook.xml') as f:
            rid = None
            for _, el in iterparse(f, events=('end',)):
                if el.tag == NS + 'sheet':
                    rid = el.get(RNS + 'id')
                    break
        if rid:
            with z.open('xl/_rels/workbook.xml.rels') as f:
                for _, el in iterparse(f, events=('end',)):
                    if el.tag.endswith('Relationship') and el.get('Id') == rid:
                        t = el.get('Target').lstrip('/')
                        return t if t.startswith('xl/') else 'xl/' + t
    except (KeyError, OSError):
        pass
    return 'xl/worksheets/sheet1.xml'


def sniff(path, maxrows=10):
    """۱۰ ردیف اول اولین شیت (فقط متن‌ها) برای تشخیص نوع گزارش"""
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        sheet = first_sheet(z)
        if sheet not in names:
            sheet = next((n for n in sorted(names) if n.startswith('xl/worksheets/sheet')), None)
            if not sheet:
                return []
        rows, need = [], set()
        with z.open(sheet) as f:
            for _, el in iterparse(f, events=('end',)):
                if el.tag == NS + 'row':
                    r = []
                    for c in el.findall(NS + 'c'):
                        t, v = c.get('t'), c.find(NS + 'v')
                        if t == 's' and v is not None and v.text is not None:
                            i = int(v.text)
                            r.append(('s', i))
                            need.add(i)
                        elif t == 'inlineStr':
                            r.append(('v', ''.join(x.text or '' for x in c.iter(NS + 't'))))
                        elif v is not None:
                            r.append(('v', v.text or ''))
                    rows.append(r)
                    el.clear()
                    if len(rows) >= maxrows:
                        break
        strings = {}
        if need and 'xl/sharedStrings.xml' in names:
            mx, i = max(need), 0
            with z.open('xl/sharedStrings.xml') as f:
                for _, el in iterparse(f, events=('end',)):
                    if el.tag == NS + 'si':
                        if i in need:
                            strings[i] = ''.join(x.text or '' for x in el.iter(NS + 't'))
                        i += 1
                        el.clear()
                        if i > mx:
                            break
        return [[strings.get(x[1], '') if x[0] == 's' else x[1] for x in r] for r in rows]


SORT = {'last': None}
SORT_LOCK = threading.Lock()


def sort_run(dry=False):
    """گزارش‌های سیستم در پوشه ورودی (Downloads) → پوشه گزارش‌ها"""
    conf = load_conf()
    with SORT_LOCK:
        r = organize.sweep(conf.get('inbox'), conf['folder'], sniff, dry=dry)
    if not dry and r['moved']:
        SORT['last'] = {'at': time.strftime('%Y-%m-%dT%H:%M:%S'), 'n': len(r['moved']), 'dups': r['dups']}
        print('%d گزارش به پوشه گزارش‌ها منتقل شد' % len(r['moved']))
    return r


def sorter():
    while True:
        time.sleep(30)
        try:
            if load_conf().get('autoSort'):
                sort_run()
        except Exception as e:  # noqa: BLE001 — حلقه نباید بمیرد
            sys.stderr.write('sorter: %r\n' % e)


def sort_status():
    conf = load_conf()
    return {'folder': conf['folder'], 'inbox': conf.get('inbox') or '', 'autoSort': bool(conf.get('autoSort')),
            'last': SORT['last'], 'moves': organize.last_moves(20)}


def gemini_status(conf):
    k = conf.get('geminiKey') or ''
    return {'hasKey': bool(k), 'keyTail': k[-4:] if k else '', 'model': conf.get('geminiModel') or GEMINI_DEFAULT_MODEL, 'proxy': conf.get('geminiProxy') or ''}


def gemini_call(path, body=None, timeout=120):
    """درخواست به Gemini؛ کلید فقط در سرور می‌ماند و به مرورگر فرستاده نمی‌شود"""
    conf = load_conf()
    key = conf.get('geminiKey')
    if not key:
        return 400, {'error': 'کلید API جمینی ثبت نشده است', 'code': 'nokey'}
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(GEMINI + path, data=data, method='POST' if data else 'GET',
                                 headers={'x-goog-api-key': key, 'Content-Type': 'application/json'})
    handlers = []
    if conf.get('geminiProxy'):
        handlers.append(urllib.request.ProxyHandler({'http': conf['geminiProxy'], 'https': conf['geminiProxy']}))
    opener = urllib.request.build_opener(*handlers)
    try:
        with opener.open(req, timeout=timeout) as r:
            return 200, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            j = json.loads(e.read().decode('utf-8'))
            msg = (j.get('error') or {}).get('message') or str(e)
        except (ValueError, OSError):
            msg = str(e)
        return e.code, {'error': msg, 'status': e.code}
    except (urllib.error.URLError, socket.timeout, OSError, ValueError) as e:
        reason = getattr(e, 'reason', e)
        return 502, {'error': 'اتصال به Gemini برقرار نشد: %s' % reason, 'code': 'net'}


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'PricingMonitor/1.0'

    def log_message(self, fmt, *args):  # لاگ کم‌حجم
        if args and str(args[1]).startswith(('4', '5')):
            sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))

    def _host_ok(self):
        h = (self.headers.get('Host') or '').split(':')[0]
        return h in ('127.0.0.1', 'localhost')

    def _send(self, code, body, ctype='application/json; charset=utf-8', extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        elif isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _file(self, base, rel):
        rel = rel.replace('\\', '/')
        full = os.path.normpath(os.path.join(base, rel))
        if not full.startswith(os.path.normpath(base) + os.sep) or not os.path.isfile(full):
            return self._send(404, {'error': 'not found'})
        with open(full, 'rb') as f:
            data = f.read()
        self._send(200, data, MIME.get(os.path.splitext(full)[1].lower(), 'application/octet-stream'))

    def _report(self, name):
        """نام فایل باید دقیقاً یکی از فایل‌های xlsx همان پوشه (یا زیرپوشه‌هایش) باشد"""
        conf = load_conf()
        files = list_files(conf['folder']) or []
        f = next((x for x in files if x['name'] == name), None)
        if not f or '..' in name.split('/'):
            return None, None
        return os.path.join(conf['folder'], *name.split('/')), f

    # ---------- تب «کف و سقف» (موتور پنل جامع کف و سقف) ----------
    def _fc_data(self, force=False):
        return fcbridge.load([load_conf().get('folder')], force)

    def _fc_get(self, path, q):
        s = fcbridge.svc()
        if not s:
            return self._send(200, {'ok': False, 'error': 'موتور کف و سقف بارگذاری نشد: %s' % fcbridge.error()})
        try:
            data, rep = self._fc_data((q.get('reload') or [''])[0] in ('1', 'true'))
            if path == '/api/fc/status':
                if not data:
                    return self._send(200, {'ok': True, 'file': None, 'stores': [], 'goods': 0, 'target_date': s.today_jalali(),
                                            'folder': load_conf().get('folder')})
                return self._send(200, fcbridge.summary(data, rep))
            if path == '/api/fc/presets':
                return self._send(200, {'presets': s.PRESETS if hasattr(s, 'PRESETS') else {}})
            if not data:
                return self._send(404, {'error': 'گزارش پیشنهاد ارسال پیدا نشد'})
            if path == '/api/fc/store':
                store = (q.get('store') or [''])[0].strip()
                return self._send(200, {'store': store, 'items': s.store_items(data, store)})
            if path == '/api/fc/item':
                return self._send(200, {'items': s.item_rows(data, (q.get('code') or [''])[0])})
            if path == '/api/fc/audit':
                return self._send(200, fcbridge.audit_cached(data))
        except s.ServiceError as e:
            return self._send(400, {'error': str(e)})
        except (OSError, ValueError, KeyError, zipfile.BadZipFile) as e:
            return self._send(500, {'error': 'خطا در خواندن گزارش پیشنهاد ارسال: %s' % e})
        return self._send(404, {'error': 'not found'})

    def _fc_post(self, path, body):
        s = fcbridge.svc()
        if not s:
            return self._send(503, {'error': 'موتور کف و سقف بارگذاری نشد: %s' % fcbridge.error()})
        try:
            data, _ = self._fc_data()
            td = s.resolve_target_date(None, body.get('target_date'))
            store = str(body.get('store') or '').strip()
            if path == '/api/fc/export':
                return self._send(200, s.export_convert(data, store, body.get('items') or [], td, body.get('label') or None))
            if path == '/api/fc/copy':
                return self._send(200, s.copy_erp(store, body.get('items') or []))
            if path == '/api/fc/fix':
                cats = [str(c) for c in (body.get('categories') or [])] or None
                return self._send(200, s.audit_fix(data, store, td, cats, write=not body.get('preview')))
            if path == '/api/fc/preset':
                return self._send(200, s.preset(data, str(body.get('preset') or ''), store))
            if path == '/api/fc/excel':
                return self._send(200, s.custom_excel(body.get('file_base64'), None, store or None, td))
            if path == '/api/fc/ai':
                conf = load_conf()
                model = str(conf.get('geminiModel') or GEMINI_DEFAULT_MODEL)
                call = lambda payload: gemini_call('models/%s:generateContent' % model, payload)  # noqa: E731
                return self._send(200, s.ai_parse_with(call, data, body.get('text'), body.get('image_base64'), store))
            if path == '/api/fc/open':
                d = s.today_output_dir(td)
                if not d:
                    return self._send(404, {'error': 'پوشه کانورت روزانه پیدا نشد'})
                if sys.platform == 'win32':
                    os.startfile(d)  # فقط پوشه ثابت کانورت؛ مسیر از مرورگر گرفته نمی‌شود
                return self._send(200, {'opened': d})
        except s.ServiceError as e:
            return self._send(400, {'error': str(e)})
        except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as e:
            return self._send(500, {'error': str(e)})
        return self._send(404, {'error': 'not found'})

    # ---------- تب «کانورت ERP» (موتور ERPConverter) ----------
    def _erp_folders(self):
        conf = load_conf()
        return [f for f in (conf.get('folder'), conf.get('inbox')) if f]

    def _erp(self, path, q=None, body=None):
        if not erpbridge.mods():
            return self._send(200 if body is None else 503, {'ok': False, 'error': 'موتور ERPConverter بارگذاری نشد: %s' % erpbridge.error()})
        try:
            if path == '/api/erp/status':
                return self._send(200, erpbridge.status(self._erp_folders()))
            if path == '/api/erp/tsv':
                return self._send(200, erpbridge.tsv((q.get('mode') or ['setad'])[0]))
            if path == '/api/erp/load':
                return self._send(200, erpbridge.load(self._erp_folders(), bool(body.get('force'))))
            if path == '/api/erp/recalc':
                return self._send(200, erpbridge.recalc(body.get('edits') or []))
            if path == '/api/erp/export':
                return self._send(200, erpbridge.export())
            if path == '/api/erp/open':
                return self._send(200, erpbridge.open_dir())
        except FileNotFoundError as e:
            return self._send(404, {'error': str(e)})
        except (ValueError, TypeError, KeyError) as e:
            return self._send(400, {'error': str(e)})
        except (OSError, zipfile.BadZipFile) as e:
            return self._send(500, {'error': 'خطا در خواندن/نوشتن فایل: %s' % e})
        return self._send(404, {'error': 'not found'})

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {'error': 'forbidden'})
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        path = urllib.parse.unquote(u.path)
        if path in ('/', '/index.html'):
            return self._file(WEB, 'index.html')
        if path.startswith('/web/'):
            return self._file(WEB, path[5:])
        if path.startswith('/lib/'):
            return self._file(LIB, path[5:])
        if path == '/api/config':
            conf = load_conf()
            return self._send(200, {'folder': conf['folder'], 'refresh': conf.get('refresh', 60), 'exists': os.path.isdir(conf['folder']),
                                    'inbox': conf.get('inbox') or '', 'autoSort': bool(conf.get('autoSort'))})
        if path == '/api/sort/status':
            return self._send(200, sort_status())
        if path == '/api/files':
            conf = load_conf()
            files = list_files(conf['folder'])
            if files is None:
                return self._send(200, {'folder': conf['folder'], 'ok': False, 'files': []})
            return self._send(200, {'folder': conf['folder'], 'ok': True, 'files': files})
        if path == '/api/head':
            name = (q.get('name') or [''])[0]
            full, f = self._report(name)
            if not full:
                return self._send(404, {'error': 'not found'})
            key = '%s|%d|%d' % (name, f['size'], f['mtime'])
            with LOCK:
                if key in HEAD_CACHE:
                    return self._send(200, {'rows': HEAD_CACHE[key]})
            if f['size'] > MAX_SIZE:
                rows = []
            else:
                try:
                    rows = sniff(full)
                except (zipfile.BadZipFile, KeyError, OSError, ValueError, SyntaxError) as e:
                    rows = []
                    sys.stderr.write('sniff %s: %s\n' % (name, e))
            with LOCK:
                HEAD_CACHE[key] = rows
                try:
                    with open(CACHE, 'w', encoding='utf-8') as fh:
                        json.dump(HEAD_CACHE, fh, ensure_ascii=False)
                except OSError:
                    pass
            return self._send(200, {'rows': rows})
        if path == '/api/file':
            name = (q.get('name') or [''])[0]
            full, f = self._report(name)
            if not full or f['size'] > MAX_SIZE:
                return self._send(404, {'error': 'not found'})
            with open(full, 'rb') as fh:
                data = fh.read()
            return self._send(200, data, 'application/octet-stream')
        if path == '/api/send':
            # گزارش پیشنهاد ارسال → نسخه فشرده (بار اول ~۱۵ ثانیه، بعد از کش)
            name = (q.get('name') or [''])[0]
            full, f = self._report(name)
            if not full or f['size'] > MAX_SIZE:
                return self._send(404, {'error': 'not found'})
            try:
                data = sendreport.cached(full, SEND_CACHE, '%s|%d|%d' % (name, f['size'], f['mtime']))
            except (zipfile.BadZipFile, KeyError, OSError, ValueError, SyntaxError) as e:
                return self._send(422, {'error': 'گزارش پیشنهاد ارسال خوانده نشد: %s' % e})
            return self._send(200, data)
        if path == '/api/table':
            # گزارش سود و زیان / سری ساخت → جدول فشرده (صفحه سه‌بعدی سود و زیان)
            name = (q.get('name') or [''])[0]
            kind = (q.get('kind') or [''])[0]
            full, f = self._report(name)
            if not full or f['size'] > MAX_SIZE or kind not in sendreport.TABLES:
                return self._send(404, {'error': 'not found'})
            try:
                data = sendreport.cached(full, SEND_CACHE, '%s|%d|%d' % (name, f['size'], f['mtime']),
                                         lambda p: sendreport.build_table(p, kind), 'tab' + kind, 16)
            except (zipfile.BadZipFile, KeyError, OSError, ValueError, SyntaxError) as e:
                return self._send(422, {'error': 'گزارش خوانده نشد: %s' % e})
            return self._send(200, data)
        if path == '/api/need':
            # گزارش نیاز به خرید → نسخه فشرده
            name = (q.get('name') or [''])[0]
            full, f = self._report(name)
            if not full or f['size'] > MAX_SIZE:
                return self._send(404, {'error': 'not found'})
            try:
                data = sendreport.cached(full, SEND_CACHE, '%s|%d|%d' % (name, f['size'], f['mtime']), sendreport.build_need, 'need')
            except (zipfile.BadZipFile, KeyError, OSError, ValueError, SyntaxError) as e:
                return self._send(422, {'error': 'گزارش نیاز به خرید خوانده نشد: %s' % e})
            return self._send(200, data)
        if path.startswith('/api/fc/'):
            return self._fc_get(path, q)
        if path in ('/api/erp/status', '/api/erp/tsv'):
            return self._erp(path, q)
        if path == '/api/gemini/status':
            return self._send(200, gemini_status(load_conf()))
        if path == '/api/gemini/models':
            code, j = gemini_call('models?pageSize=200', timeout=30)
            if code != 200:
                return self._send(code, j)
            names = [m.get('name', '').replace('models/', '') for m in j.get('models', [])
                     if 'generateContent' in (m.get('supportedGenerationMethods') or [])]
            return self._send(200, {'models': [n for n in names if n.startswith('gemini')]})
        if path == '/api/gw/status':
            return self._send(200, gateway.status())
        if path == '/api/gw/health':
            return self._send(200, gateway.health())
        if path == '/favicon.ico':
            return self._send(204, b'', 'image/x-icon')
        return self._send(404, {'error': 'not found'})

    def do_POST(self):
        if not self._host_ok():
            return self._send(403, {'error': 'forbidden'})
        # فقط صفحه خود پنل (نه سایت‌های دیگر) می‌تواند درخواست بفرستد
        origin = self.headers.get('Origin')
        if origin and urllib.parse.urlparse(origin).hostname not in ('127.0.0.1', 'localhost'):
            return self._send(403, {'error': 'forbidden'})
        if 'application/json' not in (self.headers.get('Content-Type') or ''):
            return self._send(415, {'error': 'json only'})
        path = urllib.parse.urlparse(self.path).path
        if path not in ('/api/config', '/api/gemini/config', '/api/gemini/generate', '/api/gw/config', '/api/gw/submit', '/api/gw/check', '/api/gw/sync', '/api/sort/run') \
                and path not in FC_POST and path not in ERP_POST:
            return self._send(404, {'error': 'not found'})
        n = int(self.headers.get('Content-Length') or 0)
        if n > (24 if path in FC_POST else 8) * 1024 * 1024:
            return self._send(413, {'error': 'too large'})
        try:
            body = json.loads(self.rfile.read(n).decode('utf-8') or '{}')
        except ValueError:
            return self._send(400, {'error': 'bad json'})
        if path in FC_POST:
            return self._fc_post(path, body)
        if path in ERP_POST:
            return self._erp(path, body=body)
        if path == '/api/sort/run':
            try:
                r = sort_run(bool(body.get('dry')))
            except OSError as e:
                return self._send(500, {'error': str(e)})
            return self._send(200, {'moved': r['moved'], 'dups': r['dups'], 'skipped': r['skipped'], 'status': sort_status()})
        if path.startswith('/api/gw/'):
            try:
                if path == '/api/gw/config':
                    return self._send(200, gateway.configure(body))
                if path == '/api/gw/submit':
                    call = gateway.submit(str(body.get('id') or ''), 'manual', params=body.get('params'))
                    return self._send(200, {'call': {k: call.get(k) for k in ('id', 'status', 'file', 'rows', 'error', 'note')}, 'status': gateway.status()})
                if path == '/api/gw/sync':
                    return self._send(200, gateway.sync_catalog())
                gateway.check_now()
                return self._send(200, gateway.status())
            except gateway.GwError as e:
                return self._send(400, {'error': e.msg, 'code': e.code})
            except (ValueError, TypeError) as e:
                return self._send(400, {'error': str(e)})
        if path == '/api/gemini/config':
            conf = load_conf()
            if body.get('clearKey'):
                conf.pop('geminiKey', None)
            key = str(body.get('key') or '').strip()
            if key:
                conf['geminiKey'] = key
            model = str(body.get('model') or '').strip()
            if model:
                if not re.fullmatch(r'[\w.\-]+', model):
                    return self._send(400, {'error': 'نام مدل نامعتبر است'})
                conf['geminiModel'] = model
            if 'proxy' in body:
                conf['geminiProxy'] = str(body.get('proxy') or '').strip()
            save_conf(conf)
            return self._send(200, gemini_status(conf))
        if path == '/api/gemini/generate':
            conf = load_conf()
            model = str(body.pop('model', '') or conf.get('geminiModel') or GEMINI_DEFAULT_MODEL)
            if not re.fullmatch(r'[\w.\-]+', model):
                return self._send(400, {'error': 'نام مدل نامعتبر است'})
            code, j = gemini_call('models/%s:generateContent' % model, body)
            return self._send(code, j)
        conf = load_conf()
        folder = str(body.get('folder') or '').strip().strip('"')
        if folder:
            if not os.path.isdir(folder):
                return self._send(400, {'error': 'پوشه پیدا نشد: ' + folder})
            conf['folder'] = folder
        if body.get('refresh'):
            conf['refresh'] = max(15, min(3600, int(body['refresh'])))
        if 'inbox' in body:
            inbox = str(body.get('inbox') or '').strip().strip('"')
            if inbox and not os.path.isdir(inbox):
                return self._send(400, {'error': 'پوشه ورودی پیدا نشد: ' + inbox})
            conf['inbox'] = inbox
        if 'autoSort' in body:
            conf['autoSort'] = bool(body['autoSort'])
        save_conf(conf)
        return self._send(200, {'ok': True, 'folder': conf['folder'], 'refresh': conf['refresh'], 'inbox': conf.get('inbox') or '', 'autoSort': bool(conf.get('autoSort'))})


def port_busy():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((HOST, PORT)) == 0


def main():
    url = 'http://%s:%d/' % (HOST, PORT)
    if port_busy():
        print('پنل از قبل در حال اجراست؛ مرورگر باز می‌شود:', url)
        if '--no-browser' not in sys.argv:
            webbrowser.open(url)
        return
    if not os.path.isfile(os.path.join(LIB, 'engine.js')):
        print('موتور محاسبه پیدا نشد:', LIB)
        input('Enter را بزنید…')
        return
    srv = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    print('پنل پایش قیمت و تخفیف روی', url)
    print('پوشه گزارش‌ها:', load_conf()['folder'])
    print('برای بستن پنل این پنجره را ببندید.')
    if '--no-gateway' not in sys.argv:
        gateway.start(lambda: load_conf()['folder'], sniff)
    if '--no-sort' not in sys.argv:
        threading.Thread(target=sorter, daemon=True).start()
    if '--no-browser' not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        try:
            sys.stdout.reconfigure(encoding='utf-8')
            sys.stderr.reconfigure(encoding='utf-8')
        except (OSError, ValueError):
            pass
    main()
